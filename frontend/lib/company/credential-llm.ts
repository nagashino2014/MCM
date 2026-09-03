/**
 * 면허/허가/등록증·인증서 → 구조화 필드 (Claude 멀티모달).
 * 사업자등록증 파서(lib/ieps/business-certificate-llm.ts) 패턴을 자사 면허/인증 문서용으로 이식 —
 * 명칭·번호·취득일·유효기간·발급기관을 추출해 회사 프로필의 보유현황 입력을 자동화한다.
 * ANTHROPIC_API_KEY 미설정 시 null 반환(호출부가 수기 입력 안내).
 */

import sharp from "sharp";
import { claudeMessages } from "@/lib/ai/claude-client";

// 등록증은 생년월일·발행일 등 혼동 요소가 많아 상위 모델 기본(실측: Haiku 는 대표자 생년월일을
// 취득일로 오파싱). 빈도 낮은 작업이라 비용 영향 미미. env 로 조정 가능.
const DEFAULT_MODEL = process.env.CREDENTIAL_PARSE_MODEL || "claude-sonnet-5";

export interface CredentialFields {
  kind: "license" | "certification";
  name: string;
  credentialNo: string;
  issuedAt: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD (없으면 빈 문자열)
  issuer: string;
  model: string;
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

/** 파일 → Anthropic content 블록(PDF=document, 이미지=sharp 정규화 image). 회사 문서 파서 공용. */
export async function toContentBlock(file: File): Promise<Record<string, unknown>> {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (IMAGE_EXT[ext]) {
    const out = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: out.toString("base64") } };
  }
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } };
}

const PROMPT =
  "이 파일은 한국 기업이 보유한 면허·허가·등록증 또는 인증서입니다" +
  "(예: 환경컨설팅회사 등록증, 엔지니어링 컨설팅업 신고증, 통합허가 대행업 등록증, " +
  "이노비즈 확인서, 벤처기업 확인서, ISO 인증서 등). **모든 페이지를 확인한 뒤** " +
  "아래 필드를 추출해 JSON만 출력하세요(설명·코드블록 금지). 값이 없으면 빈 문자열.\n" +
  "매우 중요: 문서에 실제로 인쇄된 글자만 사용하고, 없는 값을 지어내지 마세요.\n" +
  "- kind: 면허/허가/등록증이면 \"license\", 인증(이노비즈·벤처·ISO 등)이면 \"certification\".\n" +
  "- name: 문서 제목의 정식 명칭(예: '환경컨설팅회사 등록증', '통합환경관리 대행업 등록증').\n" +
  "- credentialNo: 면허/등록/인증 번호(제 N호 등 표기 그대로).\n" +
  "- issuedAt: **최초 등록(취득)일** (YYYY-MM-DD). 주의:\n" +
  "  · 등록증에 '최초 등록일'·'등록연월일' 항목이 있으면(뒤 페이지의 등록사항·변경이력 표 포함) 그 날짜를 최우선으로 사용하세요.\n" +
  "  · 문서 하단의 발행일(재발급일·변경발급일)은 최초 등록일이 따로 없을 때만 사용하세요.\n" +
  "  · **대표자(대표이사)의 생년월일은 절대 취득일이 아닙니다** — 성명 옆 괄호나 '생년월일' 라벨의 날짜는 무시하세요.\n" +
  "- validUntil: 유효기간 만료일 (YYYY-MM-DD). 유효기간 표기가 없으면 빈 문자열.\n" +
  "- issuer: **문서 하단 직인(발급 주체)의 기관명**(예: 서울특별시장, 환경부장관, 한강유역환경청장, 중소벤처기업부장관). 회사명·대표자명이 아닙니다.\n" +
  '{"kind":"license","name":"","credentialNo":"","issuedAt":"","validUntil":"","issuer":""}';

/** 면허/인증 문서 1건 파싱. 키 미설정이면 null. 실패는 throw. */
export async function parseCredentialWithLlm(file: File): Promise<CredentialFields | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const block = await toContentBlock(file);
  const r = await claudeMessages({
    feature: "company.credential_parse",
    model: DEFAULT_MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
    meta: { block_type: String((block as { type?: unknown }).type ?? "") },
  });
  if (!r.ok) {
    throw new Error(`면허/인증 분석 API 오류 (HTTP ${r.status}) ${(r.errorText ?? "").slice(0, 200)}`);
  }
  const text = r.text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("면허/인증 분석 결과를 해석하지 못했습니다.");
  const raw = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    kind: str(raw.kind) === "certification" ? "certification" : "license",
    name: str(raw.name),
    credentialNo: str(raw.credentialNo),
    issuedAt: str(raw.issuedAt),
    validUntil: str(raw.validUntil),
    issuer: str(raw.issuer),
    model: DEFAULT_MODEL,
  };
}
