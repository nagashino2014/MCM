import type { VatClaimSource } from './vat-duplicate-review';
import type { VatFilingDocument } from './vat-filing-documents';
import type { VatFollowupApplication, VatFollowupIssue, VatFollowupPastRef, VatFollowupRecord, VatFollowupSourceRef, VatFollowupPayload, VatFollowupResolvedPair, VatFollowupSourceSnapshot } from './vat-followup-review-types';

/** 표시·입력 시작점이다. 계산/저장 시에는 현재 원천과 선택 판을 다시 검증한다. */
export interface VatFollowupWorkspaceApplication {
  application: VatFollowupApplication;
  label: string;
  corpNum: string | null;
  scopeHash: string | null;
  readOnlyCalculation: boolean;
}
export interface VatFollowupWorkspaceCandidate {
  pairKey: string;
  groupId: string;
  card: VatClaimSource;
  invoice: VatClaimSource;
  cardRef: VatFollowupSourceRef | null;
  invoiceRef: VatFollowupSourceRef | null;
  historicalSide: 'card' | 'invoice' | null;
  past: VatFollowupPastRef | null;
  pastLabel: string;
  officialIdentifiers: string[];
  priorClaimedTax: number | null;
  currentClaimableTax: number | null;
  canStartReview: boolean;
  issues: VatFollowupIssue[];
}
export interface VatFollowupWorkspaceConsumption {
  reviewId: string;
  revisionId: string;
  pairKey: string;
  path: 'legacy' | 'basis';
  returnId: string;
  confirmationId: string | null;
}
export interface VatFollowupWorkspacePairSelection {
  revisionId: string;
  pairKey: string;
  canSelect: boolean;
  selectionUnavailableReason: string | null;
  priorClaimedTax: number;
  currentClaimableTax: number;
  pastLabel: string;
  officialIdentifiers: string[];
  documentFileName: string;
}
export type VatFollowupDisplaySource = Omit<VatFollowupSourceSnapshot, 'sourceBasis' | 'aliases'>;
export interface VatFollowupDisplayPair extends Omit<VatFollowupResolvedPair, 'card' | 'invoice' | 'past' | 'databaseProof'> {
  card: VatFollowupDisplaySource;
  invoice: VatFollowupDisplaySource;
  past: Omit<VatFollowupResolvedPair['past'], 'archive'>;
}
export interface VatFollowupDisplayPayload extends Omit<VatFollowupPayload, 'pairs'> { pairs: VatFollowupDisplayPair[] }
export interface VatFollowupWorkspaceRecord extends Omit<VatFollowupRecord, 'payload'> {
  payload: VatFollowupDisplayPayload;
  latest: boolean;
  canSelect: boolean;
  canWithdraw: boolean;
  selectionUnavailableReason: string | null;
  pairSelections: VatFollowupWorkspacePairSelection[];
}
export interface VatFollowupWorkspace {
  integrationMode: 'explicit_selection';
  applications: VatFollowupWorkspaceApplication[];
  application: VatFollowupApplication | null;
  scopeHash: string | null;
  records: VatFollowupWorkspaceRecord[];
  recordPage: number;
  recordPageSize: number;
  recordTotal: number;
  candidates: VatFollowupWorkspaceCandidate[];
  candidatePage: number;
  candidatePageSize: number;
  candidateTotal: number;
  documents: VatFilingDocument[];
  consumptions: VatFollowupWorkspaceConsumption[];
  canCreateReview: boolean;
  issues: VatFollowupIssue[];
}
