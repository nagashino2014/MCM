// 착수계·준공계 제출 공문의 정형 문구 — 실무상 본문이 거의 고정이라 템플릿화한다(사용자 요청).
// 공문 작성 화면(ApprovalLetterBoard)이 ?deliverable=<id> 로 진입할 때 제목·본문·붙임을 채운다.
// 본문은 MailEditor 가 소비하는 HTML(문단 <p>) 형식이다.

import { DELIVERABLE_KIND_LABEL, type DeliverableKind } from "./types";

/** 공문 제목 — 「계약명」 착수계 제출 */
export function letterSubjectFor(kind: DeliverableKind, contractTitle: string): string {
  return `「${contractTitle}」 ${DELIVERABLE_KIND_LABEL[kind]} 제출`;
}

/**
 * 공문 본문 — 1) 인사 2) 제출 사유. 발주처마다 문구 차이가 거의 없어 그대로 쓰되
 * 작성 화면에서 자유롭게 수정할 수 있다.
 */
export function letterBodyFor(kind: DeliverableKind, contractTitle: string): string {
  const second =
    kind === "start"
      ? `2. 「${contractTitle}」 계약 체결에 따라 착수계를 붙임과 같이 제출합니다.`
      : `2. 「${contractTitle}」 용역이 완료되어 준공계를 붙임과 같이 제출하오니 검사하여 주시기 바랍니다.`;
  return [`<p>1. 귀사의 무궁한 발전을 기원합니다.</p>`, `<p>${escapeHtml(second)}</p>`].join("");
}

/**
 * 붙임 항목 — "준공검사원    1부." 형식. 문서명과 '1부' 사이는 4칸 띄운다(사용자 확정).
 * 마지막 항목에는 "끝."을 붙인다.
 */
export function letterAttachItemsFor(docTitles: string[]): string[] {
  if (!docTitles.length) return [];
  return docTitles.map((t, i) => `${t}    1부.${i === docTitles.length - 1 ? "  끝." : ""}`);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
