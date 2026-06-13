// 미수금 현황 — 클라이언트/서버 공용 타입·상수.
// (서버 전용 로직은 receivables.ts — pg 의존성이 있어 클라이언트에서 import 금지)

export interface ContractReceivableRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  /** 대쉬보드 5대 분류로 정규화된 용역분류 */
  category: string;
  milestoneId: string;
  stageLabel: string;
  /** 대금지급조건 */
  paymentTerms: string | null;
  /** 발행일 (YYYY-MM-DD) */
  invoiceIssuedAt: string | null;
  /** 발행금액 */
  invoiceAmount: number;
  /** 미수금액 (부분입금 차감 후 잔액) */
  outstandingAmount: number;
  /** 발행일 기준 경과 일수 */
  agingDays: number;
  /** 발행일 기준 경과 개월 (달력 기준 — 일자 미달 시 1개월 차감) */
  agingMonths: number;
  /** 등록된 대응 조치 건수 */
  actionCount: number;
  /** 등록된 대응 조치 유형 목록 (중복 제거) */
  actionTypes: ReceivableActionType[];
}

export interface ContractReceivablesStatus {
  rows: ContractReceivableRow[];
}

export const RECEIVABLE_ACTION_TYPES = [
  "verbal_dunning",
  "content_proof",
  "debt_collection",
  "rehabilitation",
  "debt_waiver",
] as const;
export type ReceivableActionType = (typeof RECEIVABLE_ACTION_TYPES)[number];

/** 채권 추심 진행 세부 단계 (입력 순서 고정) */
export const DEBT_COLLECTION_STAGES = [
  "가압류 신청",
  "공탁금 납입",
  "가압류 결정",
  "공탁금 반환 신청",
  "공탁금 반환 결정",
] as const;

export interface ReceivableActionDocument {
  documentId: string;
  fileName: string;
  byteSize: number | null;
  publicPath: string | null;
  createdAt: string;
}

export interface ReceivableAction {
  actionId: string;
  contractId: string;
  milestoneId: string;
  actionType: ReceivableActionType;
  /** 독촉일 / 발송일 / 가압류 신청일 / 회생 절차 일자 (YYYY-MM-DD) */
  actionDate: string | null;
  progressNote: string;
  /** 회생 절차 진행 단계 (12자 내외) */
  progressStage: string | null;
  /** 채권 추심 단계별 일자 */
  stageDates: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  documents: ReceivableActionDocument[];
}
