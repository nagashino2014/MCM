export interface SupplySameRef { documentId: string; portionId: string; observationId: string }
export interface SupplySameDraft { subjectId: string; reviewRevisionId: string; left: SupplySameRef; right: SupplySameRef; reason: string; evidence: { documentId: string; evidenceHash: string; location: string } }
export interface SupplySamePreviewInput { draft: SupplySameDraft; caseId: string | null; expectedVersion: number; expectedRevisionId: string | null }
export interface SupplySameSaveInput extends SupplySamePreviewInput { expectedPreviewHash: string; requestId: string }
export interface SupplySameWithdrawInput { subjectId: string; caseId: string; expectedVersion: number; expectedRevisionId: string; reason: string; requestId: string }
export interface SupplySameTimeDiagnostic { sourceId: string; status: 'matched' | 'unavailable' | 'conflict'; projectionMatches: boolean | null; evidenceSufficient: boolean; rawValue: string | null; projectedValue: string | null; storedValue: string | null; version: 'card-approval-time-evidence-v1' }
export interface SupplySameSummary extends SupplySameRef { supply: number; tax: number; total: number; date: string; direction: 'purchase' | 'sales' }
export interface SupplySamePreview { schemaVersion: 'de1b-whole-preview-v1'; draft: SupplySameDraft; canVerify: boolean; issues: { code: string; message: string; scope?: string }[]; previewHash: string; left: SupplySameSummary | null; right: SupplySameSummary | null; timeDiagnostics: SupplySameTimeDiagnostic[]; financialUseSupported: false }
export interface SupplySameResult { caseId: string; revisionId: string; version: number; state: 'verified_same' | 'withdrawn'; replayed: boolean; financialUseSupported: false }
export interface SupplySameRecord extends Omit<SupplySameResult, 'replayed'> { previousRevisionId: string | null; draft: SupplySameDraft; preview: SupplySamePreview; withdrawalReason: string | null; createdAt: string }
export interface SupplySameList { records: SupplySameRecord[]; hasMore: boolean; nextCursor: string | null }
