import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  normalizeBusinessCertificateOcrText,
  parseBusinessCertificateText,
} from "@/lib/ieps/business-certificate-parser";
import { clovaOcr, isClovaConfigured } from "@/lib/ocr/clova";
import { extractPdfTextLayer, hasUsableTextLayer } from "@/lib/ocr/pdf-text";
import { parseBusinessCertificateWithLlm } from "@/lib/ieps/business-certificate-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_CERT_FIELDS = {
  companyName: "",
  businessRegistrationNo: "",
  representativeName: "",
  siteAddress: "",
  businessType: "",
  businessItem: "",
  businessKinds: [] as unknown[],
  corporateRegistrationNo: "",
  ocrText: "",
};

export async function POST(req: NextRequest) {
  try {
    await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "사업자등록증 PDF 파일을 첨부하세요." }, { status: 400 });
    }

    // 0) Claude 멀티모달 우선 — 옛 양식·스캔·멀티로우 업태/종목을 의미로 이해해 구조화.
    //    기본 저비용 Haiku. highQuality=1 이면 저화질용 고정밀 Opus 재분석.
    //    설정/성공 시 이게 주경로. 실패·미설정 시 아래 CLOVA·텍스트파서로 폴백.
    const highQuality = form.get("highQuality") === "1";
    try {
      const llm = await parseBusinessCertificateWithLlm(file, { highQuality });
      if (llm) {
        const hasAny =
          llm.companyName || llm.businessRegistrationNo || llm.representativeName ||
          llm.siteAddress || llm.businessType || llm.businessItem || llm.corporateRegistrationNo;
        return NextResponse.json({
          ...llm,
          ocrText: llm.ocrText.slice(0, 12000),
          extractionMethod: highQuality ? "llm-high" : "llm",
          needsReviewFields: [],
          warning: hasAny ? null : "자동 추출 결과가 부족합니다. OCR 원문을 참고해 수동 입력해 주세요.",
        });
      }
    } catch (err) {
      console.warn("[bizcert] LLM 파싱 실패, 폴백: " + (err as Error).message);
    }

    // 1) 텍스트 레이어 우선(디지털 발급본) — 있으면 OCR 호출 없이 즉시·무비용.
    let ocrText = "";
    let method = "";
    if ((file.name.split(".").pop() || "").toLowerCase() === "pdf") {
      const tl = await extractPdfTextLayer(file);
      if (hasUsableTextLayer(tl)) {
        ocrText = tl;
        method = "text_layer";
      }
    }

    // 2) 스캔·이미지(텍스트 레이어 없음) → CLOVA OCR.
    if (!ocrText) {
      if (!isClovaConfigured()) {
        return NextResponse.json({
          ...EMPTY_CERT_FIELDS,
          warning: "OCR(CLOVA)이 설정되지 않아 자동 추출을 건너뛰었습니다. 수동 입력해 주세요.",
        });
      }
      try {
        ocrText = await clovaOcr(file);
        method = "clova";
      } catch (err) {
        console.warn("[bizcert] CLOVA OCR 실패: " + (err as Error).message);
        return NextResponse.json({
          ...EMPTY_CERT_FIELDS,
          warning: "OCR 처리에 실패했습니다. 잠시 후 다시 시도하거나 수동 입력해 주세요.",
        });
      }
    }

    // 업태/종목 포함 모든 필드는 텍스트 파서가 '사업의 종류'~'발급사유' 구간을 앵커로 추출한다.
    const text = normalizeBusinessCertificateOcrText(ocrText);
    const parsed = parseBusinessCertificateText(text, { filename: file.name });
    const needsReviewFields: string[] = Array.isArray(
      (parsed as { needsReviewFields?: string[] }).needsReviewFields
    )
      ? (parsed as { needsReviewFields?: string[] }).needsReviewFields!
      : [];
    const hasAny =
      parsed.companyName ||
      parsed.businessRegistrationNo ||
      parsed.representativeName ||
      parsed.siteAddress ||
      parsed.businessType ||
      parsed.businessItem ||
      parsed.corporateRegistrationNo;

    return NextResponse.json({
      ...parsed,
      ocrText: text.slice(0, 12000),
      extractionMethod: method,
      needsReviewFields,
      warning: hasAny
        ? needsReviewFields.length
          ? "일부 필드는 확인이 필요합니다. OCR 원문과 대조해 주세요."
          : null
        : "자동 추출 결과가 부족합니다. OCR 원문을 참고해 수동 입력해 주세요.",
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
