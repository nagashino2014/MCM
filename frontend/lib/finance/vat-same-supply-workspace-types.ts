import type { SupplySameRecord } from './supply-same-types';
import type { SupplyGroupRecord } from './supply-group-types';
import type { VatSameSupplyEffect, VatSameSupplyPlan } from './vat-same-supply-types';

export type VatSameReviewKind = 'same' | 'group';
export interface VatSameSupplyCandidate {
  kind: VatSameReviewKind; caseId: string; revisionId: string; version: number;
  state: 'verified_same' | 'verified_group' | 'withdrawn'; reason: string; createdAt: string;
  canSelectForCalculation: boolean;
  documents: Array<{ label: string; date: string; supply: number; tax: number; total: number }>;
}
export interface VatSameSupplyWorkspace {
  basis: { basisSnapshotId: string; subjectId: string; scopeHash: string; dateFrom: string; dateTo: string; kind: 'final' };
  kind: VatSameReviewKind; records: VatSameSupplyCandidate[]; hasMore: boolean; nextCursor: string | null;
}
export interface VatSameSupplyUse {
  useId: string; confirmationId: string; returnId: string; basisSnapshotId: string; subjectId: string;
  calculationHash: string; selections: VatSameSupplyPlan['selections']; effects: VatSameSupplyEffect[];
  createdAt: string; journalUseStatus: 'not_applied';
}
export interface VatSameSupplyExact {
  kind: VatSameReviewKind; record: SupplySameRecord | SupplyGroupRecord;
  evidence: { documentId: string; manifestId: string | null };
  uses: VatSameSupplyUse[];
}
