export interface JournalUseEntryPlan {
  effectNo: number;
  cardSourceId: string;
  representativeSourceId: string;
  entryId: string;
  entryProjection: unknown;
  projectionHash: string;
  sourceHash: string;
  supply: number;
  tax: number;
  total: number;
  accountingDate: string;
}

export interface JournalUsePlan {
  version: 'finance-journal-use-plan-v1';
  vatUseId: string;
  confirmationId: string;
  returnId: string;
  basisSnapshotId: string;
  subjectId: string;
  taxpayerKey: string;
  periodFrom: string;
  periodTo: string;
  entries: JournalUseEntryPlan[];
  planHash: string;
}

export interface JournalUsePreview {
  status: 'ready';
  plan: JournalUsePlan;
  totals: { entries: number; supply: number; tax: number; total: number };
}

export interface JournalUseResult {
  journalUseId: string;
  vatUseId: string;
  status: 'applied' | 'released';
  planHash: string;
  releaseId?: string;
  releaseSourceStatus?: 'applied' | 'stale';
  replayed: boolean;
}

export interface JournalUseListItem {
  journalUseId: string;
  vatUseId: string;
  confirmationId: string;
  returnId: string;
  subjectId: string;
  periodFrom: string;
  periodTo: string;
  planHash: string;
  status: 'applied' | 'stale' | 'released';
  diagnosticCode?: 'journal_use_source_stale';
  diagnosticMessage?: string;
  createdAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
}

export interface JournalUseListPage {
  uses: JournalUseListItem[];
  limited: boolean;
}
