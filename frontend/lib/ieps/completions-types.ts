// 완료 현황 — 클라이언트/서버 공용 타입.
// (서버 전용 로직은 completions-status.ts — pg 의존성이 있어 클라이언트에서 import 금지)

export interface ContractCompletionRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  /** 대쉬보드 5대 분류로 정규화된 용역분류 */
  category: string;
  /** 용역 세분류 원문 (최초허가, 변경허가 등) */
  subtype: string;
  /** 계약일 (YYYY-MM-DD) — 연도 분류 기준 */
  contractDate: string | null;
  /** 완료일(허가일) — 허가 정보의 허가일 (통합허가 전용) */
  permitDate: string | null;
  /** 완료일(발행일) — 최종 대금지급단위의 계산서 발행일 */
  invoiceDoneDate: string | null;
}

export interface ContractCompletionsYearlyContracts {
  year: string;
  /** 해당 연도 전체 계약 건수 */
  total: number;
  /** 5대 분류별 계약 건수 */
  byCategory: Record<string, number>;
  /** 분류별 → 세분류별 계약 건수 */
  bySubtype: Record<string, Record<string, number>>;
}

export interface ContractCompletionsStatus {
  /** 계약일 기준 연도 목록 (내림차순) */
  availableYears: string[];
  /** 완료 건(허가일 혹은 발행일 존재)만 포함 */
  rows: ContractCompletionRow[];
  /** 완료 비율 계산용 연도별 계약 건수 (연도 오름차순) */
  contractsYearly: ContractCompletionsYearlyContracts[];
}

/** 완료일 — 허가일 우선, 없으면 발행일 (소요기간 계산 기준) */
export function completionDate(row: ContractCompletionRow): string | null {
  return row.permitDate ?? row.invoiceDoneDate;
}
