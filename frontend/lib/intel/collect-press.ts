// 보도자료 발주 신호 수집 오케스트레이션. 지자체·부처 보도자료 → 제목/부서 키워드 필터 →
// 본문 확보 → Haiku 분류(news-classifier 재사용) → facilities 매칭 → 적재.
// 뉴스 파이프라인과 동일 2트랙(matched 증설 / unmatched 신규 리드). source='press'.
// 네이버 뉴스와 같은 건이 중복될 수 있으나 소스가 달라 별도 저장(UI 소스 필터로 구분).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/ieps/formatters";
import {
  fetchUlsanList,
  fetchJeonnamList,
  fetchMceeRss,
  fetchPressBody,
  PRESS_SOURCE_LABELS,
  type PressItem,
  type PressSourceKey,
} from "./press-client";
import { classifyNews, type NewsClassification } from "./news-classifier";
import { coreCompanyName, isProcurementProxy, type IntelSignalGrade } from "./signal-extractor";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIST_THROTTLE_MS = 300;
const BODY_THROTTLE_MS = 300;
const HAIKU_THROTTLE_MS = 120;

// 제목 키워드 필터: 투자·공장 신증설 정황만 본문·Haiku 로 넘긴다(지자체 보도자료 대부분은 행정 홍보).
// 담당부서에 '투자'가 들어가면(투자유치과 등) 제목 무관 통과 — 부서 필드가 가장 강한 사전 신호.
const TITLE_RE = /(투자협약|투자유치|투자 유치|MOU|양해각서|공장|증설|신설|착공|산업단지|산단|생산시설|생산라인|유치 협약|투자)/;
const DEPT_RE = /(투자|기업유치)/;

// Haiku confidence → 신호 등급(뉴스와 동일 매핑)
const GRADE_BY_CONFIDENCE: Record<NewsClassification["confidence"], IntelSignalGrade> = {
  high: "confirmed",
  medium: "candidate",
  low: "monitoring",
};

type Fetcher = () => Promise<PressItem[]>;
const FETCHERS: [PressSourceKey, Fetcher][] = [
  ["ulsan", fetchUlsanList],
  ["jeonnam", fetchJeonnamList],
  ["mcee", fetchMceeRss],
];

export interface CollectPressOptions {
  maxClassify?: number; // Haiku 분류 상한(비용·테스트 제어). 미지정=전량
}

export interface CollectPressResult {
  scanned: number; // 어댑터에서 모은 보도자료 수
  newFound: number; // DB에 없던 신규 수
  kwPassed: number; // 제목/부서 필터 통과 수
  classified: number; // Haiku 분류 수
  signals: number; // isSignal=true 수
  inserted: number; // 신규 저장
  matched: number; // facilities 매칭(트랙A) 수
  newLead: number; // 미매칭(트랙B 신규 리드) 수
  byGrade: Record<IntelSignalGrade, number>;
}

