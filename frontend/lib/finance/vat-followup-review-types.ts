/** C-a는 비금전 검토의 저장·판별만 제공한다. 신고 계산/소비 연결은 C-b 범위다. */
export const VAT_FOLLOWUP_REVIEW_VERSION = "vat-followup-review-v1" as const;
export type VatFollowupState = "recorded" | "verified" | "withdrawn";
export interface VatFollowupApplication {
  subjectId: string;
  year: number;
  term: 1 | 2;
  kind: "final";
  path: "legacy" | "basis";
  basisSnapshotId?: string | null;
}
export interface VatFollowupResolvedApplication extends VatFollowupApplication {
  basisSnapshotId: string | null;
  collectorCorpNum: string;
  subjectRevisionId: string;
  subjectHash: string;
  dateFrom: string;
  dateTo: string;
  priorFrom: string;
  priorTo: string;
  currentFrom: string;
}
export interface VatFollowupSourceRef {
  kind: "card" | "hometax";
  id: string;
  expectedSourceHash: string;
}
export type VatFollowupPastRef =
  | { origin: "legacy"; returnId: string; expectedArchiveHash: string }
  | { origin: "basis"; basisSnapshotId: string; factRevisionId: string; expectedScopeHash: string };
export interface VatFollowupPairInput {
  card: VatFollowupSourceRef;
  invoice: VatFollowupSourceRef;
  historicalSide: "card" | "invoice";
  past: VatFollowupPastRef;
  documentId: string;
  evidenceLocation: string;
  reason: string;
}
export interface VatFollowupPreviewInput {
  requestId: string;
  reviewId?: string | null;
  expectedVersion: number;
  application: VatFollowupApplication;
  state: "recorded" | "verified";
  pairs: VatFollowupPairInput[];
}
export interface VatFollowupSaveInput extends VatFollowupPreviewInput {
  expectedPreviewHash: string;
  reviewConfirmed?: boolean;
}
export interface VatFollowupWithdrawInput {
  requestId: string;
  reviewId: string;
  expectedVersion: number;
  reason: string;
}
export interface VatFollowupIssue {
  code: string;
  message: string;
  pairKey?: string;
  sourceId?: string;
}
export interface VatFollowupSourceSnapshot {
  kind: "card" | "hometax";
  id: string;
  canonicalKey: string;
  sourceHash: string;
  hashVersion: "transaction-source-v1";
  sourceBasis: { version: 1; kind: "card" | "hometax"; raw: Record<string, unknown> };
  aliases: Array<{ kind: string; id: string; sourceHash: string; active: boolean }>;
  accountingDate: string;
  date: string;
  direction: "purchase";
  supply: number;
  tax: number;
  total: number;
  claimSupply: number;
  claimTax: number;
  claimTotal: number;
  claimedTax: number;
  partyCorpNum: string | null;
  partyName: string;
  subjectEvidence: "source" | "collection_configuration_only";
}
export interface VatFollowupHistoricalClaim {
  sourceKind: "card" | "hometax" | "tax_invoice";
  sourceId: string;
  canonicalKey: string;
  sourceHash: string;
  direction: "purchase";
  supply: number;
  tax: number;
  claimedTax: number;
  date: string;
}
export interface VatFollowupPastSnapshot {
  origin: "legacy" | "basis";
  legacyReturnId: string | null;
  basisSnapshotId: string | null;
  factRevisionId: string | null;
  consumptionId: string | null;
  subjectId: string;
  from: string;
  to: string;
  archiveHash: string;
  scopeHash: string | null;
  evidenceVerification: "server_document_verified" | "legacy_internal_snapshot_only" | "unverified_declaration";
  /** 현재 legacy 원문 또는 불변 B1 scope의 정확한 서버 사본. */
  archive: unknown;
  claim: VatFollowupHistoricalClaim;
}
export interface VatFollowupResolvedPair {
  pairKey: string;
  databaseProof: { version: "vat-followup-db-v1"; digest: string };
  card: VatFollowupSourceSnapshot;
  invoice: VatFollowupSourceSnapshot;
  historicalSide: "card" | "invoice";
  past: VatFollowupPastSnapshot;
  document: { documentId: string; evidenceHash: string };
  evidenceLocation: string;
  reason: string;
  issues: VatFollowupIssue[];
}
export interface VatFollowupPayload {
  schemaVersion: typeof VAT_FOLLOWUP_REVIEW_VERSION;
  application: VatFollowupResolvedApplication;
  state: VatFollowupState;
  pairs: VatFollowupResolvedPair[];
  withdrawalReason: string | null;
}
export interface VatFollowupPreview {
  reviewId: string;
  revisionId: string;
  version: number;
  previewHash: string;
  normalized: VatFollowupPreviewInput;
  payload: VatFollowupPayload;
  canReview: boolean;
  issues: VatFollowupIssue[];
  taxDelta: 0;
  applicationStatus: "not_integrated_in_ca";
}
export interface VatFollowupRecord {
  reviewId: string;
  revisionId: string;
  version: number;
  payload: VatFollowupPayload;
  payloadHash: string;
  actorUserId: string;
  reviewedBy: string | null;
  createdAt: string;
  consumed: boolean;
  currentIssues: VatFollowupIssue[];
  currentValid: boolean;
  verificationStatus: "available" | "stale" | "unavailable";
}
export interface VatFollowupSaveResult {
  reviewId: string;
  revisionId: string;
  version: number;
  state: VatFollowupState;
  replayed: boolean;
  applicationStatus: "not_integrated_in_ca";
}
