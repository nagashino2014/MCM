// 고시공고 발주 신호 수집 오케스트레이션. source='gosi', 2채널(토지이음 산단 고시 + 환경청 RSS).
// LLM 미사용 — 토지이음은 키워드 검색 자체가 필터이고 고시명 규칙으로 등급화(고시=확정 사실),
// 환경청 RSS 는 제목 키워드 통과분을 monitoring(사람 검토·EIASS 보완)으로만 적재한다.
// 고시는 발주 주체가 기관이라 회사 매칭이 없다(전건 unmatched 신규 리드 트랙).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  fetchEumGosiList,
  fetchMeOfficeRss,
  EUM_KEYWORDS,
  ME_OFFICES,
  type GosiItem,
} from "./gosi-client";
import type { IntelSignalType, IntelSignalGrade } from "./signal-extractor";
import { isOlderThanCutoff } from "./intel-settings";
import { feedbackKey, loadFeedbackBlocklist } from "./intel-feedback";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHANNEL_THROTTLE_MS = 300;

// 환경청 공고 중 산단·공장·배출시설 직접 언급만(하천·도로 환경영향평가 공람은 비제조 노이즈가
// 대부분이고 협의현황 자체는 EIASS 수집이 커버 → 여기선 제외)
const ME_TITLE_RE = /(산업단지|산단|농공단지|공장|제조|소각|폐기물|매립)/;

// 토지이음 고시명 규칙 등급: 고시는 확정 사실이므로 신규 지정·승인=confirmed,
// 변경=monitoring(증설 가능성, 사람 검토), 폐지·준공·해제=excluded(늦거나 반대 신호).
function classifyEumGosi(title: string): { signalType: IntelSignalType; grade: IntelSignalGrade } {
  if (/폐지|준공|완료|해제|취소/.test(title)) return { signalType: "other", grade: "excluded" };
  if (/변경/.test(title)) return { signalType: "expansion", grade: "monitoring" };
  return { signalType: "new_site", grade: "confirmed" };
}

export interface CollectGosiOptions {
  maxPagesPerKeyword?: number; // 토지이음 키워드당 페이지(10행). 기본 1(일일 증분 충분)
  eumKeywords?: string[]; // 토지이음 검색 키워드(EUM_KEYWORDS 에 정의된 것만 유효)
  rssEnabled?: boolean; // 환경청 RSS 채널 사용 여부
  disclosureCutoffIso?: string | null; // 고시일 하한(YYYY-MM-DD)
}

export interface CollectGosiResult {
  scanned: number; // 두 채널에서 훑은 항목 수
  newFound: number; // DB에 없던 신규 수
  kwPassed: number; // (환경청) 제목 키워드 통과 수 — 토지이음은 검색 자체가 필터라 전량
  inserted: number;
  byGrade: Record<IntelSignalGrade, number>;
  parseEmpty: boolean; // 두 채널 모두 0항목(사이트 개편 의심 → 알람)
}

