/**
 * 권한 요약(perms) 판정 — edge·클라이언트·서버 공용 순수 함수.
 *
 * 로그인 시 lib/auth/rbac.ts summarizePermissions() 가 유효 grant 를 문자열 목록으로 요약해 JWT 에 싣는다.
 *   - "contract.view"      : 키 보유(범위는 self/participant/self_dept/specific_dept 중 하나)
 *   - "contract.view@all"  : 키를 전사 범위(scope=all)로 보유 — 키 보유 판정에도 포함된다
 * 메뉴 노출·미들웨어 1차 차단·화면 버튼 게이트는 이 요약으로 판정하고, API 라우트는 종전대로
 * requirePermission(DB 조회)이 판정한다. 요약은 로그인·세션 갱신(update()) 시점의 스냅샷이다
 * (docs/open-test-permission-plan-2026-10-19.md §6-6).
 *
 * ⚠ 이 파일은 미들웨어(edge runtime)에서 import 된다 — Node 전용 모듈·DB 를 import 하지 말 것.
 */

export const PERM_ALL_SUFFIX = "@all";

/** 시스템 관리자 표식 — tpl-system-admin 만 가진 키(권한 템플릿 관리). 라벨·개발용 토글에만 쓴다. */
export const SYSTEM_ADMIN_MARK_KEY = "rbac.template.manage";

/** 키 보유 여부. global=true 면 전사 범위(scope=all) 보유만 인정한다. */
export function hasPerm(
  perms: readonly string[] | null | undefined,
  key: string,
  opts?: { global?: boolean }
): boolean {
  if (!perms || perms.length === 0) return false;
  if (perms.includes(key + PERM_ALL_SUFFIX)) return true;
  return !opts?.global && perms.includes(key);
}

/** 키 목록 중 하나라도 보유하면 true. 빈 목록은 "요구 권한 없음"으로 true. */
export function hasAnyPerm(perms: readonly string[] | null | undefined, keys: string | readonly string[]): boolean {
  const list = typeof keys === "string" ? [keys] : keys;
  if (list.length === 0) return true;
  return list.some((k) => hasPerm(perms, k));
}

/** 시스템 관리자(tpl-system-admin 보유자) 여부 — 표시 전용. 권한 판정에는 쓰지 말 것. */
export function isSystemAdminPerms(perms: readonly string[] | null | undefined): boolean {
  return hasPerm(perms, SYSTEM_ADMIN_MARK_KEY, { global: true });
}

/** 세션 user 객체에서 perms 배열을 안전하게 꺼낸다(구 토큰·비로그인은 빈 배열). */
export function permsOf(user: unknown): string[] {
  const p = (user as { perms?: unknown } | null | undefined)?.perms;
  return Array.isArray(p) ? p.map(String) : [];
}
