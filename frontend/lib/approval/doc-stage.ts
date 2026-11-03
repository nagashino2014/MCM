// 계약서·견적서 초안/최종안 단계(336, 2026-11-03 사용자 요청) — 클라이언트·서버 공용.
// 초안: 결재 없이 발주처(사업장)에 송부해 검토받는다. 송부하면 그 버전은 잠기고 수정은 새 버전으로 한다.
// 최종안: 고정 결재선(부서장→임원→대표이사, 작성자 직급에 따라 앞 단계 생략)을 거쳐 승인 후 발송한다.
// 문서 원본(approval_docs.field_values)의 공통 키 — 양식별 키 표기(견적 snake_case·계약서 camelCase)와 무관하게
// 두 양식이 같은 이름을 쓴다(고정 결재선 강제 규칙이 이 키로 최종안 여부를 판정한다):
//   doc_stage     'draft' | 'final' (없으면 초안 — 기존 문서는 모두 초안, 사용자 확정)
//   draft_sent_at 초안 송부 성공 시각(서버만 기록, 있으면 그 버전은 잠김)

export type DocStage = "draft" | "final";

export const DOC_STAGE_LABEL: Record<DocStage, string> = {
  draft: "초안",
  final: "최종안",
};

export function docStageOf(fieldValues: Record<string, unknown> | null | undefined): DocStage {
  return fieldValues?.doc_stage === "final" ? "final" : "draft";
}

/** 송부한 초안 — 수정 불가, 고치려면 새 버전을 만든다 */
export function isDraftSent(fieldValues: Record<string, unknown> | null | undefined): boolean {
  return typeof fieldValues?.draft_sent_at === "string" && !!fieldValues.draft_sent_at;
}

/** 송부 이력 1건(대장 send_history 원소, 공문 194 관례) */
export interface SendHistoryEntry {
  sentAt: string;
  messageId?: string | null;
  stage: DocStage;
  version: number;
  /** 받는 사람 메일 주소 */
  to?: string[];
  cc?: string[];
  /** 첨부 파일 이름 */
  attachments?: string[];
  /** 'direct' = 메일 없이 산출물만 만든 건(견적 직접 제출 모드) */
  mode?: "mail" | "direct";
}

export function parseSendHistory(raw: unknown): SendHistoryEntry[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as SendHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** 버전 이력 행 — 계약서·견적서 공용(같은 용역 건의 버전 묶음) */
export interface DocVersionItem {
  docId: string;
  version: number;
  stage: DocStage;
  /** approval_docs.status */
  status: string;
  docNo: string | null;
  title: string;
  drafterName: string | null;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  draftSentAt: string | null;
  /** 변경 메모(계약서) 또는 재견적 사유 코드(견적) */
  revisionNote: string | null;
  sendHistory: SendHistoryEntry[];
}

/** 버전 상태 한 줄 표기 — 이력 패널·목록 공용 */
export function versionStateLabel(it: { stage: DocStage; status: string; draftSentAt: string | null }): string {
  if (it.stage === "draft") return it.draftSentAt ? "초안 송부" : "초안 작성 중";
  if (it.status === "approved") return "최종안 승인";
  if (it.status === "in_progress") return "최종안 결재 중";
  if (it.status === "rejected") return "최종안 반려";
  return "최종안 작성 중";
}
