/**
 * 백필(과거 데이터 대량 수집) — 기간(from~to, "YYYY-MM")을 월 단위 청크로 끊어
 * 엔드포인트의 date_filters 를 청크 고정값으로 치환한 api_config 를 만든다.
 * 실행(sink 호출)은 라우트/배치가 담당(중단 재개는 backfill.cursor 로).
 */
import { formatDateForApi } from "./execute-api";
import type { ApiConfig, DateFilter } from "./types";

/** 현재 실행 중인 청크의 세부 진행 — 폴링 UI 진행률 바용(서버가 주기적으로 갱신). */
export interface ChunkProgress {
  /** 수집 중인 월("YYYY-MM") */
  chunk: string;
  /** fetch=API 페이지 수집 중, save=DB 저장 중 */
  phase: "fetch" | "save";
  /** 수집한 페이지 수 */
  page: number;
  /** 누적 조회 건수(fetch) 또는 저장 완료 건수(save) */
  items: number;
  /** save 단계의 전체 저장 대상 건수 */
  total?: number;
  /** 이 청크 시작 시각(ISO) — 경과 시간 표시·유휴 판정용 */
  started_at: string;
  updated_at: string;
}

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
  /** 실행 중인 청크의 세부 진행(없으면 대기/유휴). 청크 완료 시 제거. */
  chunk_progress?: ChunkProgress | null;
}

/** chunk_progress 가 살아있는 실행으로 볼 수 있는 시간(ms) — 컨테이너 재시작 등으로 남은 유령 상태 방어. */
export const CHUNK_PROGRESS_STALE_MS = 10 * 60 * 1000;

/** 진행 중 표시로 신뢰할 수 있는 chunk_progress 인지(오래된 것은 무시). */
export function isFreshProgress(p: ChunkProgress | null | undefined, now = Date.now()): boolean {
  if (!p?.updated_at) return false;
  const t = Date.parse(p.updated_at);
  return Number.isFinite(t) && now - t < CHUNK_PROGRESS_STALE_MS;
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
  const cfg: ApiConfig = { ...apiConfig, date_filters: dfs };
  // 한 청크(1개월)를 ALB 한도(300s) 안에 완주해야 한다 — 페이지당 건수를 크게(공공데이터포털
  // numOfRows 최대 999), 페이지 상한은 100(500건×100p=5만 건/월 커버, 소요 ~2분).
  if (cfg.pagination?.size_param) {
    cfg.pagination = {
      ...cfg.pagination,
      page_size: Math.max(cfg.pagination.page_size || 100, 500),
      max_pages: Math.max(cfg.pagination.max_pages || 1, 100),
    };
  } else if (cfg.pagination) {
    cfg.pagination = { ...cfg.pagination, max_pages: Math.max(cfg.pagination.max_pages || 1, 100) };
  }
  return cfg;
}
