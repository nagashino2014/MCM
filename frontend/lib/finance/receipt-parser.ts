// 카드 지류 영수증 이미지 → 구조화 지출 필드 (Claude vision, Anthropic Messages API 직접 호출).
// 명함 파서(lib/sales/business-card-parser.ts) 패턴 이식 — 영수증도 레이아웃이 비정형이라
// OCR+정규식 대신 멀티모달로 한 번에 추출한다. ANTHROPIC_API_KEY 미설정 시 null 반환(수동 입력 폴백).
// 설계: docs/accounting-expansion-blueprint.md §2.3 (P1)

import sharp from "sharp";

import { isValidCorpNum, normalizeCorpNum } from "@/lib/finance/store-directory";

const MODEL = process.env.RECEIPT_PARSE_MODEL || "claude-haiku-4-5-20251001";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export interface ReceiptFields {
  storeName: string | null;
  storeCorpNum: string | null; // 사업자번호 10자리
  paidAt: string | null; // YYYY-MM-DD HH:MM (시각 불명이면 날짜만)
  totalAmount: number | null;
  supplyAmount: number | null;
  taxAmount: number | null;
  cardLast4: string | null;
  approvalNum: string | null;
  items: string[]; // 품목 요약(상위 3개)
}

export interface ReceiptParseResult {
  fields: ReceiptFields;
  model: string;
  /** 원본 그대로 정규화된 JPEG(저장용 — 재인코딩 중복 방지) */
  normalizedImage: Buffer;
}

/** Anthropic 이미지 제한(5MB·8000px) 대응 — 장변 1600px·JPEG 재인코딩. 영수증 판독·보관에 충분.
 *  저장 라우트도 같은 정규화본을 스토리지에 적재한다(원본 재전송 시 중복 인코딩 방지용 export). */
export async function normalizeReceiptImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate() // EXIF 회전 반영(폰 촬영 세로/가로)
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== "null" ? s : null;
};

/** 금액 파싱 — "12,345원" 같은 표기 정리. 실패 시 null. */
const money = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? Math.round(n) : Number.isFinite(n) && n === 0 ? 0 : null;
};

/**
 * 거래일시 정규화 — "2026-08-16 12:30:11"/"2026/08/16"/"26.08.16"/"2026년 8월 16일" 등을
 * "YYYY-MM-DD HH:MM"(시각 불명이면 날짜만)으로 맞춘다. 해석 불가면 null.
 *
 * 저장 계약이다 — paid_at 은 text 컬럼이고 조회가 문자열 비교라, 여기서 걸러지지 않은 표기는
 * 목록 기간 필터 밖으로 떨어진다. 파싱 결과뿐 아니라 **사용자 입력(모바일 확인 폼·수정)도**
 * 저장 라우트에서 이 함수를 통과시킨다.
 */
export function normalizePaidAt(v: string | null): string | null {
  if (!v) return null;
  const s = v
    .replace(/\s*년\s*/g, "-")
    .replace(/\s*월\s*/g, "-")
    .replace(/\s*일\s*/g, " ")
    .replace(/[.\/]/g, "-");
  // 연도는 4자리 우선, 없으면 2자리(감열지 영수증에 흔한 "26-08-16")를 2000년대로 본다.
  const m = s.match(/(\d{4}|\d{2})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, yRaw, mo, d, h, mi] = m;
  const y = yRaw.length === 4 ? yRaw : String(2000 + Number(yRaw));
  const mon = Number(mo);
  const day = Number(d);
  if (!(mon >= 1 && mon <= 12) || !(day >= 1 && day <= 31)) return null;
  const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (!h) return date;
  const hour = Number(h);
  if (!(hour >= 0 && hour <= 23) || !(Number(mi) >= 0 && Number(mi) <= 59)) return date;
  return `${date} ${h.padStart(2, "0")}:${mi}`;
}

/** KST 기준 오늘 YYYY-MM-DD. */
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 파싱 결과 중 사람이 확인해야 할 지점을 문장으로 만든다. 저장을 막지는 않는다(판단은 사용자 몫).
 *
 * 실제 사고: OCR 이 사용일 연도를 2020년으로 읽은 건이 기안 피커의 최근 90일 조회창 밖으로
 * 떨어져, 저장은 됐는데 어디에도 보이지 않았다(2026-08-19). 그 자리에서 알아채도록 하는 장치다.
 */
