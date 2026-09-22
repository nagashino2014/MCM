import type { VatClaimSource } from './vat-duplicate-review';

export interface VatSameSupplySelection {
  version: 'vat-same-supply-selection-v1';
  subjectId: string;
  reviews: Array<{ kind: 'same' | 'group'; caseId: string; revisionId: string }>;
}
export interface VatSameSupplyEffect {
  sourceType: 'hometax_invoice' | 'card'; sourceId: string;
  rawSupplyAmount: number; rawTaxAmount: number; rawTotalAmount: number;
  claimedSupplyAmount: number; claimedTaxAmount: number;
  suppressedSupplyAmount: number; suppressedTaxAmount: number;
  representativeSourceId: string;
  wholeId: string; documentId: string; observationId: string; canonicalKey: string;
  rawSourceHash: string; sourceHashVersion: string; taxDate: string;
  sourceDate?: string; counterparty?: string; canonicalIdentity?: string;
}
export interface VatSameSupplyPlan {
  version: 'vat-same-supply-plan-v1'; basisSnapshotId: string; subjectId: string;
  taxpayerKey: string; scopeHash: string; dateFrom: string; dateTo: string;
  selections: Array<{ kind: 'same' | 'group'; caseId: string; revisionId: string;
    version: number; proofHash: string; sourceBasisHash: string }>;
  effects: VatSameSupplyEffect[]; planHash: string;
  dependencies?: Array<{kind:string;id:string;hash:string}>;
}
export interface VatSameSupplyCalculation {
  version: 'vat-same-supply-consumption-v1'; canonicalVersion: 'vat-canonical-v2';
  plan: VatSameSupplyPlan;
  /** Includes suppressed cards with their unmodified source amounts and fingerprints. */
  rawClaims: VatClaimSource[];
  claimEffects: VatSameSupplyEffect[];
  baseCalculationText: string; baseCalculationHash: string; calculationHash: string;
  journalDependencies: []; journalUseStatus: 'not_applied';
}
