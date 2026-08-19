// 착수계·준공계 산출물 생성 — 저장된 문서(field_values) → HWPX + PDF.
// 키 관례: deliverables/{연도}/{deliverable_id}/{파일명}.pdf (공문 letters/… 관행 미러링).
// persist=false 면 S3 보관 없이 바이트만 반환(작성 화면 미리보기).
//
// 기본양식은 HWPX 가 원본이고 PDF 는 그 HWPX 를 좌표 그대로 옮겨 그린 것이다(hwpx-pdf.ts).
// 산출물 두 벌이 한 파일에서 나오므로 서식이 갈리지 않는다 — 제출처가 공공기관·공기업이라
// 한글본과 PDF 본의 글꼴·줄 위치가 달라 보이면 곤란하다.
// ⚠ 단 HWPX 템플릿(completion.hwpx)에는 준공 3종 장만 있다 — 준공내역서·용역결과보고서
// (인천공항에너지 실측)는 spec 렌더(pdf.ts)로 만들어 PDF 를 병합하고, HWPX 는 템플릿 산출물
// 뒤에 spec 장을 이어 붙인다(2026-08-19, 종전에는 두 서식이 산출물에서 조용히 빠졌다).
// 발주처 자체양식(D4)은 두 갈래다.
//   overlay — HWPX 로 받은 양식. 원본을 그대로 두고 값만 주입한다(template-fill.ts). 서식 100% 보존.
//   spec    — 스캔 PDF 처럼 원본 구조가 없는 입력. DeliverableSpec 으로 재구축해 pdf.ts 로 낸다.

import { PDFDocument } from "pdf-lib";
import { readStorageObject } from "@/lib/contracts/document-bundle";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import {
  CATALOG_BY_TYPE,
  CATALOG_EXTRA_COMPLETION_TYPES,
  HWPX_TEMPLATE_DOC_TYPES,
  adjustSpecForValues,
  buildPhotoAttachmentSpecs,
} from "./catalog";
import { compactAddress, renderDeliverableHwpx } from "./hwpx";
import { renderHwpxToPdf } from "./hwpx-pdf";
import { renderDeliverablePdf } from "./pdf";
import { renderPaymentHwpx } from "./payment-hwpx";
import { appendSpecsToHwpx, normalizeSpecSpacing, renderSpecHwpx } from "./spec-hwpx";
import { getDeliverable, getTemplate, setDeliverableArtifacts } from "./store";
import { fillTemplateHwpx } from "./template-fill";
import {
  DELIVERABLE_KIND_LABEL,
  parsePhotoRefs,
  type DeliverableRow,
  type DeliverableSpec,
  type DeliverableTemplateRow,
  type DeliverableValues,
  type PhotoAsset,
} from "./types";

/** 문서가 참조하는 서식 Spec 목록 — 기본양식(코드 상수) 또는 발주처 자체양식(DB, spec 모드). */
export async function resolveSpecs(row: Pick<DeliverableRow, "templateId" | "docTypes">): Promise<DeliverableSpec[]> {
  if (row.templateId) {
    const tpl = await getTemplate(row.templateId);
    if (!tpl) throw new Error("발주처 양식을 찾을 수 없습니다.");
    const byType = new Map(tpl.specs.map((s) => [s.docType, s]));
    // 템플릿에 없는 서식은 카탈로그 폴백 — 발주처 양식 + 기본 추가 서식 조합(2026-08-19)
    const picked = row.docTypes.map((t) => byType.get(t) ?? CATALOG_BY_TYPE[t]).filter((s): s is DeliverableSpec => !!s);
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

/** PNG/JPEG 픽셀 크기 — 별첨 박스 contain fit 계산용(외부 라이브러리 없이 헤더만 읽는다). */
function imageDimensions(bytes: Uint8Array): { mime: "image/png" | "image/jpeg"; w: number; h: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    return { mime: "image/png", w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      const len = dv.getUint16(off + 2);
      // SOF0~SOF15(압축 스캔 헤더) — 크기 정보가 여기 있다
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: "image/jpeg", h: dv.getUint16(off + 5), w: dv.getUint16(off + 7) };
      }
      off += 2 + len;
    }
  }
  return null;
}

