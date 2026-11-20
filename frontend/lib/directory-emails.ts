// 사업장 담당자의 추가 이메일(376, 2026-11-20 직원 요청 29) — 화면·서버 공용 정리 규칙.
// 대표 주소는 facility_contact_people.email 에 그대로 두고, 그 밖의 주소만 extra_emails 배열에 둔다.

/** 한 사람에게 둘 수 있는 추가 이메일 수. */
export const EXTRA_EMAIL_LIMIT = 5;

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/**
 * 추가 이메일 입력을 저장 형태로 정리한다 — 소문자, 앞뒤 공백 제거, 중복·대표 주소와 같은 값 제거.
 * 형식이 틀린 값이 있으면 그 값을 invalid 로 돌려준다(저장하지 않고 알려 주기 위해).
 */
export function normalizeExtraEmails(input: unknown, primary?: string | null): { emails: string[]; invalid: string | null } {
  const main = String(primary ?? "").trim().toLowerCase();
  const seen = new Set<string>(main ? [main] : []);
  const emails: string[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    if (!EMAIL_RE.test(value)) return { emails: [], invalid: value };
    if (seen.has(value)) continue;
    seen.add(value);
    emails.push(value);
  }
  return { emails: emails.slice(0, EXTRA_EMAIL_LIMIT), invalid: null };
}

/** DB 에서 읽은 extra_emails(text[] 또는 jsonb 배열) → 문자열 배열. 열이 없던 환경(null)은 빈 배열. */
export function readExtraEmails(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}
