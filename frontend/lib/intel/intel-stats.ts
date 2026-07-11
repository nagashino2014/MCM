// 발주 정보 수집현황 통계 — "API&스크래핑" 우측 패널용.
// 기간 기준은 수집일(created_at). "채택" = 영업건 전환(converted) 또는 등급 confirmed.

import { getDb, rowsToObjects } from "@/lib/db";

/** 통계 소스 키 — gosi 는 채널로 분리(gosi_eum=토지이음, gosi_me=유역청). */
export const INTEL_STAT_SOURCES = ["dart", "eiass", "press", "news", "gosi_eum", "gosi_me"] as const;
export type IntelStatSource = (typeof INTEL_STAT_SOURCES)[number];

export interface IntelSourceStat {
  collected: number;
  adopted: number;
}

export interface IntelBreakdownRow {
  source: string;
  signalType: string;
  matchStatus: string;
  status: string;
  grade: string;
  count: number;
}

export interface IntelDailyRow {
  /** 수집일 'YYYY-MM-DD' */
  date: string;
  collected: number;
  confirmed: number;
  candidate: number;
  /** 채택 = converted 또는 confirmed */
  adopted: number;
  bySource: Record<string, number>;
}

export interface IntelStats {
  /** 기간 내 소스별 수집·채택 */
  bySource: Record<string, IntelSourceStat>;
  total: IntelSourceStat;
  /** to 월 기준 최근 6개월 월별 수집·채택 (month = 'YYYY-MM') */
  monthly: Array<{ month: string; collected: number; adopted: number }>;
  /** 기간 내 소스×유형×매칭×상태×등급 조합별 건수 (세부 유형 차트는 클라에서 축별 합산) */
  breakdown: IntelBreakdownRow[];
  /** 최근 14일 일별 수집 로그(기간 파라미터와 무관 — 야간 배치 결과 확인용) */
  daily: IntelDailyRow[];
}

const SRC_EXPR = `CASE WHEN s.source = 'gosi'
  THEN 'gosi_' || COALESCE(s.raw_json->>'channel','me')
  ELSE s.source END`;
const ADOPTED_EXPR = `(s.status = 'converted' OR s.signal_grade = 'confirmed')`;

/** from/to: 'YYYY-MM-DD' (수집일 기준, 양끝 포함) */
export async function getIntelStats(from: string, to: string): Promise<IntelStats> {
  const db = await getDb();
  const range = `substr(s.created_at,1,10) BETWEEN $1 AND $2`;

  const srcRows = rowsToObjects(
    await db.exec(
      `SELECT ${SRC_EXPR} AS src,
              COUNT(*)::int AS collected,
              COUNT(*) FILTER (WHERE ${ADOPTED_EXPR})::int AS adopted
         FROM intel_signals s
        WHERE ${range}
        GROUP BY 1`,
      [from, to]
    )
  );
  const bySource: Record<string, IntelSourceStat> = {};
  const total: IntelSourceStat = { collected: 0, adopted: 0 };
  for (const r of srcRows) {
    const stat = { collected: Number(r.collected ?? 0), adopted: Number(r.adopted ?? 0) };
    bySource[String(r.src)] = stat;
    total.collected += stat.collected;
    total.adopted += stat.adopted;
  }

  // 월별 추이: to 월 포함 최근 6개월
  const toMonth = to.slice(0, 7);
  const fromDate = new Date(`${toMonth}-01T00:00:00Z`);
  fromDate.setUTCMonth(fromDate.getUTCMonth() - 5);
  const monthFloor = fromDate.toISOString().slice(0, 7);
  const monthRows = rowsToObjects(
    await db.exec(
      `SELECT substr(s.created_at,1,7) AS month,
              COUNT(*)::int AS collected,
              COUNT(*) FILTER (WHERE ${ADOPTED_EXPR})::int AS adopted
         FROM intel_signals s
        WHERE substr(s.created_at,1,7) BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 1`,
      [monthFloor, toMonth]
    )
  );
  // 빈 달도 0으로 채워 축이 끊기지 않게 한다
  const monthly: IntelStats["monthly"] = [];
  const byMonth = new Map(monthRows.map((r) => [String(r.month), r]));
  const cursor = new Date(`${monthFloor}-01T00:00:00Z`);
  for (let i = 0; i < 6; i++) {
    const m = cursor.toISOString().slice(0, 7);
    const row = byMonth.get(m);
    monthly.push({
      month: m,
      collected: Number(row?.collected ?? 0),
      adopted: Number(row?.adopted ?? 0),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const bdRows = rowsToObjects(
    await db.exec(
      `SELECT ${SRC_EXPR} AS src, s.signal_type, s.match_status, s.status, s.signal_grade,
              COUNT(*)::int AS count
         FROM intel_signals s
        WHERE ${range}
        GROUP BY 1, 2, 3, 4, 5`,
      [from, to]
    )
  );
  const breakdown: IntelBreakdownRow[] = bdRows.map((r) => ({
    source: String(r.src),
    signalType: String(r.signal_type ?? "other"),
    matchStatus: String(r.match_status ?? "unmatched"),
    status: String(r.status ?? "new"),
    grade: String(r.signal_grade ?? "candidate"),
    count: Number(r.count ?? 0),
  }));

  // 일별 수집 로그: 조회 기간과 무관하게 최근 14일(야간 배치 결과 확인용)
  const dailyFloor = new Date();
  dailyFloor.setUTCDate(dailyFloor.getUTCDate() - 13);
  const dailyRows = rowsToObjects(
    await db.exec(
      `SELECT substr(s.created_at,1,10) AS day, ${SRC_EXPR} AS src,
              COUNT(*)::int AS collected,
              COUNT(*) FILTER (WHERE s.signal_grade = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE s.signal_grade = 'candidate')::int AS candidate,
              COUNT(*) FILTER (WHERE ${ADOPTED_EXPR})::int AS adopted
         FROM intel_signals s
        WHERE substr(s.created_at,1,10) >= $1
        GROUP BY 1, 2 ORDER BY 1 DESC`,
      [dailyFloor.toISOString().slice(0, 10)]
    )
  );
  const dailyMap = new Map<string, IntelDailyRow>();
  for (const r of dailyRows) {
    const date = String(r.day);
    let row = dailyMap.get(date);
    if (!row) {
      row = { date, collected: 0, confirmed: 0, candidate: 0, adopted: 0, bySource: {} };
      dailyMap.set(date, row);
    }
    const c = Number(r.collected ?? 0);
    row.collected += c;
    row.confirmed += Number(r.confirmed ?? 0);
    row.candidate += Number(r.candidate ?? 0);
    row.adopted += Number(r.adopted ?? 0);
    row.bySource[String(r.src)] = c;
  }
  const daily = [...dailyMap.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  return { bySource, total, monthly, breakdown, daily };
}

export interface IntelCollectState {
  source: string;
  lastRunAt: string | null;
  lastCursor: string | null;
}

/** 소스별 마지막 수집 실행 시각 (수동 실행 패널 표시용). */
export async function listIntelCollectState(): Promise<IntelCollectState[]> {
  const db = await getDb();
  try {
    const rows = rowsToObjects(
      await db.exec(`SELECT source, last_run_at, last_cursor FROM intel_collect_state ORDER BY source`)
    );
    return rows.map((r) => ({
      source: String(r.source ?? ""),
      lastRunAt: r.last_run_at == null ? null : String(r.last_run_at),
      lastCursor: r.last_cursor == null ? null : String(r.last_cursor),
    }));
  } catch {
    return [];
  }
}
