// 착수계·준공계 산출물 생성 — 저장된 문서(field_values) → HWPX + PDF.
// 키 관례: deliverables/{연도}/{deliverable_id}/{파일명}.pdf (공문 letters/… 관행 미러링).
// persist=false 면 S3 보관 없이 바이트만 반환(작성 화면 미리보기).
//
// 기본양식은 HWPX 가 원본이고 PDF 는 그 HWPX 를 좌표 그대로 옮겨 그린 것이다(hwpx-pdf.ts).
// 산출물 두 벌이 한 파일에서 나오므로 서식이 갈리지 않는다 — 제출처가 공공기관·공기업이라
// 한글본과 PDF 본의 글꼴·줄 위치가 달라 보이면 곤란하다.
// 발주처 자체양식(D4)은 두 갈래다.
//   overlay — HWPX 로 받은 양식. 원본을 그대로 두고 값만 주입한다(template-fill.ts). 서식 100% 보존.
//   spec    — 스캔 PDF 처럼 원본 구조가 없는 입력. DeliverableSpec 으로 재구축해 pdf.ts 로 낸다.

import { readStorageObject } from "@/lib/contracts/document-bundle";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { CATALOG_BY_TYPE, adjustSpecForValues } from "./catalog";
import { compactAddress, renderDeliverableHwpx } from "./hwpx";
import { renderHwpxToPdf } from "./hwpx-pdf";
import { renderDeliverablePdf } from "./pdf";
import { normalizeSpecSpacing, renderSpecHwpx } from "./spec-hwpx";
import { getDeliverable, getTemplate, setDeliverableArtifacts } from "./store";
import { fillTemplateHwpx } from "./template-fill";
import { DELIVERABLE_KIND_LABEL, type DeliverableRow, type DeliverableSpec, type DeliverableTemplateRow } from "./types";

/** 문서가 참조하는 서식 Spec 목록 — 기본양식(코드 상수) 또는 발주처 자체양식(DB, spec 모드). */
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

/** overlay 템플릿의 서식 목록 — 작성 화면의 서식 선택과 붙임 목록이 이 제목을 쓴다. */
export function templateDocTitles(tpl: DeliverableTemplateRow): { docType: string; title: string }[] {
  if (tpl.renderMode === "overlay") {
    return (tpl.profile?.docs ?? []).map((d) => ({ docType: d.docType, title: d.title }));
  }
  return tpl.specs.map((s) => ({ docType: s.docType, title: s.title }));
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
  const tpl = row.templateId ? await getTemplate(row.templateId) : null;
  if (row.templateId && !tpl) throw new Error("발주처 양식을 찾을 수 없습니다.");
  const overlay = tpl?.renderMode === "overlay";

  const kindLabel = DELIVERABLE_KIND_LABEL[row.kind];
  const fileBase = sanitizeFilename(`(${kindLabel})${row.title}`);

  // HWPX 가 원본인 두 경로 — 기본양식(템플릿 치환)과 발주처 자체양식(원본에 값 주입).
  // PDF 는 어느 쪽이든 같은 HWPX 를 좌표 그대로 옮겨 그린다(서식이 갈리지 않게).
  let hwpxBytes: Uint8Array | null = null;
  let bytes: Uint8Array | null = null;
  // PDF 를 먼저 그린다 — 값이 길어져 늘어난 줄을 흡수하려고 없앤 여백 줄(drops)을
  // 배포용 HWPX 에도 똑같이 적용해야 한글로 열었을 때 같은 배치가 나온다.
  if (!row.templateId) {
    try {
      const forPdf = await renderDeliverableHwpx(row.kind, row.docTypes, row.values, { keepLineSeg: true });
      const out = await renderHwpxToPdf(forPdf);
      bytes = out.pdf;
      hwpxBytes = await renderDeliverableHwpx(row.kind, row.docTypes, row.values, { dropParas: out.drops });
    } catch (err) {
      console.warn("[deliverable] HWPX 경로 실패(자체 렌더러로 진행):", (err as Error).message);
    }
  } else if (overlay && tpl?.sourceKey && tpl.profile) {
    try {
      const source = await readStorageObject(tpl.sourceKey);
      const forPdf = await fillTemplateHwpx(source, tpl.profile, row.docTypes, row.values, { keepLineSeg: true });
      const out = await renderHwpxToPdf(forPdf.bytes);
      bytes = out.pdf;
      const filled = await fillTemplateHwpx(source, tpl.profile, row.docTypes, row.values, { dropParas: out.drops });
      hwpxBytes = filled.bytes;
      if (filled.missed.length) {
        console.warn(`[deliverable] 양식 ${tpl.templateId}: 값을 넣지 못한 자리 ${filled.missed.length}건`);
      }
    } catch (err) {
      console.warn("[deliverable] 자체양식 주입 실패(자체 렌더러로 진행):", (err as Error).message);
    }
  }
  // spec 모드(스캔 PDF 재구축) 또는 위 경로 실패 시의 폴백.
  // 준공금 100%(기지급 0) 계약은 기지급 열을 제거한 표로 렌더한다.
  if (!bytes) {
    const specs = await resolveSpecs(row);
    if (!specs.length) throw new Error("생성할 서식을 선택하세요.");
    // 여백은 normalizeSpecSpacing 이 규칙대로 다시 심는다 — PDF·HWPX 가 같은 spec 을 보게 해
    // 두 산출물의 간격이 갈리지 않게 한다(LLM 이 준 spacer 는 문서마다 제각각이다)
    const adjusted = specs.map((s) => normalizeSpecSpacing(adjustSpecForValues(s, row.values)));
    // 재구축 양식의 주소는 한 줄로 앉힌다 — 접히면 들여쓰기를 잃고 아래가 밀린다
    const specValues = {
      ...row.values,
      "company.address": compactAddress(String(row.values["company.address"] ?? "")),
    };
    bytes = await renderDeliverablePdf(adjusted, specValues);
    // 재구축 양식도 한글에서 손볼 수 있게 HWPX 를 함께 낸다(사용자 요청) —
    // 서식이 원본과 똑같지는 않지만 고쳐 쓸 수 있다는 점이 중요하다.
    if (!hwpxBytes) {
      try {
        hwpxBytes = await renderSpecHwpx(adjusted, specValues);
      } catch (err) {
        console.warn("[deliverable] 재구축 HWPX 생성 실패(PDF 만 제공):", (err as Error).message);
      }
    }
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