export async function collectPressSignals(opts: CollectPressOptions = {}): Promise<CollectPressResult> {
  const db = await getDb();
  const maxClassify = opts.maxClassify != null && opts.maxClassify >= 0 ? opts.maxClassify : Infinity;

  const result: CollectPressResult = {
    scanned: 0, newFound: 0, kwPassed: 0, classified: 0, signals: 0,
    inserted: 0, matched: 0, newLead: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
  };

  // 1) facilities 코어명 매칭 집합(보도자료는 BRN 없어 회사명 매칭 — 뉴스와 동일)
  const facRows = rowsToObjects(
    await db.exec(`SELECT facility_id, company_name, normalized_company_name FROM facilities`)
  );
  const coreToFac = new Map<string, string>();
  for (const r of facRows) {
    const cname = String(r.company_name ?? "");
    const nm = r.normalized_company_name ? String(r.normalized_company_name).trim() : "";
    if (isProcurementProxy(cname) || isProcurementProxy(nm)) continue;
    const core = coreCompanyName(nm || cname);
    if (core.length >= 3 && !coreToFac.has(core)) coreToFac.set(core, String(r.facility_id));
  }

  // 2) 기존 수집 URL(스킵용)
  const seen = new Set(
    rowsToObjects(await db.exec(`SELECT external_id FROM intel_signals WHERE source = 'press'`)).map((r) =>
      String(r.external_id)
    )
  );

  // 3) 어댑터별 리스트 → 신규 + 키워드/부서 통과만 후보로
  const candidates: PressItem[] = [];
  for (const [key, fetcher] of FETCHERS) {
    let items: PressItem[];
    try {
      items = await fetcher();
    } catch (err) {
      console.error(`[collect-press] list fetch 실패 source=${key}`, err);
      continue; // 개별 어댑터 실패는 다음 어댑터로
    }
    await sleep(LIST_THROTTLE_MS);
    result.scanned += items.length;
    for (const it of items) {
      if (!it.url || seen.has(it.url)) continue;
      seen.add(it.url);
      result.newFound++;
      if (!TITLE_RE.test(it.title) && !(it.dept && DEPT_RE.test(it.dept))) continue;
      result.kwPassed++;
      candidates.push(it);
    }
  }

  // 4) 본문 확보 → Haiku 분류(뉴스 분류기 재사용) → 매칭
  interface Prepared { it: PressItem; body: string | null; cls: NewsClassification; facilityId: string | null }
  const prepared: Prepared[] = [];
  for (const it of candidates) {
    if (result.classified >= maxClassify) break;
    let body: string | null = it.body;
    if (!body) {
      try {
        body = await fetchPressBody(it);
      } catch (err) {
        console.error(`[collect-press] body fetch 실패 url=${it.url}`, err);
        body = null; // 본문 실패 시 제목만으로 분류
      }
      await sleep(BODY_THROTTLE_MS);
    }
    const cls = await classifyNews(it.title, body ?? it.title);
    result.classified++;
    await sleep(HAIKU_THROTTLE_MS);
    if (!cls || !cls.isSignal) continue;
    result.signals++;
    let facilityId: string | null = null;
    if (cls.companyName && !isProcurementProxy(cls.companyName)) {
      const core = coreCompanyName(normalizeCompanyName(cls.companyName) ?? cls.companyName);
      if (core.length >= 3) facilityId = coreToFac.get(core) ?? null;
    }
    prepared.push({ it, body, cls, facilityId });
  }

  // 5) upsert (source='press'). press 컬럼=발표 주체 라벨, 원문·분류는 raw_json.
  const nowIso = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    for (const p of prepared) {
      const grade = GRADE_BY_CONFIDENCE[p.cls.confidence];
      const matched = !!p.facilityId;
      const raw = JSON.stringify({
        sourceKey: p.it.sourceKey, dept: p.it.dept, body: p.body, classification: p.cls,
      });
      const signalId = id("isig");
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, company_name, report_name, signal_type, signal_grade,
              disclosed_at, url, raw_json, summary, press, news_stage,
              facility_id, match_status, match_type, status, created_at, updated_at)
           VALUES ($1,'press',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'detailed',$12,$13,'direct','new',$14,$14)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, p.it.url, p.cls.companyName, p.it.title, p.cls.signalType, grade,
            p.it.publishedAt, p.it.url, raw, p.cls.summary, PRESS_SOURCE_LABELS[p.it.sourceKey],
            p.facilityId, matched ? "matched" : "unmatched", nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      result.inserted++;
      result.byGrade[grade]++;
      if (matched) result.matched++;
      else result.newLead++;
      // 확정(high)만 alerts 고지(뉴스·EIASS 와 동일 정책)
      if (grade === "confirmed") {
        await wdb.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info','intel','press-signal',$1,$2,$3::jsonb,$4)`,
          [
            `${p.cls.companyName ?? "미상"} · ${PRESS_SOURCE_LABELS[p.it.sourceKey]} 보도자료 신호`,
            p.cls.summary ?? p.it.title,
            JSON.stringify({ signalId, facilityId: p.facilityId, signalType: p.cls.signalType, grade, track: matched ? "A" : "B" }),
            nowIso,
          ]
        );
      }
    }
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ('press',$1,$1,$1)
       ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [nowIso]
    );
  });

  return result;
}
