// 엔지니어링 노임단가 자동 갱신 — 한국엔지니어링협회가 매년 1/1 적용 기준으로 공표하는
// 임금실태조사 결과(부문별×등급별 일단가)를 웹에서 탐색해 quote_labor_rates 에 적재한다.
// 사용자 확정(2026-08-05): 매년 1월 자동 탐색을 데이터 확보까지 반복. 구현은 rate-set API
// 진입 시 lazy 트리거(당해 연도 단가 없음 + 오늘 미시도 → fire-and-forget, 하루 1회 가드)
// — 1/15 이후에도 확보 전이면 계속 재시도하므로 "얻을 때까지 반복" 요구를 상회 충족.
// 공표 원문이 PDF/HWP 인 경우가 많아 후보 재게시 페이지(HTML)를 순회하며 관대한 파서로
// 추출하고, 전년 대비 ±30% 새너티 검증을 통과해야만 적재한다(오탐 방지).

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { LABOR_GRADES } from "./types";

/** 후보 소스 — 협회 공표를 표/텍스트로 재게시하는 페이지들. 구조 변화에 대비해 복수 유지.
 *  {year}는 적용 연도로 치환. 실패 시 다음 후보로 넘어가고, 전부 실패하면 로그만 남긴다. */
const CANDIDATE_URLS: string[] = [
  "https://www.kpi.or.kr/www/price/wage_basis.asp?CATE_CD=701318",
  "https://www.engcost.or.kr/getbbsList.do?nm=%EC%97%94%EC%A7%80%EB%8B%88%EC%96%B4%EB%A7%81+%EB%85%B8%EC%9E%84%EB%8B%A8%EA%B0%80&id=030200&page=1",
  "https://www.kseis.co.kr/bbs/data/dataList.do",
];

const FETCH_TIMEOUT_MS = 12_000;

async function fetchText(url: string): Promise<string | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MCM-labor-sync)" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * 관대한 파서 — HTML/텍스트에서 '환경' 부문 구간(없으면 문서 전체)을 대상으로
 * 등급 키워드(기술사/특급/고급/중급/초급) 뒤에 나오는 6~7자리 금액을 추출한다.
 */
export function parseLaborRates(html: string): Record<string, number> | null {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
  // '환경' 부문 구간 우선(부문별 표) — 환경 키워드 이후 600자 조각
  const envIdx = text.indexOf("환경");
  const scopes = envIdx >= 0 ? [text.slice(envIdx, envIdx + 600), text] : [text];
  for (const scope of scopes) {
    const out: Record<string, number> = {};
    for (const grade of LABOR_GRADES) {
      // 예: "기술사 456,273" / "특급기술자: 362,012원"
      const m = new RegExp(`${grade}[^0-9]{0,14}([1-9]\\d{2}[,.]?\\d{3})`).exec(scope);
      if (!m) break;
      out[grade] = Number(m[1].replace(/[,.]/g, ""));
    }
    if (Object.keys(out).length === LABOR_GRADES.length) return out;
  }
  return null;
}

/** 새너티 검증 — 전년 단가 대비 ±30% 이내 + 등급 순서 단조 감소(기술사 > 초급) */
function sane(rates: Record<string, number>, prev: Record<string, number> | null): boolean {
  const ordered = LABOR_GRADES.map((g) => rates[g]);
  for (let i = 1; i < ordered.length; i++) {
    if (!(ordered[i] > 50_000 && ordered[i] < ordered[i - 1])) return false;
  }
  if (prev) {
    for (const g of LABOR_GRADES) {
      if (prev[g] && Math.abs(rates[g] - prev[g]) / prev[g] > 0.3) return false;
    }
  }
  return true;
}

/**
 * 당해 연도 노임단가 자동 확보 시도 — rate-set API 가 fire-and-forget 으로 호출.
 * 하루 1회 가드(sync_log PK). 이미 확보돼 있으면 no-op.
 */
export async function trySyncLaborRates(year: string): Promise<void> {
  const db = await getDb();
  const existing = rowsToObjects(await db.exec(`SELECT count(*) AS n FROM quote_labor_rates WHERE year = $1`, [year]));
  if (Number(existing[0]?.n ?? 0) >= LABOR_GRADES.length) return;

  const today = new Date().toISOString().slice(0, 10);
  // 하루 1회 가드 — 선점 insert 실패(충돌)면 오늘 이미 시도함
  let claimed = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `INSERT INTO quote_labor_rate_sync_log (year, tried_date, ok) VALUES ($1, $2, 0)
         ON CONFLICT (year, tried_date) DO NOTHING RETURNING year`,
        [year, today]
      )
    );
    claimed = rows.length > 0;
  });
  if (!claimed) return;

  const prevRows = rowsToObjects(
    await db.exec(`SELECT grade, daily_rate FROM quote_labor_rates WHERE year = (SELECT max(year) FROM quote_labor_rates WHERE year < $1)`, [year])
  );
  const prev: Record<string, number> | null = prevRows.length
    ? Object.fromEntries(prevRows.map((r) => [String(r.grade), Number(r.daily_rate)]))
    : null;

  for (const url of CANDIDATE_URLS) {
    const html = await fetchText(url);
    if (!html) continue;
    // 당해 연도 표기가 없는 페이지(옛 자료)는 스킵
    if (!html.includes(year)) continue;
    const rates = parseLaborRates(html);
    if (!rates || !sane(rates, prev)) continue;

    await withDbWrite(async (txn) => {
      for (const g of LABOR_GRADES) {
        await txn.run(
          `INSERT INTO quote_labor_rates (year, grade, daily_rate, source_note)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (year, grade) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, source_note = EXCLUDED.source_note`,
          [year, g, rates[g], `자동 수집 (${url}), ${year}-01-01 적용`]
        );
      }
      await txn.run(`UPDATE quote_labor_rate_sync_log SET ok = 1, source_url = $3 WHERE year = $1 AND tried_date = $2`, [year, today, url]);
    });
    console.log(`[quote] ${year}년 노임단가 자동 적재 완료: ${url}`);
    return;
  }
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE quote_labor_rate_sync_log SET detail = '후보 소스 전체 실패(내일 재시도)' WHERE year = $1 AND tried_date = $2`, [year, today]);
  });
  console.warn(`[quote] ${year}년 노임단가 자동 수집 실패 — 내일 재시도(수동 입력 가능)`);
}
