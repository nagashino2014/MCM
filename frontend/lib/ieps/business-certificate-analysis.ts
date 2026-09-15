import { normalizeBusinessCertificateOcrText, parseBusinessCertificateText, type BusinessCertificateParseResult } from "./business-certificate-parser";
import { parseBusinessCertificateWithLlm } from "./business-certificate-llm";
import { clovaOcr, isClovaConfigured } from "@/lib/ocr/clova";
import { extractPdfTextLayer, hasUsableTextLayer } from "@/lib/ocr/pdf-text";

export interface CertificateAnalysis extends BusinessCertificateParseResult {
  ocrText: string;
  extractionMethod: string;
  needsReviewFields: string[];
  warning: string | null;
}

// 신규 등록, 갱신 업로드, 저장된 원본 재분석에서 동일한 분석 경로를 사용한다.
export async function analyzeBusinessCertificate(file: File, options: { highQuality?: boolean } = {}): Promise<CertificateAnalysis> {
  try {
    const llm = await parseBusinessCertificateWithLlm(file, options);
    if (llm && (llm.companyName || llm.businessRegistrationNo || llm.siteAddress || llm.businessType || llm.businessItem || llm.corporateRegistrationNo || llm.representativeName)) {
      const hasDetailFields = llm.businessType || llm.businessItem || llm.corporateRegistrationNo || llm.representativeName;
      return {
        ...llm, extractionMethod: options.highQuality ? "llm-high" : "llm", needsReviewFields: [],
        warning: hasDetailFields ? null : "상호·번호 등 일부 정보만 추출했습니다. 나머지 항목은 재분석하거나 수동 입력해 주세요.",
      };
    }
  } catch (err) {
    console.warn("[bizcert] LLM 파싱 실패, 폴백:", (err as Error).message);
  }

  let text = await extractPdfTextLayer(file);
  let method = "text_layer";
  let warning: string | null = null;
  if (!hasUsableTextLayer(text)) {
    text = "";
    method = "clova";
    if (isClovaConfigured()) {
      try {
        text = await clovaOcr(file);
      } catch (err) {
        console.warn("[bizcert] CLOVA OCR 실패:", (err as Error).message);
        warning = "문서 분석에 실패했습니다. 잠시 후 재분석해 주세요.";
      }
    } else {
      warning = "스캔 문서 분석 서비스가 설정되지 않았습니다. 관리자에게 문의하거나 수동 입력해 주세요.";
    }
  }
  const ocrText = normalizeBusinessCertificateOcrText(text);
  // 원문이 없을 때 파일명으로 추정한 상호를 분석 성공으로 취급하지 않는다.
  const parsed = parseBusinessCertificateText(ocrText);
  if (!parsed.businessType && !parsed.businessItem && !parsed.corporateRegistrationNo && !parsed.representativeName) {
    warning ||= "사업장에 반영할 정보를 추출하지 못했습니다. 재분석하거나 수동 입력해 주세요.";
  }
  return { ...parsed, ocrText, extractionMethod: method, needsReviewFields: [], warning };
}
