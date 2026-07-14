// 명함 이미지 → 구조화 연락처 필드 (Claude vision, Anthropic Messages API 직접 호출).
// 명함은 레이아웃이 비정형이라 OCR+정규식 대신 멀티모달로 한 번에 추출한다.
// ANTHROPIC_API_KEY 미설정 시 null 반환 — 호출부가 수동 입력 안내로 폴백.

import sharp from "sharp";
import { formatCompanyName } from "@/lib/ieps/formatters";

const MODEL = process.env.BUSINESS_CARD_MODEL || "claude-haiku-4-5-20251001";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export interface BusinessCardFields {
  personName: string | null;
  title: string | null; // 직급·직책
  department: string | null;
  companyName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  faxNumber: string | null;
  email: string | null;
  address: string | null;
  /** 명함에 있는 그 외 텍스트(홈페이지 등) 한 줄 요약 */
  etc: string | null;
}

export interface BusinessCardParseResult {
  fields: BusinessCardFields;
  model: string;
}

const FIELD_KEYS: (keyof BusinessCardFields)[] = [
  "personName", "title", "department", "companyName",
  "mobilePhone", "officePhone", "faxNumber", "email", "address", "etc",
];

/** Anthropic 이미지 제한(5MB·8000px) 대응 — 장변 1600px·JPEG 재인코딩. 명함 판독에는 충분. */
async function normalizeImage(input: Buffer): Promise<{ data: string; mediaType: string }> {
  const out = await sharp(input, { failOn: "none" })
    .rotate() // EXIF 회전 반영(폰 촬영 세로/가로)
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { data: out.toString("base64"), mediaType: "image/jpeg" };
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== "null" ? s : null;
};

/** 한글 이름 자간 정규화 — 명함은 "정 형 진"처럼 벌려 인쇄하는 경우가 많다(2~4자만). */
function normalizePersonName(v: string | null): string | null {
  if (!v) return null;
  const compact = v.replace(/\s+/g, "");
  if (/^[가-힣]{2,4}$/.test(compact)) return compact;
  return v.trim();
}

/** 전화번호 표기 정규화(하이픈) — 파싱 실패 시 원문 유지. */
function normalizePhone(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("010")) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 9 && digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return v.trim();
}

/**
 * 명함 이미지 1장을 필드로 파싱. 키 미설정이면 null(호출부 수동 입력 폴백).
 * 실패(HTTP·파싱)는 throw — 라우트에서 사용자 메시지로 변환.
 */
export async function parseBusinessCard(image: Buffer): Promise<BusinessCardParseResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { data, mediaType } = await normalizeImage(image);
  const prompt =
    "이 이미지는 명함입니다(회전·기울어진 채 촬영됐을 수 있으니 방향을 바로잡아 읽으세요). " +
    "아래 필드를 추출해 JSON 만 출력하세요(설명·코드블록 금지). " +
    "없는 필드는 null. 값은 명함 표기 그대로(번역·추측 금지), 전화번호는 국내 표기 유지.\n" +
    "- title 에는 직급·직책만, 부서·본부·팀·실·소속 명칭은 department 로 분리. 붙어 있어도 나눈다" +
    '(예: "부장 / 환경사업본부" → title "부장", department "환경사업본부" / "영업팀 김대리" → department "영업팀", title "대리" / ' +
    '"솔루션사업부 IT구축팀 | 컨설턴트" → department "솔루션사업부 IT구축팀", title "컨설턴트" — 부서 라인 끝의 |·/ 뒤 직급을 놓치지 말 것). ' +
    "직급 표기는 다양하다(사원/주임/대리/과장/차장/부장/팀장/실장/소장/이사/상무/전무/부사장/대표이사/책임/선임/수석/프로/매니저/PM/컨설턴트 등) — " +
    "이름 옆·아래나 부서 라인 끝의 작은 글씨까지 확인. 명함에 직급이 정말 없을 때만 null.\n" +
    "- companyName 은 이 사람의 실제 소속 회사. 그룹·제휴·솔루션 브랜드 로고가 크게 있어도 그것이 소속사가 아닐 수 있다 — " +
    "㈜/(주)/Co.,Ltd 가 붙은 표기, 이메일 도메인, 주소와 함께 적힌 회사명을 우선 채택.\n" +
    '{"personName": 이름, "title": 직급·직책, "department": 부서, "companyName": 회사명, ' +
    '"mobilePhone": 휴대폰(M/Mobile/HP), "officePhone": 유선전화(T/Tel), "faxNumber": 팩스(F/Fax), ' +
    '"email": 이메일, "address": 주소, "etc": 그 외 정보(홈페이지 등) 한 줄 또는 null}';

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`명함 분석 API 오류 (HTTP ${res.status}) ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("명함 분석 결과를 해석하지 못했습니다.");
  const raw = JSON.parse(match[0]) as Record<string, unknown>;

  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, str(raw[k])])) as unknown as BusinessCardFields;
  fields.personName = normalizePersonName(fields.personName);
  // 법인격 표기 통일 — (주)/주식회사→㈜, 유한회사→(유). 기존 사업장 표기와 맞아야 검색이 매칭된다.
  fields.companyName = formatCompanyName(fields.companyName);
  fields.mobilePhone = normalizePhone(fields.mobilePhone);
  fields.officePhone = normalizePhone(fields.officePhone);
  fields.faxNumber = normalizePhone(fields.faxNumber);
  return { fields, model: MODEL };
}
