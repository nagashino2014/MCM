// 보도자료 발주 신호 수집 오케스트레이션. 지자체·부처 보도자료 → 제목/부서 키워드 필터 →
// 본문 확보 → Haiku 분류(news-classifier 재사용) → facilities 매칭 → 적재.
// 뉴스 파이프라인과 동일 2트랙(matched 증설 / unmatched 신규 리드). source='press'.
// 네이버 뉴스와 같은 건이 중복될 수 있으나 소스가 달라 별도 저장(UI 소스 필터로 구분).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

import {
  fetchUlsanList,
  fetchJeonnamList,
  fetchGyeongbukList,
  fetchChungnamList,
  fetchGyeonggiList,
  fetchGyeongnamList,
  fetchJeonbukList,
  fetchMceeRss,
  fetchPressBody,
  PRESS_SOURCE_LABELS,
  type PressItem,
  type PressSourceKey,
} from "./press-client";
import { classifyNews, type NewsClassification } from "./news-classifier";
import { type IntelSignalGrade } from "./signal-extractor";
import { buildFacilityMatcher } from "./facility-matcher";
import { INTEL_COLLECT_DEFAULTS, isOlderThanCutoff, type IntelIndustryItem } from "./intel-settings";
import { EMPTY_INDUSTRY_TAG, industryTagForFacility, type IndustryTag } from "./industry-rules";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIST_THROTTLE_MS = 300;
const BODY_THROTTLE_MS = 300;
const HAIKU_THROTTLE_MS = 120;

// 제목/부서 키워드 필터 기본값은 intel-settings DEFAULTS — 설정(opts)으로 오버라이드 가능.
// 담당부서에 '투자'가 들어가면(투자유치과 등) 제목 무관 통과 — 부서 필드가 가장 강한 사전 신호.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keywordsToRe = (kws: string[]): RegExp | null =>
  kws.length ? new RegExp("(" + kws.map(escapeRe).join("|") + ")") : null;

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
  ["gyeongbuk", fetchGyeongbukList],
  ["chungnam", fetchChungnamList],
  ["gyeonggi", fetchGyeonggiList],
  ["gyeongnam", fetchGyeongnamList],
  ["jeonbuk", fetchJeonbukList],
  ["mcee", fetchMceeRss],
];

export interface CollectPressOptions {
  maxClassify?: number; // Haiku 분류 상한(비용·테스트 제어). 미지정=전량
  adapters?: Record<string, boolean>; // 지자체 어댑터별 사용 여부(설정 오버라이드)
  titleKeywords?: string[];
  deptKeywords?: string[];
  disclosureCutoffIso?: string | null; // 게재일 하한(YYYY-MM-DD)
  industries?: IntelIndustryItem[]; // 업종 태깅 후보군(설정). 미전달 시 태깅 생략
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
  const titleRe = keywordsToRe(opts.titleKeywords ?? INTEL_COLLECT_DEFAULTS.press.titleKeywords) ?? /(?:)/;
  const deptRe = keywordsToRe(opts.deptKeywords ?? INTEL_COLLECT_DEFAULTS.press.deptKeywords);
  const cutoffIso = opts.disclosureCutoffIso ?? null;
  const adapterEnabled = (key: PressSourceKey) => opts.adapters?.[key] !== false;

  const result: CollectPressResult = {
    scanned: 0, newFound: 0, kwPassed: 0, classified: 0, signals: 0,
    inserted: 0, matched: 0, newLead: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
  };

  // 1) facilities 매칭 모집단 — 공용 매처(법인격·사이트 접미사·음차·별칭 대응)
  const matcher = await buildFacilityMatcher(db);

  // 2) 기존 수집 URL(스킵용)
  const seen = new Set(
    rowsToObjects(await db.exec(`SELECT external_id FROM intel_signals WHERE source = 'press'`)).map((r) =>
      String(r.external_id)
    )
  );

  // 3) 어댑터별 리스트 → 신규 + 키워드/부서 통과만 후보로
  const candidates: PressItem[] = [];
  for (const [key, fetcher] of FETCHERS) {
    if (!adapterEnabled(key)) continue; // 설정에서 끈 어댑터
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
      if (!titleRe.test(it.title) && !(it.dept && deptRe && deptRe.test(it.dept))) continue;
      if (isOlderThanCutoff(it.publishedAt, cutoffIso)) continue;
      result.kwPassed++;
      candidates.push(it);
    }
  }

  // 4) 본문 확보 → Haiku 분류(뉴스 분류기 재사용) → 매칭 + 업종 태깅(매칭이면 facilities 우선)
  interface Prepared { it: PressItem; body: string | null; cls: NewsClassification; facilityId: string | null; tag: IndustryTag }
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
    const cls = await classifyNews(it.title, body ?? it.title, opts.industries);
    result.classified++;
    await sleep(HAIKU_THROTTLE_MS);
    if (!cls || !cls.isSignal) continue;
    result.signals++;
    const facilityId = matcher.matchName(cls.companyName)?.facilityId ?? null;
    const tag: IndustryTag = facilityId
      ? await industryTagForFacility(db, facilityId)
      : opts.industries?.length
        ? { industry: cls.industry, relevance: cls.industryRelevance, note: cls.relevanceNote }
        : EMPTY_INDUSTRY_TAG;
    prepared.push({ it, body, cls, facilityId, tag });
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
              facility_id, match_status, match_type, status,
              industry, industry_relevance, relevance_note, created_at, updated_at)
           VALUES ($1,'press',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'detailed',$12,$13,'direct','new',$14,$15,$16,$17,$17)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, p.it.url, p.cls.companyName, p.it.title, p.cls.signalType, grade,
            p.it.publishedAt, p.it.url, raw, p.cls.summary, PRESS_SOURCE_LABELS[p.it.sourceKey],
            p.facilityId, matched ? "matched" : "unmatched",
            p.tag.industry, p.tag.relevance, p.tag.note, nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      result.inserted++;
      result.byGrade[grade]++;
      if (matched) result.matched++;
      else result.newLead++;
      // 확정(high) + 대상 업종 유관(none/low 제외)만 alerts 고지(뉴스·EIASS 와 동일 정책)
      if (grade === "confirmed" && p.tag.relevance !== "none" && p.tag.relevance !== "low") {
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
