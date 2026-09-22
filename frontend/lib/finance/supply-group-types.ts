import type { SupplySameRef, SupplySameTimeDiagnostic } from './supply-same-types';

export type SupplyGroupRef = SupplySameRef;
export interface SupplyGroupRegion {
  regionId: string;
  pageNumber: number;
  rect: { x: number; y: number; width: number; height: number };
  role: 'context' | 'detail';
  wholeRefs: SupplyGroupRef[];
}
export interface SupplyGroupEvidenceInput {
  subjectId: string;
  documentId: string;
  evidenceHash: string;
  regions: SupplyGroupRegion[];
  requestId: string;
}
export interface SupplyGroupEvidenceResult {
  manifestId: string;
  manifestHash: string;
  verificationLevel: 'human_review';
  replayed: boolean;
}
export interface SupplyGroupDraft {
  subjectId: string;
  reviewRevisionId: string;
  singleton: SupplyGroupRef;
  members: SupplyGroupRef[];
  evidenceManifestId: string;
  reason: string;
  currencyEvidence: { documentId: string; currency: 'KRW'; manifestRegionId: string }[];
  coverageConfirmed: true;
}
export interface SupplyGroupPreviewInput {
  draft: SupplyGroupDraft;
  caseId: string | null;
  expectedVersion: number;
  expectedRevisionId: string | null;
}
export interface SupplyGroupSaveInput extends SupplyGroupPreviewInput {
  expectedPreviewHash: string;
  requestId: string;
}
export interface SupplyGroupWithdrawInput {
  subjectId: string;
  caseId: string;
  expectedVersion: number;
  expectedRevisionId: string;
  reason: string;
  requestId: string;
}
export interface SupplyGroupSummary extends SupplyGroupRef {
  supply: number; tax: number; total: number; date: string; direction: 'purchase' | 'sales';
}
export interface SupplyGroupIssue { code: string; message: string; scope?: string }
export interface SupplyGroupPreview {
  schemaVersion: 'de1b-group-preview-v1';
  draft: SupplyGroupDraft;
  canVerify: boolean;
  issues: SupplyGroupIssue[];
  previewHash: string;
  singleton: SupplyGroupSummary | null;
  members: (SupplyGroupSummary | null)[];
  timeDiagnostics: SupplySameTimeDiagnostic[];
  financialUseSupported: false;
}
export interface SupplyGroupResult {
  caseId: string; revisionId: string; version: number;
  state: 'verified_group' | 'withdrawn'; replayed: boolean; financialUseSupported: false;
}
export interface SupplyGroupRecord extends Omit<SupplyGroupResult, 'replayed'> {
  previousRevisionId: string | null;
  draft: SupplyGroupDraft;
  preview: SupplyGroupPreview;
  withdrawalReason: string | null;
  createdAt: string;
}
export interface SupplyGroupList { records: SupplyGroupRecord[]; hasMore: boolean; nextCursor: string | null }
export interface SupplyGroupEvidenceDiagnostics {
  manifestId: string;
  verificationLevel: 'human_review';
  regions: { regionId: string; pageNumber: number; role: 'context' | 'detail'; textStatus: 'text' | 'no_text' }[];
  noTextDetailCount: number;
}
