// 내부고시 산출물 — 결재 문서의 field_values 로 PDF 를 on-demand 렌더한다(보관·발송 없음).
// 문서 뷰어(/api/approval/docs/[docId]/pdf)가 결재 심사·열람 모두 최종 지면으로 보여 준다.

import { getDoc } from "@/lib/approval/docs";
import { sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { ISO_DATE_RE } from "@/lib/letter/types";
import { renderNoticePdf } from "./pdf";
import type { NoticeFieldValues } from "./types";

export async function generateNoticePdf(docId: string): Promise<{ pdfBytes: Uint8Array; fileBase: string }> {
  const doc = await getDoc(docId);
  if (!doc) throw new Error("문서를 찾을 수 없습니다.");
  const values = doc.fieldValues as unknown as NoticeFieldValues;
  // 시행일 — 수동 지정이 있으면 우선, 없으면 결재 완료일(진행 중이면 상신일·오늘)
  const issueDate = ISO_DATE_RE.test(values.issue_date ?? "")
    ? (values.issue_date as string)
    : (doc.completedAt ?? doc.submittedAt ?? new Date().toISOString()).slice(0, 10);
  const pdfBytes = await renderNoticePdf({ ...values, subject: values.subject || doc.title }, { docNo: doc.docNo, issueDate });
  return { pdfBytes, fileBase: sanitizeFilename(`(${doc.docNo ?? "미채번"})${doc.title}`) };
}
