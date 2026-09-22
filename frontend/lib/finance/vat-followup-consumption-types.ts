import type { VatFollowupResolvedApplication, VatFollowupResolvedPair } from './vat-followup-review-types';

/** 새 선택은 클라이언트 금액을 받지 않는다. 저장된 판의 정확한 쌍만 지정한다. */
export interface VatFollowupSelection {
  subjectId: string;
  pairs: Array<{ revisionId: string; pairKey: string }>;
}
export interface VatFollowupConsumptionPair {
  reviewId: string;
  revisionId: string;
  pairLineNo: number;
  pairKey: string;
  payloadHash: string;
  pair: VatFollowupResolvedPair;
  priorClaimedTax: number;
  currentClaimableTax: number;
}
export interface ValidatedVatFollowupConsumptionPlan {
  application: VatFollowupResolvedApplication;
  pairs: VatFollowupConsumptionPair[];
}
export interface VatFollowupCalculation extends ValidatedVatFollowupConsumptionPlan {
  version: 'vat-followup-consumption-v2';
  canonicalVersion: 'vat-canonical-v2';
  /** 전체 계산 투영의 보관 문자열. 임의 소수/raw JSON을 새 integer proof로 정규화하지 않는다. */
  baseCalculationText: string;
  baseCalculationHash: string;
  planText: string;
  planHash: string;
  calculationHash: string;
}
export type VatFollowupConsumptionTarget =
  | { path: 'basis'; returnId: string; confirmationId: string }
  | { path: 'legacy'; returnId: string };
