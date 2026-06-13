import type { ContractUnbilledRow } from "./unbilled-types";

export interface UnbilledFilter {
  /** 대쉬보드 5대 분류 (null = 전체) */
  category?: string | null;
  /** 계약일 기준 연도 (YYYY, null = 전체) */
  year?: string | null;
}

/** 미발행 리스트 공통 필터 — 클라이언트 UI와 export 라우트에서 동일하게 사용 */
export function filterUnbilledRows(
  rows: ContractUnbilledRow[],
  filter: UnbilledFilter
): ContractUnbilledRow[] {
  return rows.filter((row) => {
    if (filter.category && row.category !== filter.category) return false;
    if (filter.year && /^\d{4}$/.test(filter.year)) {
      if ((row.contractDate ?? "").slice(0, 4) !== filter.year) return false;
    }
    return true;
  });
}
