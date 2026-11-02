import type { PurchaseContractType } from "./options";

/** 매입 계약 원장 트리 노드 — 매출 ContractTreeContractNode(lib/ieps/contracts.ts)와 같은 역할의 최소 payload. */
export interface PurchaseTreeNode {
  purchaseContractId: string;
  contractTitle: string;
  counterpartyName: string;
  contractCategory: string;
  currentAmount: number | null;
  contractDate: string | null;
  contractStatus: string;
  /** 모든 단계 지급 완료(매출 트리의 수금 완료 점 자리). */
  isFullyPaid: boolean;
  /** 완료 건 — 마지막 단계 지급 완료 또는 준공일 경과(트리 하단 집계용). */
  isCompleted: boolean;
}

export interface PurchaseTreeGroup {
  contractType: PurchaseContractType;
  label: string;
  contracts: PurchaseTreeNode[];
}

export interface PurchaseTreePayload {
  year: string | null;
  totalCount: number;
  availableYears: string[];
  groups: PurchaseTreeGroup[];
}

/** 상세 — 서버 행을 그대로 넘긴다(매출 ContractDetail 과 같은 Record 방식). */
export interface PurchaseContractDetail {
  contract: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
}

/** 홈택스 매입 세금계산서 후보(연결용 요약). */
export interface PurchaseInvoiceCandidate {
  htiId: string;
  writeDate: string;
  issueDt: string | null;
  invoicerCorpNum: string | null;
  invoicerCorpName: string | null;
  itemName: string | null;
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  ntsSendKey: string;
  /** 이미 다른 단계에 연결돼 있으면 그 단계 id. */
  linkedMilestoneId: string | null;
}

export interface PurchaseAccountOption {
  accountCode: string;
  name: string;
  acctType: string;
}