export function buildReceiptWarnings(fields: ReceiptFields): string[] {
  const out: string[] = [];
  const today = kstToday();
  const paidDate = fields.paidAt?.slice(0, 10) ?? null;

  if (!paidDate) {
    out.push("사용일을 읽지 못했습니다 — 날짜를 직접 선택해 주세요.");
  } else if (paidDate > today) {
    out.push(`사용일이 미래(${paidDate})로 인식됐습니다 — 날짜를 확인해 주세요.`);
  } else {
    const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${paidDate}T00:00:00Z`)) / 86400000;
    if (Number.isFinite(days) && days > 365) {
      const years = Math.floor(days / 365);
      out.push(`사용일이 ${years}년 전(${paidDate})으로 인식됐습니다 — 연도가 맞는지 확인해 주세요.`);
    }
  }

  if (fields.storeCorpNum && !isValidCorpNum(fields.storeCorpNum)) {
    out.push("사업자번호가 잘못 읽힌 것 같습니다 — 영수증과 대조해 주세요.");
  }
  return out;
}

/**
 * 영수증 이미지 1장을 필드로 파싱. 키 미설정이면 null(호출부 수동 입력 폴백).
 * 실패(HTTP·파싱)는 throw — 라우트에서 사용자 메시지로 변환.
 */
export async function parseReceipt(image: Buffer): Promise<ReceiptParseResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const normalizedImage = await normalizeReceiptImage(image);
  const data = normalizedImage.toString("base64");
  const prompt =
    "이 이미지는 카드 결제 지류 영수증입니다(회전·구겨짐·감열지 흐림이 있을 수 있으니 방향을 바로잡아 읽으세요). " +
    "아래 필드를 추출해 JSON 만 출력하세요(설명·코드블록 금지). 없는 필드는 null, 값은 영수증 표기 그대로(추측 금지).\n" +
    "- storeName: 가맹점 상호(영수증 상단의 매장명. 프랜차이즈는 지점명 포함 표기 그대로)\n" +
    "- storeCorpNum: 사업자등록번호. **가장 중요한 항목이니 특히 주의해서 읽으세요** — " +
    "'000-00-00000'(3-2-5 자리) 형태이고, 보통 상호명 바로 아래나 '사업자번호/사업자등록번호/사업자' " +
    "라벨 옆, 또는 대표자명·주소와 함께 머리글 영역에 있습니다. 숫자를 한 자리씩 확인해 읽고, " +
    "흐려서 확신이 서지 않는 자리가 있으면 추측하지 말고 null 로 두세요\n" +
    '- paidAt: 거래(승인)일시 "YYYY-MM-DD HH:MM"(시각이 없으면 날짜만)\n' +
    "- totalAmount: 합계(승인금액·받을금액 — 고객이 결제한 총액)\n" +
    "- supplyAmount / taxAmount: 공급가액과 부가세(면세 영수증이면 taxAmount 0)\n" +
    '- cardLast4: 카드번호 마지막 4자리(마스킹 "****-1234"면 1234)\n' +
    "- approvalNum: 승인번호\n" +
    "- items: 품목명 배열(금액 큰 순 최대 3개, 없으면 빈 배열)\n" +
    '{"storeName":..., "storeCorpNum":..., "paidAt":..., "totalAmount":..., "supplyAmount":..., "taxAmount":..., "cardLast4":..., "approvalNum":..., "items":[...]}';

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
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`영수증 분석 API 오류 (HTTP ${res.status}) ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("영수증 분석 결과를 해석하지 못했습니다.");
  const raw = JSON.parse(match[0]) as Record<string, unknown>;

  const fields: ReceiptFields = {
    storeName: str(raw.storeName),
    storeCorpNum: str(raw.storeCorpNum),
    paidAt: normalizePaidAt(str(raw.paidAt)),
    totalAmount: money(raw.totalAmount),
    supplyAmount: money(raw.supplyAmount),
    taxAmount: money(raw.taxAmount),
    cardLast4: str(raw.cardLast4)?.replace(/[^0-9]/g, "").slice(-4) || null,
    approvalNum: str(raw.approvalNum),
    items: Array.isArray(raw.items) ? raw.items.map((v) => String(v).trim()).filter(Boolean).slice(0, 3) : [],
  };

  // 결정론 보정 — 사업자번호 10자리 검증, 금액 정합(공급가액+부가세=합계 ±1원, 어긋나면 합계 기준 역산).
  // 자릿수뿐 아니라 국세청 체크섬까지 본다 — 틀린 번호로 상호 사전을 조회하면 엉뚱한 상호가 박힌다.
  fields.storeCorpNum = normalizeCorpNum(fields.storeCorpNum);
  if (fields.totalAmount != null) {
    const s = fields.supplyAmount;
    const t = fields.taxAmount;
    if (s == null || t == null || Math.abs(s + t - fields.totalAmount) > 1) {
      // 과세 가정 역산(카드 원장과 동일 규칙: 총액-세액. 세액 불명이면 총액/1.1) — 면세는 t=0으로 파싱됨.
      const tax = t != null && t <= fields.totalAmount ? t : Math.round(fields.totalAmount / 11);
      fields.taxAmount = tax;
      fields.supplyAmount = fields.totalAmount - tax;
    }
  }
  return { fields, model: MODEL, normalizedImage };
}
