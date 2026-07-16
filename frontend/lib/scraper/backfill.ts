/**
 * 백필(과거 데이터 대량 수집) — 기간(from~to, "YYYY-MM")을 월 단위 청크로 끊어
 * 엔드포인트의 date_filters 를 청크 고정값으로 치환한 api_config 를 만든다.
 * 실행(sink 호출)은 라우트/배치가 담당(중단 재개는 backfill.cursor 로).
 */
import { formatDateForApi } from "./execute-api";
import type { ApiConfig, DateFilter } from "./types";

/** scraper_endpoints.backfill jsonb. */
export interface BackfillState {
  /** "YYYY-MM" */
  from: string;
  /** "YYYY-MM" (포함) */
  to: string;
  /** 다음에 수집할 월("YYYY-MM"). from~to 밖이면 완료. */
  cursor: string;
  status: "running" | "done" | "idle";
  updated_at?: string;
  last_result?: { chunk: string; scanned: number; inserted: number; updated: number; error?: string };
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidYm(s: string): boolean {
  return YM_RE.test(s);
}

/** "YYYY-MM" → 다음 달 "YYYY-MM". */
export function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** from~to(포함) 총 개월 수. 잘못된 범위면 0. */
export function totalMonths(from: string, to: string): number {
  if (!isValidYm(from) || !isValidYm(to)) return 0;
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const n = (ty - fy) * 12 + (tm - fm) + 1;
  return n > 0 ? n : 0;
}

/** 진행 개월 수(cursor 직전까지 완료). */
export function doneMonths(from: string, cursor: string): number {
  return Math.max(0, totalMonths(from, cursor) - 1);
}

/**
 * 엔드포인트 api_config 의 date_filters 를 청크 월(ym)의 고정 기간으로 치환한 복제본을 만든다.
 * 시작류 필드(bgn/start/from)는 월초, 종료류(end/to)는 월말(endOfDay). 그 외는 월초.
 * 필드 판별은 applyDateFilters 와 동일 규칙이므로 start/end 양쪽에 각각 알맞은 값을 넣는다.
 */
export function buildChunkConfig(apiConfig: ApiConfig, ym: string): ApiConfig {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0); // 해당 월 말일
  const dfs: DateFilter[] = (apiConfig.date_filters ?? []).map((df) => ({
    field: df.field,
    format: df.format,
    // relative_days 제거 → start/end 고정값 사용(applyDateFilters 규칙: start류→start_date, end류→end_date)
    start_date: formatDateForApi(first, df.format),
    end_date: formatDateForApi(last, df.format, true),
  }));
  return { ...apiConfig, date_filters: dfs };
}
