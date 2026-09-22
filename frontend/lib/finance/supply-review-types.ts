/** DE-0 records a review basis. Nothing in this model grants accounting or VAT consumption. */
export const SUPPLY_REVIEW_SCHEMA = "de0-supply-review-v1" as const;
export interface ReviewMoney { supply: number; tax: number; total: number }
export interface SupplyReviewLine extends ReviewMoney {
  lineId: string; description: string; dateFrom: string; dateTo: string;
  fulfillment: "completed" | "partial" | "advance" | "unknown";
  documentId: string | null; evidenceLocation: string;
}
export interface SupplyReviewMember {
  memberId: string; kind: "card" | "hometax" | "tax_invoice"; sourceId: string;
  correction: {
    isCorrection: boolean; reason: string; originalApprovalNumber: string | null;
    originalMemberId: string | null;
    referenceStatus: "not_collected" | "not_provided" | "unresolved" | "declared";
    role: "unknown" | "reversal" | "replacement" | "delta";
    documentId: string | null; evidenceLocation: string;
  };
}
export interface SupplyReviewAllocation extends ReviewMoney { allocationId: string; memberId: string; lineId: string }
export interface SupplyReviewClaim {
  claimId: string; lineId: string; memberId: string; origin: "external" | "c_consumption";
  reference: string; claimedSupply: number; claimedTax: number;
  coverage: "exact" | "partial" | "unknown";
  documentId: string | null; evidenceLocation: string;
  cReference: { revisionId: string; pairLineNo: number } | null;
}
export interface SupplyReviewDraft {
  schemaVersion: typeof SUPPLY_REVIEW_SCHEMA; subjectId: string; title: string; reason: string;
  lines: SupplyReviewLine[]; members: SupplyReviewMember[];
  allocations: SupplyReviewAllocation[]; claims: SupplyReviewClaim[];
}
export interface SupplyReviewIssue { code: string; message: string; scope: string; severity: "missing" | "conflict" | "unsupported" }
export interface SupplyReviewSourceSnapshot extends ReviewMoney {
  memberId: string; kind: SupplyReviewMember["kind"]; sourceId: string;
  found: boolean; sourceHash: string | null; canonicalKey: string | null;
  date: string | null; taxDate: string | null; direction: string | null;
  partyName: string; recipientCorpNum: string | null; ownApprovalNumber: string | null;
  sourceIssues: string[]; metadataText: string; metadataHash: string;
}
export interface SupplyReviewDocumentSnapshot {
  documentId: string; subjectId: string; evidenceHash: string; fileName: string;
}
export interface SupplyReviewCReferenceSnapshot {
  revisionId: string; pairLineNo: number; found: boolean; consumptionId: string | null;
  subjectId: string | null; pairKey: string | null; historicalSide: "card" | "invoice" | null;
  historicalKind: "card" | "hometax" | null; historicalSourceId: string | null;
  claimedSupply: number | null; claimedTax: number | null;
  snapshotText: string; snapshotHash: string;
}
export interface SupplyReviewBasis {
  schemaVersion: "de0-supply-basis-v1";
  subjectId: string; subjectSnapshotText: string; subjectSnapshotHash: string;
  subjectIssues: SupplyReviewIssue[];
  sources: SupplyReviewSourceSnapshot[]; documents: SupplyReviewDocumentSnapshot[];
  cReferences: SupplyReviewCReferenceSnapshot[];
}
export interface SupplyReviewAssessment {
  schemaVersion: "de0-supply-assessment-v1";
  status: "reviewable" | "needs_information";
  canApply: false; consumptionSupported: false; issues: SupplyReviewIssue[];
  lineTotals: ReviewMoney; claimedTotals: { supply: number; tax: number };
  memberTotals: Array<ReviewMoney & { memberId: string; allocated: ReviewMoney; remaining: ReviewMoney }>;
  additionalVatDeduction: null;
}
export interface SupplyReviewPreviewInput { caseId: string | null; draft: SupplyReviewDraft }
export interface SupplyReviewSaveInput extends SupplyReviewPreviewInput {
  requestId: string; expectedRevisionId: string | null; expectedVersion: number; expectedPreviewHash: string;
}
export interface SupplyReviewWithdrawInput {
  caseId: string; requestId: string; expectedRevisionId: string; expectedVersion: number; reason: string;
}
export interface SupplyReviewPreview {
  caseId: string | null; currentRevisionId: string | null; currentVersion: number;
  previewHash: string; draft: SupplyReviewDraft; basis: SupplyReviewBasis; assessment: SupplyReviewAssessment;
}
export interface SupplyReviewRecord {
  caseId: string; subjectId: string; revisionId: string; version: number; previousRevisionId: string | null;
  state: "recorded" | "withdrawn"; actorUserId: string; createdAt: string;
  draft: SupplyReviewDraft; basis: SupplyReviewBasis; assessment: SupplyReviewAssessment;
  payloadHash: string; basisHash: string; withdrawalReason: string | null;
}