export async function collectGosiSignals(opts: CollectGosiOptions = {}): Promise<CollectGosiResult> {
  const db = await getDb();
  const maxPages = opts.maxPagesPerKeyword && opts.maxPagesPerKeyword > 0 ? opts.maxPagesPerKeyword : 1;
  const eumKeywords = (Object.keys(EUM_KEYWORDS) as (keyof typeof EUM_KEYWORDS)[]).filter(
    (k) => !opts.eumKeywords || opts.eumKeywords.includes(k)
  );
  const rssEnabled = opts.rssEnabled !== false;
  const cutoffIso = opts.disclosureCutoffIso ?? null;

  const result: CollectGosiResult = {
    scanned: 0, newFound: 0, kwPassed: 0, inserted: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
    parseEmpty: false,
  };

  const seen = new Set(
    rowsToObjects(await db.exec(`SELECT external_id FROM intel_signals WHERE source = 'gosi'`)).map((r) =>
      String(r.external_id)
    )
  );

  // 1) 두 채널 수집(개별 실패는 로깅 후 계속)
  interface Prepared extends GosiItem { signalType: IntelSignalType; grade: IntelSignalGrade }
  const prepared: Prepared[] = [];
  let anyItems = false;

  for (const keyword of eumKeywords) {
    for (let page = 1; page <= maxPages; page++) {
      let items: GosiItem[];
      try {
        items = await fetchEumGosiList(keyword, page);
      } catch (err) {
        console.error(`[collect-gosi] 토지이음 fetch 실패 keyword=${keyword} page=${page}`, err);
        break;
      }
      await sleep(CHANNEL_THROTTLE_MS);
      if (!items.length) break;
      anyItems = true;
      result.scanned += items.length;
      for (const it of items) {
        if (seen.has(it.externalId)) continue;
        seen.add(it.externalId);
        result.newFound++;
        if (isOlderThanCutoff(it.publishedAt, cutoffIso)) continue;
        result.kwPassed++; // 검색 자체가 키워드 필터
        prepared.push({ ...it, ...classifyEumGosi(it.title) });
      }
    }
  }

  for (const office of rssEnabled ? ME_OFFICES : []) {
    let items: GosiItem[];
    try {
      items = await fetchMeOfficeRss(office);
    } catch (err) {
      console.error(`[collect-gosi] 환경청 RSS fetch 실패 orgCd=${office.orgCd}`, err);
      continue;
    }
    await sleep(CHANNEL_THROTTLE_MS);
    if (items.length) anyItems = true;
    result.scanned += items.length;
    for (const it of items) {
      if (seen.has(it.externalId)) continue;
      seen.add(it.externalId);
      result.newFound++;
      if (!ME_TITLE_RE.test(it.title)) continue;
      if (isOlderThanCutoff(it.publishedAt, cutoffIso)) continue;
      result.kwPassed++;
      const signalType: IntelSignalType = /산업단지|산단|농공단지|공장|제조/.test(it.title) ? "new_site" : "other";
      prepared.push({ ...it, signalType, grade: "monitoring" });
    }
  }
  result.parseEmpty = !anyItems;

  // 2) upsert (source='gosi'). 회사 매칭 없음 — 전건 unmatched 리드.
  const nowIso = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    // 사용자가 사유와 함께 삭제한 신호는 재수집하지 않는다(intel_signal_feedback)
    const blocklist = await loadFeedbackBlocklist(wdb);
    for (const p of prepared) {
      if (blocklist.has(feedbackKey("gosi", p.externalId))) continue;
      const raw = JSON.stringify({ channel: p.channel, agency: p.agency });
      const signalId = id("isig");
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, company_name, report_name, signal_type, signal_grade,
              disclosed_at, url, raw_json, region, agency,
              facility_id, match_status, match_type, status,
              industry, industry_relevance, created_at, updated_at)
           VALUES ($1,'gosi',$2,NULL,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,NULL,'unmatched','direct','new',
                   'industrial-complex','direct',$11,$11)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, p.externalId, p.title, p.signalType, p.grade,
            p.publishedAt, p.url, raw, p.region, p.agency, nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      result.inserted++;
      result.byGrade[p.grade]++;
      // 확정(신규 산단 지정·승인 고시)만 alerts 고지
      if (p.grade === "confirmed") {
        await wdb.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info','intel','gosi-signal',$1,$2,$3::jsonb,$4)`,
          [
            `${p.region ?? p.agency ?? "미상"} · 산단 고시 신호`,
            p.title,
            JSON.stringify({ signalId, channel: p.channel, grade: p.grade }),
            nowIso,
          ]
        );
      }
    }
    if (result.parseEmpty) {
      await wdb.run(
        `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
         VALUES ('warn','intel','gosi-parse-empty',$1,$2,$3::jsonb,$4)`,
        [
          "고시공고 수집 0건",
          "토지이음·환경청 RSS 모두에서 항목을 파싱하지 못했습니다. 사이트 개편(도메인 이관) 여부를 확인하세요.",
          JSON.stringify({}),
          nowIso,
        ]
      );
    }
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ('gosi',$1,$1,$1)
       ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [nowIso]
    );
  });

  return result;
}
