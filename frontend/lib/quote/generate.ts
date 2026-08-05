// 견적 산출물 생성 — 승인 문서의 field_values 로 xlsx(내부 보관)+PDF(외부 제출)를 렌더해
// S3 에 보관한다. 키 관례: quotes/{연도}/{견적번호}/({견적번호}){제목}.pdf|.xlsx.
// PDF 가 공식 산출물(확정 사항 2 — 변조 차단), xlsx 는 내부 다운로드 전용.

import { getDoc } from "@/lib/approval/docs";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { renderQuotePdf } from "./pdf";
import { renderQuoteXlsx } from "./xlsx";
import { setQuoteArtifacts } from "./store";
import type { QuoteFieldValues } from "./types";

export interface QuoteArtifacts {
  pdfKey: string;
  pdfBytes: Uint8Array;
  xlsxKey: string;
  xlsxBytes: Uint8Array;
  fileBase: string; // 확장자 없는 파일명 "(번호)제목"
  quoteNo: string;
  title: string;
}

/**
 * 승인된 견적 문서의 PDF/xlsx 를 생성해 S3 보관하고 대장에 키를 기록한다.
 * persist=false 면 보관 없이 바이트만 반환(작성 중 미리보기 on-demand 렌더).
 */
export async function generateQuoteArtifacts(docId: string, opts: { persist?: boolean } = {}): Promise<QuoteArtifacts> {
  const persist = opts.persist !== false;
  const doc = await getDoc(docId);
  if (!doc) throw new Error("문서를 찾을 수 없습니다.");
  const values = doc.fieldValues as unknown as QuoteFieldValues;
  const issueDate = String(values.issue_date ?? (doc.completedAt ?? doc.submittedAt ?? new Date().toISOString()).slice(0, 10));
  const quoteNo = doc.docNo ?? "미채번";
  const input = { values, quoteNo, drafterName: doc.drafterName ?? "", issueDate };

  const pdfBytes = await renderQuotePdf(input);
  const xlsxBytes = await renderQuoteXlsx(input);

  const year = quoteNo.slice(0, 4);
  const fileBase = sanitizeFilename(`(${quoteNo})${doc.title}`);
  const pdfKey = `quotes/${year}/${quoteNo}/${fileBase}.pdf`;
  const xlsxKey = `quotes/${year}/${quoteNo}/${fileBase}.xlsx`;

  if (persist) {
    await putContractDocument(pdfKey, Buffer.from(pdfBytes), "application/pdf");
    await putContractDocument(xlsxKey, Buffer.from(xlsxBytes), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await setQuoteArtifacts(docId, xlsxKey, pdfKey);
  }

  return { pdfKey, pdfBytes, xlsxKey, xlsxBytes, fileBase, quoteNo, title: doc.title };
}
