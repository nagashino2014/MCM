/**
 * 계약 금액 표기 — 계약 원장(매출·매입) 트리·상세가 공유한다.
 * (331 매입 계약 추가 때 app/(app)/contracts/page.tsx 의 로컬 함수를 그대로 옮겼다.)
 */

/** 축약 표기: 1.2억 · 850만 · 그 외 천 단위. 0·비정상 값은 "-". */
export function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000).toLocaleString() + "만";
  return n.toLocaleString();
}

/**
 * Render the exact amount with thousands separators (e.g. `8,640,000`).
 * Used in milestone tables where the user wants the full claim/collection
 * amount visible rather than the abbreviated 만/억 form.
 */
export function formatExactAmount(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  return Math.round(n).toLocaleString("en-US");
}
