import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import {
  normalizeBusinessCertificateOcrText,
  parseBusinessCertificateText,
} from "@/lib/ieps/business-certificate-parser";
import {
  voteBusinessCertificateCandidates,
  type OcrCandidate,
} from "@/lib/ieps/business-certificate-voting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExtractResponse {
  success?: boolean;
  text?: string;
  error_message?: string | null;
  extraction_method?: string | null;
  method?: string | null;
  quality_score?: number;
  candidates?: OcrCandidate[];
  warning?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    await requireEditor();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "사업자등록증 PDF 파일을 첨부하세요." }, { status: 400 });
    }

    const backendUrl = resolveExtractionBackendUrl();
    if (!backendUrl) {
      return NextResponse.json({
        companyName: "",
        businessRegistrationNo: "",
        representativeName: "",
        siteAddress: "",
        businessType: "",
        businessItem: "",
        businessKinds: [],
        corporateRegistrationNo: "",
        ocrText: "",
        warning: "OCR 백엔드 URL이 설정되지 않아 자동 추출을 건너뛰었습니다. 수동 입력해 주세요.",
      });
    }

    const uploadForm = new FormData();
    uploadForm.set("file", file, file.name || "business-certificate.pdf");
    const baseUrl = backendUrl.replace(/\/$/, "");
    let res = await fetch(`${baseUrl}/extract/business-certificate-v2`, {
      method: "POST",
      body: uploadForm,
    });
    if (!res.ok) {
      const fallbackForm = new FormData();
      fallbackForm.set("file", file, file.name || "business-certificate.pdf");
      res = await fetch(`${baseUrl}/extract/business-certificate`, {
        method: "POST",
        body: fallbackForm,
      });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json({
        companyName: "",
        businessRegistrationNo: "",
        representativeName: "",
        siteAddress: "",
        businessType: "",
        businessItem: "",
        businessKinds: [],
        corporateRegistrationNo: "",
        ocrText: "",
        warning: String(body?.detail ?? body?.error ?? `OCR HTTP ${res.status}`),
      });
    }

    let extracted = (await res.json()) as ExtractResponse;
    if (
      !(extracted.text ?? "").trim() &&
      (!Array.isArray(extracted.candidates) || extracted.candidates.length === 0)
    ) {
      const fallbackForm = new FormData();
      fallbackForm.set("file", file, file.name || "business-certificate.pdf");
      const fallbackRes = await fetch(`${baseUrl}/extract/business-certificate`, {
        method: "POST",
        body: fallbackForm,
      });
      if (fallbackRes.ok) {
        extracted = (await fallbackRes.json()) as ExtractResponse;
      }
    }
    const candidates = Array.isArray(extracted.candidates) ? extracted.candidates : [];
    const voted = voteBusinessCertificateCandidates(candidates, extracted.text ?? "", file.name);
    const text = voted.ocrText || normalizeBusinessCertificateOcrText(extracted.text ?? "");
    const parsed = candidates.length
      ? voted
      : parseBusinessCertificateText(text, { filename: file.name });
    const needsReviewFields = "needsReviewFields" in parsed ? parsed.needsReviewFields : [];
    return NextResponse.json({
      ...parsed,
      ocrText: text.slice(0, 12000),
      extractionMethod: extracted.extraction_method ?? extracted.method ?? null,
      qualityScore: extracted.quality_score ?? null,
      candidateCount: candidates.length,
      votedFields: "votedFields" in parsed ? parsed.votedFields : [],
      needsReviewFields,
      warning: parsed.companyName || parsed.businessRegistrationNo || parsed.representativeName || parsed.siteAddress ||
        parsed.businessType || parsed.businessItem || parsed.corporateRegistrationNo
        ? extracted.warning ?? (needsReviewFields.length ? "일부 필드는 OCR 후보 간 합의가 낮아 확인이 필요합니다." : null)
        : "자동 추출 결과가 부족합니다. OCR 원문을 참고해 수동 입력해 주세요.",
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function resolveExtractionBackendUrl(): string | null {
  return (
    process.env.MCM_EXTRACTION_BACKEND_URL ||
    process.env.MCM_BACKEND_URL ||
    process.env.MCM_JOB_BACKEND_URL ||
    null
  );
}

