// 계약서 산출물 생성 — 승인 문서의 field_values 로 PDF(검토·보관)+HWPX(발주처 수정 협의용)를
// 렌더해 S3 에 보관한다. 키 관례: agreements/{연도}/{docId}/{제목}.pdf|.hwpx.
// 초안 발송의 기본 첨부는 HWPX(④ 확정 — 발주처 담당자의 수정 요구가 전제), PDF 는 선택.
// HWPX 생성 실패는 발송을 막지 않는다(공문 generate 관례 — PDF 만으로 진행, warn).

import { getDoc } from "@/lib/approval/docs";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { getTemplate, setAgreementArtifacts } from "./store";
import { renderAgreementPdf } from "./pdf";
import { renderAgreementHwpx } from "./hwpx";
import type { AgreementFieldValues } from "./types";

export interface AgreementArtifacts {
  pdfKey: string;
  pdfBytes: Uint8Array;
  hwpxKey: string | null;
  hwpxBytes: Uint8Array | null;
  fileBase: string;
  title: string;
}

export async function generateAgreementArtifacts(
  docId: string,
  opts: { persist?: boolean } = {}
): Promise<AgreementArtifacts> {
  const persist = opts.persist !== false;
  const doc = await getDoc(docId);
  if (!doc) throw new Error("문서를 찾을 수 없습니다.");
  const fv = doc.fieldValues as unknown as AgreementFieldValues;
  if (!fv?.templateId) throw new Error("계약서 양식 정보가 없습니다.");
  const tpl = await getTemplate(fv.templateId);
  if (!tpl) throw new Error("계약서 양식을 찾을 수 없습니다.");

  const pdfBytes = await renderAgreementPdf(tpl.spec, fv);
  let hwpxBytes: Uint8Array | null = null;
  try {
    hwpxBytes = await renderAgreementHwpx(tpl.spec, fv);
  } catch (err) {
    console.warn(`[agreement] HWPX 생성 실패(docId=${docId}) — PDF 만으로 진행:`, err);
  }

  const year = (doc.completedAt ?? doc.submittedAt ?? new Date().toISOString()).slice(0, 4);
  const fileBase = sanitizeFilename(doc.title || fv.title || "계약서");
  const pdfKey = `agreements/${year}/${docId}/${fileBase}.pdf`;
  const hwpxKey = hwpxBytes ? `agreements/${year}/${docId}/${fileBase}.hwpx` : null;

  if (persist) {
    await putContractDocument(pdfKey, Buffer.from(pdfBytes), "application/pdf");
    if (hwpxBytes && hwpxKey) {
      await putContractDocument(hwpxKey, Buffer.from(hwpxBytes), "application/vnd.hancom.hwpx");
    }
    await setAgreementArtifacts(docId, pdfKey, hwpxKey);
  }

  return { pdfKey, pdfBytes, hwpxKey, hwpxBytes, fileBase, title: doc.title };
}
