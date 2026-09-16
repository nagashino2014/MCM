/**
 * 계약 날짜 칸 정규화 — 입력 도중 값이 그대로 저장되던 문제를 API 에서 막는다(2026-09-16).
 *
 * 계약 화면의 날짜 입력은 타이핑 진행도에 맞춰 부분 값("2", "2026091")을 상태로 들고 있다가
 * 저장 시 그대로 보내는데, 라우트에 검증이 없어 DB(text 컬럼)에 잘린 값이 61건 쌓였다.
 * 대행 실적 보고·완료 현황처럼 날짜를 읽는 쪽은 형식이 어긋나면 값을 통째로 버리므로 조용히 비어 보인다.
 *
 * 규칙: 빈값 → null / YYYY-MM-DD → 그대로 / 숫자 8자리 → YYYY-MM-DD 로 변환 /
 *       그 밖의 부분 숫자 → 오류. 날짜가 아닌 문구(종료일의 "용역 완료시 까지" 등 레거시)는 그대로 둔다.
 */
export interface DateFieldResult {
  value: string | null;
  /** 채우다 만 날짜 — 저장을 거부한다 */
  invalid: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

export function normalizeDateField(raw: unknown): DateFieldResult {
  if (raw == null) return { value: null, invalid: false };
  const s = String(raw).trim();
  if (!s) return { value: null, invalid: false };
  if (ISO.test(s)) return { value: s, invalid: !isRealDate(s) };
  if (/^\d{8}$/.test(s)) {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return { value: iso, invalid: !isRealDate(iso) };
  }
  // 채우다 만 날짜: 숫자만 1~7자리, 또는 YYYY-M / YYYY-MM-D 형태
  if (/^\d{1,7}$/.test(s) || /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(s)) return { value: s, invalid: true };
  return { value: s, invalid: false }; // 날짜가 아닌 문구는 기존대로 보관
}

/**
 * 여러 날짜 칸을 한 번에 검사한다. 잘못된 칸이 있으면 사용자에게 보여줄 메시지를 돌려준다.
 * `fields` 는 { "계약일자": body.contractDate, ... } 처럼 화면 라벨을 키로 쓴다.
 */
export function checkDateFields(fields: Record<string, unknown>): string | null {
  const bad = Object.entries(fields)
    .filter(([, raw]) => raw !== undefined && normalizeDateField(raw).invalid)
    .map(([label]) => label);
  if (bad.length === 0) return null;
  return `${bad.join(" · ")} 날짜가 올바르지 않습니다. 8자리(YYYYMMDD)로 입력하거나 비워 주세요.`;
}

/** 저장값 — 검사를 통과한 뒤 쓰는 정규화 결과(빈값은 null). */
export function dateFieldValue(raw: unknown): string | null {
  return normalizeDateField(raw).value;
}
