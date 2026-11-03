// 뉴스 기간 다시 수집 — 야간 배치가 멈췄던 기간의 기사를 되찾는다(2026-10 intel 배치 한 달 중단 후속).
// 네이버 뉴스 검색 API 는 검색어당 최신 1,100건(start≤1000 + display 100)까지만 돌려줘, 기사가 많은
// 키워드는 며칠 전까지만 닿는다. 그래서 기본 키워드가 기간 시작에 닿지 못하면 업종어 → 지역어를 붙여
// 검색어를 좁혀(결과가 줄어 더 과거까지 닿는다) 기간 안의 기사를 모은다. 분류·적재는 야간 수집과 같은
// classifyAndStoreNews 를 묶음(200건)마다 호출한다 — 중간에 멈춰도 그때까지는 적재된다.

import { getDb, rowsToObjects } from "@/lib/db";
import { searchNews, type NewsItem } from "./naver-news-client";
import { classifyAndStoreNews, type CollectNewsResult } from "./collect-news";
import { buildFacilityMatcher } from "./facility-matcher";
import { formatFeedbackExamples, loadFeedbackExamples } from "./intel-feedback";
import type { IntelIndustryItem } from "./intel-settings";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NAVER_THROTTLE_MS = 200;
const PAGE = 100;
const MAX_START = 1000; // 네이버 API start 상한
const STORE_CHUNK = 200;

/** 1단계 분할어 — 설비투자 기사에 자주 나오는 업종·시설 낱말. */
export const BACKFILL_INDUSTRY_TERMS = [
  "반도체", "이차전지", "배터리", "디스플레이", "석유화학", "화학", "소재", "철강", "금속", "자동차",
  "부품", "조선", "기계", "전자", "전기", "제약", "바이오", "의약품", "식품", "음료",
  "제지", "섬유", "시멘트", "유리", "타이어", "플라스틱", "화장품", "의료기기", "방산", "수소",
  "태양광", "에너지", "발전", "폐기물", "재활용", "데이터센터", "물류", "스마트팩토리", "산업단지", "농공단지",
];
/** 2단계 분할어 — 1단계로도 기간 시작에 못 닿는 검색어(예: 반도체)에 붙인다. */
export const BACKFILL_REGION_TERMS = [
  "서울", "경기", "인천", "강원", "충북", "충남", "대전", "세종", "전북", "전남",
  "광주", "경북", "경남", "대구", "부산", "울산", "제주", "평택", "용인", "화성",
  "이천", "구미", "포항", "여수", "광양", "당진", "청주", "천안", "창원", "새만금",
  "미국", "베트남", "인도", "멕시코", "유럽",
];

export interface NewsBackfillOptions {
  /** KST 날짜 YYYY-MM-DD(포함) */
  from: string;
  to: string;
  keywords: string[];
  industries?: IntelIndustryItem[];
  /** 분류 상한(안전장치). 미지정=무제한 */
  maxClassify?: number;
  /** true 면 검색만 하고 분류·적재하지 않는다(건수 추정용) */
  dryRun?: boolean;
  /** dryRun 에서 DB 없이 돌릴 때 기수집 link 집합을 생략 */
  skipSeen?: boolean;
  log?: (line: string) => void;
}

export interface NewsBackfillResult extends CollectNewsResult {
  queries: number;
  apiCalls: number;
  /** 2단계까지 쪼개도 기간 시작에 못 닿은 검색어(누락 가능 구간) */
  incomplete: Array<{ query: string; oldest: string }>;
  /** 기간 안 후보(기수집 제외 전)·분류 대상(제외 후) — 발행일(KST)별 */
  byDay: Record<string, number>;
}

/** ISO → KST YYYY-MM-DD */
function kstDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10) : "";
}

/**
 * 검색어 하나를 최신순으로 넘기며 기간 안 기사를 모은다. 기간 시작보다 오래된 기사가 나오면 멈춘다.
 * reached=false 면 API 상한(1,100건) 안에서 기간 시작에 닿지 못한 것 — 검색어를 더 좁혀야 한다.
 */
