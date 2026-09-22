import { SAME_ISSUE_MESSAGES } from './supply-same-diagnostics';
export const GROUP_ISSUE_MESSAGES = {
  group_counterparty_mismatch: '기준 문서와 구성 문서의 방향·회사·거래처를 확인하세요.',
  group_amount_unsupported: '양수인 문서 전체만 지원합니다. 취소 금액을 빼서 맞추는 대응은 지원하지 않습니다.',
  group_amount_mismatch: '기준 문서와 구성 문서 합계의 공급가액·세액·합계를 각각 확인하세요.',
  group_evidence_unavailable: '같은 회사의 보관 PDF 원문 위치 근거를 다시 선택하세요.',
  group_coverage_missing: '각 문서 전체에 대응하는 원문 위치를 지정하세요.',
  group_currency_unavailable: '각 문서의 원화 표시가 있는 원문 위치를 지정하세요.',
  group_coverage_extra: '선택한 집합 밖의 문서가 근거에 포함되어 있습니다. 원문 위치의 대응 문서를 확인하세요.',
  group_detail_overlap: '서로 다른 구성 문서의 세부 근거가 겹칩니다. 공통 제목·단위 표시는 공통 근거로 구분하세요.',
  group_revision_stale: '같은 문서 집합의 최신 확인판을 다시 불러오세요.',
  group_case_exists: '이미 기록된 문서 집합입니다. 그 집합의 최신 확인판을 불러오세요.',
  group_overlap_unresolved: '기존 전체 대응과 다른 분해가 겹칩니다. 추가 대응 근거를 먼저 검토하세요.',
  group_identity_overlap: '같은 문서나 같은 전체 문서의 다른 표현이 중복 선택되었습니다.',
  group_same_stale: '전체 문서의 대표를 정하는 기존 관계의 근거를 먼저 재검토하세요.',
  group_distinct_conflict: '기준 문서와 구성 문서를 별개 공급으로 기록한 근거와 충돌합니다. 해당 근거를 먼저 검토하세요.',
  group_c_source_stale: '관련 과거 검토의 정확한 원천 근거를 먼저 재검토하세요.',
  group_c_distinct_conflict: '정확한 과거 별개 공급 쌍과 전체 대응이 충돌합니다. 기존 근거를 먼저 검토하세요.',
  supply_group_diagnostic_unavailable: '구체 사유를 안전하게 표시할 수 없습니다. 최신 근거를 다시 확인하세요.',
} as const;
export interface GroupSafeIssue { code: string; message: string }
export interface GroupConflictDiagnostics { error: string; code: string; issues: GroupSafeIssue[]; totalIssueCount: number; issuesTruncated: boolean; nextAction?: 'preview' | 'reload_latest' }
const MESSAGES = {
  supply_group_review_incomplete: '전체 대응을 확인할 근거가 부족합니다. 표시된 항목을 보완하세요.',
  supply_group_preview_changed: '미리보기 후 근거가 바뀌었습니다. 현재 근거를 다시 확인하세요.',
  supply_group_request_conflict: '이미 처리된 요청의 담당자나 내용이 다릅니다.',
  supply_group_conflict: '근거 또는 최신 확인판이 바뀌었습니다.',
  supply_group_document_changed: '선택한 보관 원문이 다릅니다. 원문을 다시 선택하세요.',
  supply_group_subject_changed: '해당일의 회사 근거를 확인하세요.',
} as const;
const obj = (v: unknown): Record<string, unknown> | null => !!v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
export function safeGroupIssues(value: unknown): GroupSafeIssue[] {
  return (Array.isArray(value) ? value : [null]).map(v => {
    const code = obj(v)?.code;
    if (typeof code === 'string' && Object.hasOwn(GROUP_ISSUE_MESSAGES, code)) return { code, message: GROUP_ISSUE_MESSAGES[code as keyof typeof GROUP_ISSUE_MESSAGES] };
    if (typeof code === 'string' && Object.hasOwn(SAME_ISSUE_MESSAGES, code)) return { code, message: SAME_ISSUE_MESSAGES[code as keyof typeof SAME_ISSUE_MESSAGES] };
    return { code: 'supply_group_diagnostic_unavailable', message: GROUP_ISSUE_MESSAGES.supply_group_diagnostic_unavailable };
  });
}
export function groupConflictResponse(error: unknown, action?: string): GroupConflictDiagnostics {
  const e = obj(error), raw = e?.code;
  const code = typeof raw === 'string' && Object.hasOwn(MESSAGES, raw) ? raw as keyof typeof MESSAGES : 'supply_group_conflict';
  const all = code === 'supply_group_review_incomplete' ? safeGroupIssues(Array.isArray(e?.groupIssues) && e.groupIssues.length ? e.groupIssues : [null]) : [];
  const nextAction = code === 'supply_group_request_conflict' ? undefined : action === 'withdraw' || all.some(i => ['group_revision_stale', 'group_case_exists'].includes(i.code)) ? 'reload_latest' as const : 'preview' as const;
  return { error: MESSAGES[code], code, issues: all.slice(0, 20), totalIssueCount: all.length, issuesTruncated: all.length > 20, ...(nextAction ? { nextAction } : {}) };
}
export function readGroupConflict(value: unknown, status: number): GroupConflictDiagnostics | null {
  if (status !== 409) return null;
  const v = obj(value);
  if (!v || typeof v.code !== 'string' || !Object.hasOwn(MESSAGES, v.code) || !Array.isArray(v.issues) || v.issues.length > 20 || !Number.isSafeInteger(v.totalIssueCount) || Number(v.totalIssueCount) < v.issues.length || v.issuesTruncated !== (Number(v.totalIssueCount) > v.issues.length) || (v.nextAction !== undefined && v.nextAction !== 'preview' && v.nextAction !== 'reload_latest')) return null;
  return { error: MESSAGES[v.code as keyof typeof MESSAGES], code: v.code, issues: safeGroupIssues(v.issues), totalIssueCount: Number(v.totalIssueCount), issuesTruncated: !!v.issuesTruncated, ...(v.nextAction ? { nextAction: v.nextAction as 'preview' | 'reload_latest' } : {}) };
}
