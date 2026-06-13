// 수금 현황 — 클라이언트/서버 공용 타입.
// (서버 전용 로직은 collections-status.ts — pg 의존성이 있어 클라이언트에서 import 금지)

export interface ContractCollectionRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  /** 대쉬보드 5대 분류로 정규화된 용역분류 */
  category: string;
  /** 용역 세분류 원문 (최초허가, 변경허가 등) */
  subtype: string;
  milestoneId: string;
  /** 대금지급단위 (선급금/중도금/준공금 등) */
  stageLabel: string;
  /** 계약일 (YYYY-MM-DD) — 연도 분류 기준 */
  contractDate: string | null;
  /** 수금 금액 */
  amount: number;
  /** 수금일 (YYYY-MM-DD) */
  collectedAt: string | null;
  /** 계산서 발행일 (YYYY-MM-DD) — 수금 소요기간 계산용 */
  invoiceIssuedAt: string | null;
}

export interface ContractCollectionsOrdersYearly {
  year: string;
  /** 해당 연도 전체 수주액 */
  total: number;
  /** 5대 분류별 수주액 */
  byCategory: Record<string, number>;
}

export interface ContractCollectionsStatus {
  /** 계약일 기준 연도 목록 (내림차순) */
  availableYears: string[];
  rows: ContractCollectionRow[];
  /** 수금 비율 계산용 연도별 수주액 (연도 오름차순) */
  ordersYearly: ContractCollectionsOrdersYearly[];
}