async function sweep(
  query: string,
  from: string,
  to: string,
  out: Map<string, NewsItem>,
  stats: { apiCalls: number; errors: number; lastError: string }
): Promise<{ reached: boolean; oldest: string; error?: string }> {
  let oldest = "";
  for (let start = 1; start <= MAX_START; start += PAGE) {
    let items: NewsItem[] = [];
    let error = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ({ items } = await searchNews(query, { display: PAGE, start, sort: "date" }));
        error = "";
        break;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        await sleep(2000 * (attempt + 1));
      }
    }
    if (error) {
      // 실패를 "기간 시작에 닿음"으로 삼키지 않는다 — 미도달로 남겨 결과에 드러낸다.
      stats.errors++;
      stats.lastError = error.slice(0, 300);
      return { reached: false, oldest, error };
    }
    stats.apiCalls++;
    await sleep(NAVER_THROTTLE_MS);
    for (const it of items) {
      const day = kstDay(it.pubDate);
      if (!day) continue;
      oldest = day;
      if (day < from) return { reached: true, oldest };
      if (day <= to && it.link && !out.has(it.link)) out.set(it.link, it);
    }
    if (items.length < PAGE) return { reached: true, oldest }; // 결과 소진
  }
  return { reached: false, oldest };
}

export async function collectNewsBackfill(opts: NewsBackfillOptions): Promise<NewsBackfillResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const result: NewsBackfillResult = {
    scanned: 0, classified: 0, failed: 0, skipped: 0, signals: 0, inserted: 0, matched: 0, newLead: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
    queries: 0, apiCalls: 0, incomplete: [], byDay: {},
  };
  const stats = { apiCalls: 0, errors: 0, lastError: "" };
  const found = new Map<string, NewsItem>();

  // 1) 기본 키워드 → (못 닿으면) 업종어 → (그래도 못 닿으면) 지역어
  for (const kw of opts.keywords) {
    result.queries++;
    const base = await sweep(kw, opts.from, opts.to, found, stats);
    if (base.error) {
      result.incomplete.push({ query: kw, oldest: `오류: ${base.error.slice(0, 200)}` });
      continue;
    }
    if (base.reached) {
      log(`[news-backfill] 검색 ${kw}: 기본 키워드로 도달 · 누적 후보 ${found.size}건`);
      continue;
    }
    for (const ind of BACKFILL_INDUSTRY_TERMS) {
      const q1 = `${kw} ${ind}`;
      result.queries++;
      const r1 = await sweep(q1, opts.from, opts.to, found, stats);
      if (r1.error) { result.incomplete.push({ query: q1, oldest: `오류: ${r1.error.slice(0, 200)}` }); continue; }
      if (r1.reached) continue;
      for (const region of BACKFILL_REGION_TERMS) {
        const q2 = `${q1} ${region}`;
        result.queries++;
        const r2 = await sweep(q2, opts.from, opts.to, found, stats);
        if (!r2.reached) result.incomplete.push({ query: q2, oldest: r2.oldest });
      }
    }
    log(`[news-backfill] 검색 ${kw}: 누적 후보 ${found.size}건 · API ${stats.apiCalls}회`);
  }
  result.apiCalls = stats.apiCalls;
  // 검색이 전부 실패했으면 "후보 0건 완료"로 끝내지 않는다.
  if (stats.apiCalls === 0 && stats.errors > 0) throw new Error(`네이버 검색 전부 실패: ${stats.lastError}`);

  // 2) 기수집 link 제외 → 발행일 순(오래된 것부터) 정렬
  let news = [...found.values()];
  if (!opts.skipSeen) {
    const db = await getDb();
    const seen = new Set(
      rowsToObjects(await db.exec(`SELECT external_id FROM intel_signals WHERE source = 'news'`)).map((r) => String(r.external_id))
    );
    news = news.filter((it) => !seen.has(it.link));
  }
  news.sort((a, b) => a.pubDate.localeCompare(b.pubDate));
  for (const it of news) {
    const d = kstDay(it.pubDate);
    result.byDay[d] = (result.byDay[d] ?? 0) + 1;
  }
  result.scanned = news.length;
  log(`[news-backfill] 기간 ${opts.from}~${opts.to} 후보 ${found.size}건 → 분류 대상 ${news.length}건(기수집 제외) · 검색어 ${result.queries}개 · 미도달 ${result.incomplete.length}개`);
  if (opts.dryRun) return result;

  // 3) 묶음마다 분류·적재(야간 수집과 같은 경로)
  const db = await getDb();
  const ctx = {
    matcher: await buildFacilityMatcher(db),
    feedbackBlock: formatFeedbackExamples(await loadFeedbackExamples(db, "news")),
  };
  const maxClassify = opts.maxClassify ?? Infinity;
  for (let i = 0; i < news.length && result.classified < maxClassify; i += STORE_CHUNK) {
    await classifyAndStoreNews(db, news.slice(i, i + STORE_CHUNK), { industries: opts.industries, maxClassify }, result, ctx);
    log(`[news-backfill] 진행 ${Math.min(i + STORE_CHUNK, news.length)}/${news.length} · 분류 ${result.classified} · 신호 ${result.signals} · 적재 ${result.inserted} · 실패 ${result.failed}`);
  }
  return result;
}
