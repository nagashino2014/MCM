/** B3B 사후 기록은 B1 사실·신고 계산을 변경하지 않는다. */
export type VatPostKind = 'receipt' | 'payment' | 'reconciliation' | 'other';
export type VatPostState = 'recorded' | 'verified' | 'withdrawn';
export interface VatPostTargetRef { kind: 'notice' | 'return'; id: string }
export interface VatPostAllocation { target: VatPostTargetRef; amount: number }
export interface VatPostEventInput {
  kind: VatPostKind;
  state: VatPostState;
  /** 공식 접수/납부 식별자. 기록 단계의 미확인 값은 null, 요청키/파일명으로 대체하지 않는다. */
  officialKey: string | null;
  evidenceDocumentId: string;
  /** 원문상 일자 YYYY-MM-DD. 서버 등록 시각과 구분한다. */
  occurredAt: string;
  reason: string;
  /** 같은 B1 문서를 명시 재참조하면 새 현금·배부로 합산하지 않는다. */
  sharedB1FactId?: string | null;
  receipt?: { target: VatPostTargetRef; declaredTax: number | null };
  payment?: {
    actualTotal: number | null;
    additionalCharges: number;
    otherAmount: number;
    unallocatedAmount: number;
    allocations: VatPostAllocation[];
  };
  reconciliation?: { target: VatPostTargetRef; throughDate: string; observedPaidTotal: number | null };
  other?: { category: 'offset' | 'refund' | 'other'; amount: number | null; target?: VatPostTargetRef | null };
}
export interface VatPostPreviewInput {
  requestId: string;
  subjectId: string;
  eventId?: string | null;
  expectedVersion: number;
  event: VatPostEventInput;
}
export interface VatPostSaveInput extends VatPostPreviewInput {
  expectedPreviewHash: string;
  reviewConfirmed?: boolean;
}
export interface VatPostIssue { code: string; message: string; target?: VatPostTargetRef }
export interface VatPostTarget extends VatPostTargetRef {
  subjectId: string;
  year: number;
  term: 1 | 2;
  periodKind: 'preliminary' | 'final';
  dateFrom: string;
  dateTo: string;
  basisSnapshotId: string;
  factId?: string;
  factRevisionId?: string;
  returnId?: string;
  confirmationId?: string;
  /** 고지 전체 원금 또는 가산세를 이미 포함한 내부 확정액. 음수 확정액도 보존한다. */
  targetAmount: number;
  allocatableAmount: number;
  baselinePaid: number | null;
  baselineComplete: boolean;
  allocatedAfter: number;
  remainingKnown: number | null;
  storedHash: string;
}
export interface VatPostEventRecord {
  eventId: string;
  revisionId: string;
  version: number;
  subjectId: string;
  event: VatPostEventInput;
  evidenceHash: string;
  reconciliationHash?: string | null;
  referenceOnly: boolean;
  actorUserId: string;
  createdAt: string;
  matchStatus: 'unreviewed' | 'matched' | 'mismatch' | 'unsupported' | 'withdrawn';
  issues: VatPostIssue[];
}
export interface VatPostOverview {
  subjects: Array<{ subjectId: string; corpNum?: string | null }>;
  subjectId: string | null;
  targets: VatPostTarget[];
  events: VatPostEventRecord[];
  referenceCandidates: Array<{ factId: string; kind: 'filing' | 'payment'; label: string; officialKey: string; amount: number | null; evidenceDocumentId: string | null; evidenceHash: string | null }>;
  issues: VatPostIssue[];
}
export interface VatPostPreview {
  previewHash: string;
  normalized: VatPostPreviewInput;
  eventId: string;
  revisionId: string;
  version: number;
  evidenceHash: string;
  reconciliationHash?: string | null;
  referenceOnly: boolean;
  canReview: boolean;
  matchStatus: VatPostEventRecord['matchStatus'];
  issues: VatPostIssue[];
  targets: VatPostTarget[];
}
export interface VatPostSaveResult {
  eventId: string;
  revisionId: string;
  version: number;
  state: VatPostState;
  referenceOnly: boolean;
  replayed: boolean;
}
