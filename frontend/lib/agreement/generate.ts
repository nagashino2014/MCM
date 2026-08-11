// 계약서 산출물 생성 — 승인 문서의 field_values 로 HWPX(원본)+PDF 를 만들어 S3 에 보관한다.
// 키 관례: agreements/{연도}/{docId}/{제목}.pdf|.hwpx.
// HWPX 가 원본이고 PDF 는 그 HWPX 를 converter(LibreOffice)로 변환한 것 — 두 산출물이 완전히
// 같은 지면이 된다(2026-08-11 사용자 확정: pdf-lib 직접 렌더는 converter 불가 시 폴백 전용).
// 초안 발송의 기본 첨부는 HWPX(④ 확정), PDF 는 검토·보관·결재 심사 지면.

import { getDoc } from "@/lib/approval/docs";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { getTemplate, setAgreementArtifacts } from "./store";
import { renderAgreementPdf } from "./pdf";
import { renderAgreementHwpx } from "./hwpx";
import { convertHwpxToPdf } from "./convert";
import type { AgreementFieldValues, AgreementSpec } from "./types";

/**
 * spec+field_values → HWPX(원본) + PDF(converter 변환, 실패 시 pdf-lib 폴백).
 * 미리보기(preview)와 산출물 생성이 같은 경로를 탄다.
 */
export async function renderAgreementArtifacts(
  spec: AgreementSpec,
  fv: AgreementFieldValues,
  name: string
): Promise<{ pdfBytes: Uint8Array; hwpxBytes: Uint8Array | null }> {
  let hwpxBytes: Uint8Array | null = null;
  try {
    hwpxBytes = await renderAgreementHwpx(spec, fv);
  } catch (err) {
    console.warn(`[agreement] HWPX 생성 실패 — pdf-lib 직접 렌더로 진행:`, err);
  }
  let pdfBytes: Uint8Array | null = null;
  if (hwpxBytes) pdfBytes = await convertHwpxToPdf(hwpxBytes, `${name}.hwpx`);
  if (!pdfBytes) pdfBytes = await renderAgreementPdf(spec, fv);
  return { pdfBytes, hwpxBytes };
}

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

  const year = (doc.completedAt ?? doc.submittedAt ?? new Date().toISOString()).slice(0, 4);
  const fileBase = sanitizeFilename(doc.title || fv.title || "계약서");
  const { pdfBytes, hwpxBytes } = await renderAgreementArtifacts(tpl.spec, fv, fileBase);
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
