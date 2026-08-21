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
