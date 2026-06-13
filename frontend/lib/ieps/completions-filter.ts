import type { ContractCompletionRow } from "./completions-types";

export interface CompletionsFilter {
  /** 대쉬보드 5대 분류 (null = 전체) */
  category?: string | null;
  /** 용역 세분류 (통합환경허가 선택 시에만 유효, null = 전체) */
  subtype?: string | null;
  /** 계약일 기준 연도 (YYYY, null = 전체) */
  year?: string | null;
}

/** 완료 리스트 공통 필터 — 클라이언트 UI와 export 라우트에서 동일하게 사용 */
export function filterCompletionRows(
  rows: ContractCompletionRow[],
  filter: CompletionsFilter
): ContractCompletionRow[] {
  return rows.filter((row) => {
    if (filter.category && row.category !== filter.category) return false;
    if (filter.subtype && row.subtype !== filter.subtype) return false;
    if (filter.year && /^\d{4}$/.test(filter.year)) {
      if ((row.contractDate ?? "").slice(0, 4) !== filter.year) return false;
    }
    return true;
  });
}
