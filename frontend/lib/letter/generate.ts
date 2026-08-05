// 공문 산출물 생성 — 승인 문서의 field_values 로 PDF(+가능하면 HWPX)를 렌더해 S3 에 보관한다.
// 키 관례: letters/{연도}/{공문번호}/({공문번호}){제목}.pdf|.hwpx (V: 드라이브 폴더 관행 미러링).
// PDF 가 공식 산출물이고 HWPX 는 편집용 사본 — 템플릿(letter.hwpx) 미배치 등으로 HWPX 생성이
// 실패해도 PDF 만으로 발송을 진행한다(경고만 기록).

import { getDoc } from "@/lib/approval/docs";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { composeLetter } from "./compose";
import { measureSignTextWidths, renderLetterPdf } from "./pdf";
import { renderLetterHwpx } from "./hwpx";
import { setLetterArtifacts } from "./store";
import type { LetterFieldValues } from "./types";

export interface LetterArtifacts {
  pdfKey: string;
  pdfBytes: Uint8Array;
  hwpxKey: string | null;
  hwpxBytes: Uint8Array | null;
  fileBase: string; // 확장자 없는 파일명 "(번호)제목"
  letterNo: string;
  title: string;
  fitted: boolean;
}

/**
 * 승인된 공문 문서의 PDF/HWPX 를 생성해 S3 보관하고 대장에 키를 기록한다.
 * persist=false 면 보관 없이 바이트만 반환(진행 중 문서의 열람용 on-demand 렌더).
 */
export async function generateLetterArtifacts(docId: string, opts: { persist?: boolean } = {}): Promise<LetterArtifacts> {
  const persist = opts.persist !== false;
  const doc = await getDoc(docId);
  if (!doc) throw new Error("문서를 찾을 수 없습니다.");
  const values = doc.fieldValues as unknown as LetterFieldValues;
  const issueDate = (doc.completedAt ?? doc.submittedAt ?? new Date().toISOString()).slice(0, 10);
  const layout = composeLetter(values, {
    letterNo: doc.docNo,
    drafterName: doc.drafterName,
    drafterPosition: doc.drafterPosition,
    issueDate,
  });

  const pdf = await renderLetterPdf(layout);

  // HWPX — PDF fit 그대로 적용. 본문 끝~서명줄 여백을 빈 문단 수로 환산해 전달.
  // 한글 본문 줄간은 180%(템플릿 실측)라 PDF(160%)보다 커서 그대로 환산하면 페이지가 넘친다
  // → 1.8 계수로 나누고 상한 6문단(사용자 실측: 과도한 여백으로 2쪽 발생 방지).
  let hwpxBytes: Uint8Array | null = null;
  const hwpxLineH = pdf.fit.bodyFontPt * ((layout.overrides?.lineSpacingPct ?? 180) / 100);
  const gapLines = Math.min(4, Math.max(1, Math.round((pdf.bodyEndY - pdf.signatureY) / hwpxLineH) - 2));
  try {
    const signWidths = await measureSignTextWidths(layout.companyKo, layout.ceoName);
    hwpxBytes = await renderLetterHwpx(layout, { fit: pdf.fit, gapLinesAfterBody: gapLines, signWidths });
  } catch (err) {
    console.warn("[letter] HWPX 생성 실패(PDF 만 진행):", (err as Error).message);
  }

  const letterNo = doc.docNo ?? "미채번";
  const year = letterNo.slice(0, 4);
  const fileBase = sanitizeFilename(`(${letterNo})${doc.title}`);
  const pdfKey = `letters/${year}/${letterNo}/${fileBase}.pdf`;
  const hwpxKey = hwpxBytes ? `letters/${year}/${letterNo}/${fileBase}.hwpx` : null;

  if (persist) {
    await putContractDocument(pdfKey, Buffer.from(pdf.bytes), "application/pdf");
    if (hwpxBytes && hwpxKey) {
      await putContractDocument(hwpxKey, Buffer.from(hwpxBytes), "application/vnd.hancom.hwpx");
    }
    await setLetterArtifacts(docId, pdfKey, hwpxKey, pdf.fit);
  }

  return { pdfKey, pdfBytes: pdf.bytes, hwpxKey, hwpxBytes, fileBase, letterNo, title: doc.title, fitted: pdf.fitted };
}
