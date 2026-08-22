/**
 * 전표 문서에서 품목·금액 뽑기
 *
 * 대장(ledger.csv)의 품목·금액 칸을 채우기 위한 것이다. 증빙 자체는 PDF 원본이므로
 * 여기서 틀린 값을 넣느니 비워 두는 편이 낫다 — 확신이 서는 형태만 잡는다.
 *
 * 다섯 몰의 전표 양식이 제각각이라 공통 휴리스틱(라벨 + 값)을 기본으로 두고,
 * 빗나가는 사이트만 `SiteConfig.documentFields` 로 정규식을 지정한다.
 */

import { SiteConfig } from "./config";

/** 품목 라벨 뒤의 값 — 품명/DESC, 상품명, 상품/옵션정보 … */
const TITLE_PATTERNS: RegExp[] = [
  /(?:품\s*명|품\s*목|상\s*품\s*명|상품\/옵션정보)\s*(?:\/\s*\w+)?\s*[:：]?\s*([^\n\r\t]{2,80})/,
  /\bDESC(?:RIPTION)?\b\s*[:：]?\s*([^\n\r\t]{2,80})/i,
];

/** 금액 라벨 뒤의 값 — 합계/총액/결제금액/승인금액 … */
const AMOUNT_PATTERNS: RegExp[] = [
  /(?:합\s*계\s*금\s*액|총\s*결\s*제\s*금\s*액|결\s*제\s*금\s*액|승\s*인\s*금\s*액|합\s*계|총\s*액)\s*[:：]?\s*([\d,]{3,})/,
  /\bTOTAL\b\s*[:：]?\s*([\d,]{3,})/i,
];

/** 값처럼 보이지 않는 것(라벨만 있고 값이 비었거나, 다음 라벨이 붙어온 경우)을 걸러낸다 */
function cleanTitle(raw: string): string {
  const value = raw
    .replace(/\s+/g, " ")
    .replace(/^[\/:：\-\s]+/, "")
    .trim();

  if (value.length < 2) return "";
  // 라벨만 이어진 경우(예: "품명/DESC 수량/QTY") — 값이 아니라 표 머리글이다.
  if (/^(?:[가-힣A-Z]{1,6}\s*\/\s*[A-Z]{2,}\s*)+$/.test(value)) return "";
  return value.slice(0, 80);
}

function firstMatch(text: string, patterns: RegExp[], custom?: string): string {
  const all = custom ? [new RegExp(custom), ...patterns] : patterns;

  for (const re of all) {
    const m = re.exec(text);
    if (m && m[1]) return m[1];
  }
  return "";
}

/**
 * 전표 텍스트에서 품목·금액을 뽑는다. 못 찾으면 빈 문자열(대장에 빈 칸으로 남는다).
 */
export function extractDocumentFields(text: string, cfg: SiteConfig): { title: string; amount: string } {
  if (!text) return { title: "", amount: "" };

  // 줄바꿈이 없는 문서(표를 한 줄로 그리는 경우)도 있어 탭·다중 공백을 줄바꿈처럼 취급한다.
  const normalized = text.replace(/\t/g, "\n").replace(/ {3,}/g, "\n");

  const title = cleanTitle(firstMatch(normalized, TITLE_PATTERNS, cfg.documentFields?.title));
  const amountRaw = firstMatch(normalized, AMOUNT_PATTERNS, cfg.documentFields?.amount);
  const amount = amountRaw ? `${amountRaw.replace(/[^\d,]/g, "")}원` : "";

  return { title, amount };
}

const DATE_BODY = "(20\\d{2})[.\\-/\\s]+(\\d{1,2})[.\\-/\\s]+(\\d{1,2})";

/** 거래 날짜를 가리키는 라벨 — 발행일·신청일 같은 다른 날짜와 섞이지 않게 이쪽을 우선한다 */
const LABELED_DATE = new RegExp(
  `(?:거\\s*래\\s*일\\s*시|승\\s*인\\s*일\\s*시|결\\s*제\\s*일\\s*시?|거\\s*래\\s*일\\s*자|주\\s*문\\s*일\\s*자?)\\s*[:：]?\\s*${DATE_BODY}`
);

/**
 * 문서에서 거래 날짜 — `거래일시` 류 라벨이 있으면 그 값을, 없으면 처음 나오는 날짜를 쓴다.
 * (쿠팡 전표는 발행 안내 등 다른 날짜가 앞에 올 수 있어 첫 날짜만 믿으면 틀린다)
 */
export function dateFromText(text: string): string {
  const m = LABELED_DATE.exec(text) ?? text.match(new RegExp(DATE_BODY));
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/* ── 카드 원장 매칭용 결제 필드 ─────────────────────────────────
 * 신용카드 매출전표에는 승인번호·카드번호(마스킹)·거래일시가 찍힌다.
 * 이 값으로 법인카드 원장(card_transactions)과 잇는다. 없으면 빈 값 —
 * 매칭은 금액+날짜 단계로 자연히 강등된다.
 */

const APPROVAL_PATTERNS: RegExp[] = [
  /승\s*인\s*번\s*호\s*[:：]?\s*(\d{6,12})/,
  /\bAPPROVAL(?:\s*NO\.?)?\b\s*[:：]?\s*(\d{6,12})/i,
];

const CARD_NO_PATTERNS: RegExp[] = [
  /카\s*드\s*번\s*호\s*[:：]?\s*([-\d*Xx\s]{12,25})/,
  /\bCARD\s*(?:NO\.?|NUMBER)\b\s*[:：]?\s*([-\d*Xx\s]{12,25})/i,
];

export interface PaymentFields {
  approvalNum: string;
  /** 마스킹된 카드번호에서 살아남은 마지막 숫자 묶음(대개 끝 4자리) */
  cardLast4: string;
}

export function extractPaymentFields(text: string): PaymentFields {
  if (!text) return { approvalNum: "", cardLast4: "" };
  const normalized = text.replace(/\t/g, "\n").replace(/ {3,}/g, "\n");

  const approvalNum = firstMatch(normalized, APPROVAL_PATTERNS);

  let cardLast4 = "";
  const rawCard = firstMatch(normalized, CARD_NO_PATTERNS);
  if (rawCard) {
    // 5327-12**-****-1234 → 숫자 묶음의 마지막 것. 끝자리가 마스킹된 카드사면 앞 묶음이 남는데,
    // 그런 값은 끝4 비교에 못 쓰므로 4자리로 끝나는 묶음일 때만 취한다.
    const groups = rawCard.match(/\d+/g) || [];
    const last = groups[groups.length - 1] || "";
    if (last.length >= 4 && /\d{4}\s*$/.test(rawCard.trimEnd())) cardLast4 = last.slice(-4);
  }

  return { approvalNum, cardLast4 };
}
