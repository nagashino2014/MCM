/** Safe transport diagnostics only. Never alters a preview, stored proof, or request payload. */
export const SAME_ISSUE_MESSAGES = {
  observation_missing: '정확한 문서 관측을 선택하세요.',
  observation_stale: '최신 문서 관측을 선택하세요.',
  source_observation_changed: '원천·회사·기록판이 바뀌었습니다. 양쪽 문서를 같은 최신 기록판으로 재관측하세요.',
  same_counterparty_unavailable: '정확한 거래처 번호를 확인하세요.',
  subject_evidence_unavailable: '해당일 회사 기준의 보관 증빙을 확인하세요.',
  merchant_correction_scope: '원문과 다른 가맹점 정정 번호는 현재 관계 확인 범위에서 지원하지 않습니다. 재관측만으로 해결되지 않습니다.',
  card_time_conflict: '카드 승인일시가 저장값과 다릅니다. 원문과 수집 내역을 확인하세요.',
  card_time_unavailable: '카드 승인일시의 근거를 확인할 수 없습니다. 원문을 보완하세요.',
  cancellation_unresolved: '원승인·취소 관계와 현재 검토 근거를 확인하세요.',
  cancellation_exceeds_original: '연결된 취소 금액이 원승인을 넘습니다. 취소 내역을 확인하세요.',
  correction_lineage_unresolved: '수정 문서와 원 계산서의 관계를 먼저 검토하세요.',
  same_identity_self: '같은 문서 자체를 중복 확인할 수 없습니다. 다른 문서를 선택하세요.',
  whole_amount_mismatch: '두 문서 전체의 방향·공급가액·세액·합계가 일치하지 않습니다. 부분 분할은 아직 지원하지 않습니다.',
  same_counterparty_mismatch: '두 문서의 거래처가 다릅니다. 원문과 거래처를 확인하세요.',
  evidence_unavailable: '같은 회사의 보관 증빙을 다시 선택하고 확인하세요.',
  same_revision_stale: '현재 관계의 최신 확인판을 다시 불러오세요.',
  same_case_exists: '이미 기록된 관계가 있습니다. 최신 확인판으로 검토하세요.',
  same_graph_stale: '연결된 기존 관계의 원천을 먼저 재검토하세요.',
  distinct_relation_unresolved: '별개 공급 선언과 관계가 충돌합니다. 해당 선언의 원천과 근거를 먼저 검토하세요.',
  c_source_stale: '관련 과거 검토의 원천 근거를 먼저 재검토하세요.',
  c_distinct_conflict: '정확한 과거 별개 공급 쌍과 같은 공급 관계가 모순됩니다. 근거를 먼저 검토하세요.',
  supply_same_diagnostic_unavailable: '구체 사유를 안전하게 표시할 수 없습니다. 최신 근거를 다시 확인하세요.',
} as const;
export type SameIssueCode = keyof typeof SAME_ISSUE_MESSAGES;
export interface SameSafeIssue { code: SameIssueCode; message: string }
const CONFLICT_MESSAGES = {
  supply_same_unresolved: '확인할 근거가 바뀌었거나 미해결 상태입니다.',
  supply_same_preview_stale: '확인할 근거가 바뀌었거나 미해결 상태입니다.',
  supply_same_conflict: '근거 또는 최신 확인판이 바뀌었습니다. 다시 확인하세요.',
  supply_same_request_conflict: '이미 처리된 요청의 담당자나 내용이 다릅니다.',
  supply_same_document_changed: '선택한 보관 증빙 해시가 다릅니다.',
  supply_same_subject_changed: '해당일 회사 근거가 부족합니다.',
} as const;
export interface SameConflictDiagnostics { error: string; code: keyof typeof CONFLICT_MESSAGES; issues: SameSafeIssue[]; totalIssueCount: number; issuesTruncated: boolean; nextAction?: 'preview' | 'reload_latest' }
const LIMIT = 20;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
function issue(value: unknown): SameSafeIssue {
  const v = object(value), raw = v?.code;
  const code: SameIssueCode = typeof raw === 'string' && Object.hasOwn(SAME_ISSUE_MESSAGES, raw) ? raw as SameIssueCode : 'supply_same_diagnostic_unavailable';
  return { code, message: SAME_ISSUE_MESSAGES[code] };
}
function issues(value: unknown) {
  const list = Array.isArray(value) && value.length > 0 ? value : [null];
  return { issues: list.slice(0, LIMIT).map(issue), totalIssueCount: list.length, issuesTruncated: list.length > LIMIT };
}
function response(code: keyof typeof CONFLICT_MESSAGES, details?: ReturnType<typeof issues>): SameConflictDiagnostics {
  return { error: CONFLICT_MESSAGES[code], code, ...(details ?? { issues: [], totalIssueCount: 0, issuesTruncated: false }), ...(['supply_same_unresolved', 'supply_same_preview_stale', 'supply_same_conflict', 'supply_same_document_changed', 'supply_same_subject_changed'].includes(code) ? { nextAction: 'preview' as const } : {}) };
}
/** Called only after the existing service validated the current preview in its write transaction. */
export function sameCurrentPreviewError(current: { canVerify: boolean; issues: unknown; previewHash: string }, expectedPreviewHash: string) {
  const value = current.canVerify !== true ? response('supply_same_unresolved', issues(current.issues)) : current.previewHash !== expectedPreviewHash ? response('supply_same_preview_stale') : null;
  return value ? Object.assign(new Error(value.error), { status: 409, ...value }) : null;
}
/** Local route serializer: only known static codes/text. Do not serialize the supplied Error.message. */
function baseConflictResponse(error: unknown): SameConflictDiagnostics {
  const e = object(error), raw = e?.code;
  const code = typeof raw === 'string' && Object.hasOwn(CONFLICT_MESSAGES, raw) ? raw as keyof typeof CONFLICT_MESSAGES : 'supply_same_conflict';
  if (code !== 'supply_same_unresolved') return response(code);
  const safe = issues(e?.issues);
  const total = e?.totalIssueCount, truncated = e?.issuesTruncated;
  // Service-generated diagnostics may already be display-capped. Preserve the true count only with a coherent bound.
  if (Array.isArray(e?.issues) && e.issues.length > 0 && e.issues.length <= LIMIT && Number.isSafeInteger(total) && Number(total) >= e.issues.length && typeof truncated === 'boolean' && truncated === (Number(total) > e.issues.length)) return response(code, { ...safe, totalIssueCount: Number(total), issuesTruncated: truncated });
  return response(code, safe);
}
export function sameConflictResponse(error: unknown, action?: string): SameConflictDiagnostics {
  const value = baseConflictResponse(error);
  return action === 'withdraw' && value.nextAction ? { ...value, nextAction: 'reload_latest' } : value;
}
/** Optional new error metadata; old {error} clients/responses continue working. Never changes HTTP-state retry policy. */
export function readSameConflictDiagnostics(value: unknown, status: number, action?: string): SameConflictDiagnostics | null {
  if (status !== 409) return null;
  const v = object(value), code = v?.code;
  if (!v || typeof code !== 'string' || !Object.hasOwn(CONFLICT_MESSAGES, code) || !Array.isArray(v.issues) || v.issues.length > LIMIT || !Number.isSafeInteger(v.totalIssueCount) || Number(v.totalIssueCount) < v.issues.length || typeof v.issuesTruncated !== 'boolean' || v.issuesTruncated !== (Number(v.totalIssueCount) > v.issues.length)) return null;
  const result = response(code as keyof typeof CONFLICT_MESSAGES);
  if (action === 'withdraw' && result.nextAction) result.nextAction = 'reload_latest';
  if (v.nextAction !== result.nextAction) return null;
  if (code === 'supply_same_unresolved') {
    if (v.issues.length === 0) return null;
    return { ...result, issues: v.issues.map(issue), totalIssueCount: Number(v.totalIssueCount), issuesTruncated: v.issuesTruncated };
  }
  if (v.issues.length || v.totalIssueCount !== 0 || v.issuesTruncated) return null;
  return result;
}
