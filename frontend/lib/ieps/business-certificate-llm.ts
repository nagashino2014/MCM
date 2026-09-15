/**
 * 사업자등록증 → 구조화 필드 (Claude 멀티모달, Anthropic Messages API 직접 호출).
 * - 옛 양식·조악한 스캔·다항목/두루뭉술 업태·종목을 의미로 이해해 멀티로우 표를 정확히 분리한다.
 * - PDF 는 document 블록(네이티브)으로, 이미지는 sharp 정규화 후 image 블록으로 전송.
 * - ANTHROPIC_API_KEY 미설정 시 null 반환(호출부가 CLOVA/텍스트 파서로 폴백).
 * - 명함 파서(lib/sales/business-card-parser.ts) 패턴을 사업자등록증용으로 이식.
 */

import sharp from "sharp";
import { claudeMessages } from "@/lib/ai/claude-client";

// 기본은 저비용 Haiku(대다수 일반 품질 등록증). 저화질로 판독이 안 되면 사용자가
// '고정밀 재분석'을 눌러 Opus 로 재시도(highQuality=true). 각각 env 로 조정 가능.
const DEFAULT_MODEL = process.env.BUSINESS_CERT_MODEL || "claude-haiku-4-5-20251001";
const HIGH_MODEL = process.env.BUSINESS_CERT_MODEL_HIGH || "claude-opus-4-8";

export interface BusinessCertKind {
  businessType: string; // 업태
  businessItem: string; // 종목
}

export interface BusinessCertFields {
  companyName: string;
  businessRegistrationNo: string;
  representativeName: string;
  siteAddress: string;
  corporateRegistrationNo: string;
  businessKinds: BusinessCertKind[];
  businessType: string; // businessKinds 의 업태들을 개행으로 합친 값(기존 응답 호환)
  businessItem: string; // businessKinds 의 종목들을 개행으로 합친 값
  ocrText: string;
  model: string; // 실제 사용한 모델(표시용)
}

const IMAGE_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const str = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "null" ? "" : s;
};

/** 파일 → Anthropic content 블록(PDF=document, 이미지=image). */
async function toContentBlock(file: File): Promise<Record<string, unknown>> {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
    };
  }

  // 이미지: 장변 2000px·JPEG 재인코딩(EXIF 회전 반영). 사업자등록증 판독에 충분하고 토큰 절감.
  if (IMAGE_EXT[ext]) {
    const out = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: out.toString("base64") },
    };
  }

  // 알 수 없는 확장자는 PDF 로 간주(대부분 사업자등록증은 PDF).
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
  };
}

const PROMPT =
  "이 파일은 한국 사업자등록증입니다(법인/개인, 스캔·촬영·구(舊)양식 포함될 수 있음). " +
  "아래 필드를 추출해 JSON만 출력하세요(설명·코드블록 금지). 값이 없으면 빈 문자열/빈 배열.\n" +
  "매우 중요: **문서에 실제로 인쇄된 글자만** 사용하세요. 문서에 없는 값을 지어내거나 일반적인 분류명으로 바꾸지 마세요.\n" +
  "- companyName: 상호 또는 법인명(단체명). ㈜/(주) 등 표기 그대로.\n" +
  "- businessRegistrationNo: 등록번호(000-00-00000 형식).\n" +
  "- representativeName: 대표자 성명. 글자 하나까지 신중히 판독하고, 불확실한 글자를 비슷한 다른 글자로 임의 대체하지 마세요.\n" +
  "- corporateRegistrationNo: 법인등록번호(있으면, 000000-0000000).\n" +
  "- siteAddress: 사업장 소재지 전체 주소.\n" +
  "- businessKinds: '사업의 종류' 표의 각 행을 {businessType(업태), businessItem(종목)} 객체로. 규칙:\n" +
  "  · 표의 행 수와 순서를 문서 그대로 유지하고, 각 행의 업태와 종목을 그 행에 인쇄된 대로만 짝지으세요.\n" +
  "  · 문서에 없는 업태/종목을 절대 새로 만들지 마세요. 특히 '서비스업' 등 문서에 없는 일반 분류명을 추가하지 마세요.\n" +
  "  · 같은 업태 문구가 여러 행에 반복되면, 반복된 그대로 각 행에 다시 넣으세요(중복 제거·병합 금지).\n" +
  "  · 한 칸에 종목이 여러 개면 businessItem에 콤마로 나열. 업태만 있고 종목이 없으면 businessItem은 빈 문자열.\n" +
  "  · 업태 칸이 잘 안 보이면 지어내지 말고 businessType을 빈 문자열로 두세요.\n" +
  "- ocrText: 문서에서 읽은 원문 텍스트 전체(줄바꿈 유지). 판독이 불확실한 부분도 원문 그대로 남기세요.\n" +
  '{"companyName":"","businessRegistrationNo":"","representativeName":"","corporateRegistrationNo":"",' +
  '"siteAddress":"","businessKinds":[{"businessType":"","businessItem":""}],"ocrText":""}';

/**
 * 사업자등록증 1건을 구조화 필드로 파싱. 키 미설정이면 null(폴백). 실패는 throw.
 * highQuality=true 면 고정밀 Opus 로 재분석(저화질 스캔용).
 */
export async function parseBusinessCertificateWithLlm(
  file: File,
  opts?: { highQuality?: boolean }
): Promise<BusinessCertFields | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model = opts?.highQuality ? HIGH_MODEL : DEFAULT_MODEL;
  const block = await toContentBlock(file);

  const r = await claudeMessages({
    feature: opts?.highQuality ? "business_certificate.parse:high" : "business_certificate.parse",
    model,
    max_tokens: 3000,
    messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
    meta: { block_type: String((block as { type?: unknown }).type ?? "") },
  });

  if (!r.ok) {
    throw new Error(`사업자등록증 분석 API 오류 (HTTP ${r.status}) ${(r.errorText ?? "").slice(0, 200)}`);
  }

  const text = r.text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("사업자등록증 분석 결과를 해석하지 못했습니다.");
  const raw = JSON.parse(match[0]) as Record<string, unknown>;

  const kindsRaw = Array.isArray(raw.businessKinds) ? raw.businessKinds : [];
  const businessKinds: BusinessCertKind[] = kindsRaw
    .map((k) => {
      const o = (k ?? {}) as Record<string, unknown>;
      return { businessType: str(o.businessType), businessItem: str(o.businessItem) };
    })
    .filter((k) => k.businessType || k.businessItem);

  return {
    companyName: str(raw.companyName),
    businessRegistrationNo: str(raw.businessRegistrationNo),
    representativeName: str(raw.representativeName),
    corporateRegistrationNo: str(raw.corporateRegistrationNo),
    siteAddress: str(raw.siteAddress),
    businessKinds,
    businessType: businessKinds.map((k) => k.businessType).filter(Boolean).join("\n"),
    businessItem: businessKinds.map((k) => k.businessItem).filter(Boolean).join("\n"),
    ocrText: str(raw.ocrText),
    model,
  };
}
