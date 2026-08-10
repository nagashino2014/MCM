// 기안 편집 진입 경로 — 양식 전용 작성 화면(공문·견적서)과 범용 기안 화면을 구분한다.
// 공문·견적서는 field_values 구조가 전용 화면 전제(본문 HTML·수신처·첨부·레이아웃 보정)라,
// 범용 기안 화면(/approval/draft)으로 열면 화면이 비어 보일 뿐 아니라 저장 시 값이 소실된다.

import { LETTER_FORM_ID } from "@/lib/letter/types";
import { QUOTE_FORM_ID } from "@/lib/quote/types";

/** 작성중·반려 문서를 이어서 편집할 화면 경로. */
export function approvalEditHref(formId: string | null | undefined, docId: string): string {
  const q = `?docId=${encodeURIComponent(docId)}`;
  if (formId === LETTER_FORM_ID) return `/approval/letter${q}`;
  if (formId === QUOTE_FORM_ID) return `/approval/quote${q}`;
  return `/approval/draft${q}`;
}
