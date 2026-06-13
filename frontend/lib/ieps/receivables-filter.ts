import type { ContractReceivableRow } from "./receivables-types";

/** 경과 기간 필터: 전체 / 2개월 미만 / 2개월 이상 */
export type ReceivableAgingFilter = "all" | "under2" | "over2";

export interface ReceivablesFilter {
  /** 대쉬보드 5대 분류 (null = 전체 용역) */
  category?: string | null;
  aging?: ReceivableAgingFilter | null;
}

export function filterReceivableRows(
  rows: ContractReceivableRow[],
  filter: ReceivablesFilter
): ContractReceivableRow[] {
  const { category, aging } = filter;
  return rows.filter((row) => {
    if (category && row.category !== category) return false;
    if (aging === "under2" && row.agingMonths >= 2) return false;
    if (aging === "over2" && row.agingMonths < 2) return false;
    return true;
  });
}
