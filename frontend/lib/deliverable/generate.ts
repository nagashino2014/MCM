// 착수계·준공계 산출물 생성 — 저장된 문서(field_values) → HWPX + PDF.
// 키 관례: deliverables/{연도}/{deliverable_id}/{파일명}.pdf (공문 letters/… 관행 미러링).
// persist=false 면 S3 보관 없이 바이트만 반환(작성 화면 미리보기).
//
// 기본양식은 HWPX 가 원본이고 PDF 는 그 HWPX 를 좌표 그대로 옮겨 그린 것이다(hwpx-pdf.ts).
// 산출물 두 벌이 한 파일에서 나오므로 서식이 갈리지 않는다 — 제출처가 공공기관·공기업이라
// 한글본과 PDF 본의 글꼴·줄 위치가 달라 보이면 곤란하다.
// 발주처 자체양식은 아직 대응 HWPX 템플릿이 없어 Spec 기반 자체 레이아웃(pdf.ts)으로 낸다.

import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { CATALOG_BY_TYPE, adjustSpecForValues } from "./catalog";
import { renderDeliverableHwpx } from "./hwpx";
import { renderHwpxToPdf } from "./hwpx-pdf";
import { renderDeliverablePdf } from "./pdf";
import { getDeliverable, getTemplate, setDeliverableArtifacts } from "./store";
import { DELIVERABLE_KIND_LABEL, type DeliverableRow, type DeliverableSpec } from "./types";

/** 문서가 참조하는 서식 Spec 목록 — 기본양식(코드 상수) 또는 발주처 자체양식(DB). */
export async function resolveSpecs(row: Pick<DeliverableRow, "templateId" | "docTypes">): Promise<DeliverableSpec[]> {
  if (row.templateId) {
    const tpl = await getTemplate(row.templateId);
    if (!tpl) throw new Error("발주처 양식을 찾을 수 없습니다.");
    const byType = new Map(tpl.specs.map((s) => [s.docType, s]));
    const picked = row.docTypes.map((t) => byType.get(t)).filter((s): s is DeliverableSpec => !!s);
    return picked.length ? picked : tpl.specs;
  }
  return row.docTypes.map((t) => CATALOG_BY_TYPE[t]).filter((s): s is DeliverableSpec => !!s);
}

export interface DeliverableArtifacts {
  pdfKey: string | null;
  pdfBytes: Uint8Array;
  hwpxKey: string | null;
  hwpxBytes: Uint8Array | null;
  fileBase: string; // 확장자 없는 파일명
}

export async function generateDeliverableArtifacts(
  deliverableId: string,
  opts: { persist?: boolean } = {}
): Promise<DeliverableArtifacts> {
  const persist = opts.persist === true;
  const row = await getDeliverable(deliverableId);
  if (!row) throw new Error("문서를 찾을 수 없습니다.");
  const specs = await resolveSpecs(row);
  if (!specs.length) throw new Error("생성할 서식을 선택하세요.");

  const kindLabel = DELIVERABLE_KIND_LABEL[row.kind];
  const fileBase = sanitizeFilename(`(${kindLabel})${row.title}`);

  // HWPX(D2) — 기본양식만 지원한다. 발주처 자체양식은 대응 템플릿이 없어 PDF 만 낸다.
  let hwpxBytes: Uint8Array | null = null;
  let bytes: Uint8Array | null = null;
  if (!row.templateId) {
    try {
      hwpxBytes = await renderDeliverableHwpx(row.kind, row.docTypes, row.values);
      // PDF 는 같은 HWPX 를 좌표 그대로 옮겨 그린다 — 두 산출물의 서식이 어긋나면
      // 공공기관·공기업 제출에서 문제가 된다. 좌표를 남긴 사본을 따로 만들어 렌더한다.
      const forPdf = await renderDeliverableHwpx(row.kind, row.docTypes, row.values, { keepLineSeg: true });
      bytes = await renderHwpxToPdf(forPdf);
    } catch (err) {
      console.warn("[deliverable] HWPX 경로 실패(자체 렌더러로 진행):", (err as Error).message);
    }
  }
  // 발주처 자체양식(또는 HWPX 실패)은 Spec 기반 자체 레이아웃으로 낸다.
  // 준공금 100%(기지급 0) 계약은 기지급 열을 제거한 표로 렌더한다.
  if (!bytes) {
    bytes = await renderDeliverablePdf(specs.map((s) => adjustSpecForValues(s, row.values)), row.values);
  }

  if (!persist) return { pdfKey: null, pdfBytes: bytes, hwpxKey: null, hwpxBytes, fileBase };

  const year = (row.values["issue.date"] != null ? String(row.values["issue.date"]) : row.createdAt).slice(0, 4);
  const dir = `deliverables/${year}/${row.deliverableId}`;
  const pdfKey = `${dir}/${fileBase}.pdf`;
  await putContractDocument(pdfKey, Buffer.from(bytes), "application/pdf");
  let hwpxKey: string | null = null;
  if (hwpxBytes) {
    hwpxKey = `${dir}/${fileBase}.hwpx`;
    await putContractDocument(hwpxKey, Buffer.from(hwpxBytes), "application/vnd.hancom.hwpx");
  }
  await setDeliverableArtifacts(deliverableId, { pdfKey, hwpxKey });
  return { pdfKey, pdfBytes: bytes, hwpxKey, hwpxBytes, fileBase };
}