/** 성과품 사진 로드 — S3 에서 읽고 픽셀 크기를 파싱한다. 못 읽은 사진은 자리만 남긴다. */
async function loadPhotoAssets(values: DeliverableValues): Promise<PhotoAsset[]> {
  const out: PhotoAsset[] = [];
  for (const ref of parsePhotoRefs(values)) {
    const bytes = await readStorageObject(ref.key).catch(() => null);
    const dim = bytes ? imageDimensions(bytes) : null;
    if (bytes && dim) {
      out.push({ name: ref.name, bytes, mime: dim.mime, w: dim.w, h: dim.h });
    } else {
      console.warn(`[deliverable] 성과품 사진 로드 실패(자리만 표시): ${ref.key}`);
      // photoIndex 가 어긋나지 않도록 1x1 투명 PNG 로 채우지 않고 렌더러가 자리 문구를 그린다
      out.push({ name: ref.name, bytes: new Uint8Array(), mime: "image/png", w: 0, h: 0 });
    }
  }
  return out;
}

async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const usable = parts.filter((p) => p.length > 0);
  if (usable.length === 1) return usable[0];
  const out = await PDFDocument.create();
  for (const part of usable) {
    const src = await PDFDocument.load(part);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  return out.save();
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

  // 성과품 사진 별첨(용역결과보고서, 2026-08-19) — 렌더 전 S3 에서 로드
  const photos = row.docTypes.includes("service_result_report") ? await loadPhotoAssets(row.values) : [];

  // 재구축 양식 공통 값 보정 — 주소는 한 줄로 앉힌다(접히면 들여쓰기를 잃고 아래가 밀린다)
  const specValues: DeliverableValues = {
    ...row.values,
    "company.address": compactAddress(String(row.values["company.address"] ?? "")),
  };

  // ── 공통 선계산: 기본 추가 서식(내역서·결과보고서·대금청구서) — 기본양식은 물론
  //    발주처 자체양식에도 조합 선택할 수 있다(2026-08-19 사용자 확정, 동두천드림파워 실사례).
  const paymentSelected = row.docTypes.includes("payment_request");
  const extraTypes = row.docTypes.filter((t) => (CATALOG_EXTRA_COMPLETION_TYPES as readonly string[]).includes(t));
  const extraSpecs = [
    ...extraTypes.map((t) => CATALOG_BY_TYPE[t]),
    ...(extraTypes.includes("service_result_report") ? buildPhotoAttachmentSpecs(row.values, photos) : []),
  ].map((s) => normalizeSpecSpacing(adjustSpecForValues(s, row.values)));

  // HWPX 가 원본인 두 경로 — 기본양식(템플릿 치환)과 발주처 자체양식(원본에 값 주입).
  // PDF 는 어느 쪽이든 같은 HWPX 를 좌표 그대로 옮겨 그린다(서식이 갈리지 않게).
  let hwpxBytes: Uint8Array | null = null;
  let bytes: Uint8Array | null = null;
  /** 폴백 통합 렌더에 extra 가 이미 포함됐으면 아래 병합에서 중복 방지 */
  let extraMerged = false;
  // PDF 를 먼저 그린다 — 값이 길어져 늘어난 줄을 흡수하려고 없앤 여백 줄(drops)을
  // 배포용 HWPX 에도 똑같이 적용해야 한글로 열었을 때 같은 배치가 나온다.
  if (!row.templateId) {
    // 기본양식 — HWPX 템플릿 보유분(착수계·준공 3종)만 여기서 렌더한다
    const tplSet = new Set(HWPX_TEMPLATE_DOC_TYPES[row.kind]);
    const tplTypes = row.docTypes.filter((t) => tplSet.has(t));
    if (tplTypes.length) {
      try {
        const forPdf = await renderDeliverableHwpx(row.kind, tplTypes, row.values, { keepLineSeg: true });
        const out = await renderHwpxToPdf(forPdf);
        bytes = out.pdf;
        hwpxBytes = await renderDeliverableHwpx(row.kind, tplTypes, row.values, { dropParas: out.drops });
      } catch (err) {
        console.warn("[deliverable] HWPX 경로 실패(자체 렌더러로 진행):", (err as Error).message);
      }
    }
  } else if (overlay && tpl?.sourceKey && tpl.profile) {
    // 발주처 자체양식(overlay) — 기본 추가 서식은 양식 원본에 없으므로 빼고 주입한다
    const tplDocTypes = row.docTypes.filter(
      (t) => !(CATALOG_EXTRA_COMPLETION_TYPES as readonly string[]).includes(t) && t !== "payment_request"
    );
    try {
      const source = await readStorageObject(tpl.sourceKey);
      const forPdf = await fillTemplateHwpx(source, tpl.profile, tplDocTypes, row.values, { keepLineSeg: true });
      const out = await renderHwpxToPdf(forPdf.bytes);
      bytes = out.pdf;
      const filled = await fillTemplateHwpx(source, tpl.profile, tplDocTypes, row.values, { dropParas: out.drops });
      hwpxBytes = filled.bytes;
      if (filled.missed.length) {
        console.warn(`[deliverable] 양식 ${tpl.templateId}: 값을 넣지 못한 자리 ${filled.missed.length}건`);
      }
    } catch (err) {
      console.warn("[deliverable] 자체양식 주입 실패(자체 렌더러로 진행):", (err as Error).message);
    }
  }
  // spec 모드(스캔 PDF 재구축) 또는 위 경로 실패 시의 폴백 — 본체와 extra 를 통합 spec 렌더.
  // 준공금 100%(기지급 0) 계약은 기지급 열을 제거한 표로 렌더한다.
  if (!bytes) {
    const baseSpecs = (await resolveSpecs(row)).filter(
      (sp) => !(CATALOG_EXTRA_COMPLETION_TYPES as readonly string[]).includes(sp.docType) && sp.docType !== "payment_request"
    );
    const adjusted = [...baseSpecs.map((sp) => normalizeSpecSpacing(adjustSpecForValues(sp, row.values))), ...extraSpecs];
    if (adjusted.length) {
      bytes = await renderDeliverablePdf(adjusted, specValues, { photos });
      extraMerged = true;
      // 재구축 양식도 한글에서 손볼 수 있게 HWPX 를 함께 낸다(사용자 요청) —
      // 서식이 원본과 똑같지는 않지만 고쳐 쓸 수 있다는 점이 중요하다.
      if (!hwpxBytes) {
        try {
          hwpxBytes = await renderSpecHwpx(adjusted, specValues, { photos });
        } catch (err) {
          console.warn("[deliverable] 재구축 HWPX 생성 실패(PDF 만 제공):", (err as Error).message);
        }
      }
    }
  }

  // ── 기본 추가 서식(내역서·결과보고서+사진 별첨) — 본체 뒤에 병합 ──
  let extraPdf: Uint8Array | null = null;
  if (extraSpecs.length && !extraMerged) {
    extraPdf = await renderDeliverablePdf(extraSpecs, specValues, { photos });
    if (!row.templateId && hwpxBytes && row.kind === "completion") {
      // 기본양식(completion.hwpx 헤더)만 HWPX 에도 이어 붙인다 — 발주처 원본(overlay)은
      // 스타일 카탈로그가 달라 병합할 수 없어 HWPX 에는 싣지 않는다(별도 선택으로 내려받음).
      try {
        hwpxBytes = await appendSpecsToHwpx(hwpxBytes, extraSpecs, specValues, { photos });
      } catch (err) {
        console.warn("[deliverable] spec 장 HWPX 병합 실패(본체 장만 제공):", (err as Error).message);
      }
    }
  }

  // ── 대금청구서 — 원본 템플릿(payment.hwpx) 치환 → 같은 파일로 PDF. 목록 마지막 병합 ──
  let paymentPdf: Uint8Array | null = null;
  if (paymentSelected) {
    try {
      const forPdf = await renderPaymentHwpx(row.values, { keepLineSeg: true });
      paymentPdf = (await renderHwpxToPdf(forPdf)).pdf;
      // HWPX 산출물: 대금청구서만 선택했으면 원본 템플릿 배포본을 그대로 낸다.
      // 다른 서식과 혼합이면 헤더(스타일 카탈로그)가 달라 한 파일로 합칠 수 없어
      // HWPX 에는 싣지 않는다 — 한글본이 필요하면 대금청구서만 따로 선택해 내려받는다.
      if (!hwpxBytes && row.docTypes.length === 1) {
        hwpxBytes = await renderPaymentHwpx(row.values);
      }
    } catch (err) {
      console.warn("[deliverable] 대금청구서 템플릿 경로 실패(재구축 폴백):", (err as Error).message);
      const fallback = [normalizeSpecSpacing(adjustSpecForValues(CATALOG_BY_TYPE["payment_request"], row.values))];
      paymentPdf = await renderDeliverablePdf(fallback, specValues, {});
    }
  }

  if (bytes || extraPdf || paymentPdf) {
    bytes = await mergePdfs([bytes ?? new Uint8Array(), extraPdf ?? new Uint8Array(), paymentPdf ?? new Uint8Array()]);
  }
  if (!bytes) throw new Error("생성할 서식을 선택하세요.");

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
