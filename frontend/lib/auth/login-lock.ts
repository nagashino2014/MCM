/**
 * 로그인 잠금 기준과 안내 문구 — 서버(login-throttle·모바일 로그인)와 웹 로그인 화면이 함께 쓴다.
 * 로그인 화면(클라이언트)에서도 import 하므로 Node 전용 모듈 금지.
 */

export const LOGIN_LOCK_WINDOW_MINUTES = 15;
// 아이디 단위 잠금(정밀): 동일 아이디 연속 실패.
export const LOGIN_LOCK_MAX_FAILS = 5;
// IP 단위 백스톱(여러 계정 스프레이): 사무실 공용 NAT 오탐 방지 위해 높게.
export const LOGIN_LOCK_MAX_FAILS_PER_IP = 50;

export type LoginLockReason = "account" | "ip";

/** next-auth 응답의 code 값. URL 에 실리므로 사유 구분만 담는다. */
export const LOGIN_LOCK_CODES: Record<LoginLockReason, string> = {
  account: "login_locked_account",
  ip: "login_locked_ip",
};

export const LOGIN_LOCK_MESSAGES: Record<LoginLockReason, string> = {
  account: `아이디 또는 비밀번호를 ${LOGIN_LOCK_MAX_FAILS}회 이상 잘못 입력해 로그인이 잠겼습니다. 최대 ${LOGIN_LOCK_WINDOW_MINUTES}분 뒤 다시 시도해 주세요.`,
  ip: `이 네트워크에서 로그인 실패가 많아 로그인이 잠시 제한되었습니다. 최대 ${LOGIN_LOCK_WINDOW_MINUTES}분 뒤 다시 시도해 주세요.`,
};

/** next-auth 응답 code → 안내 문구. 잠금이 아니면 null. */
export function loginLockMessageFor(code: string | undefined): string | null {
  if (code === LOGIN_LOCK_CODES.account) return LOGIN_LOCK_MESSAGES.account;
  if (code === LOGIN_LOCK_CODES.ip) return LOGIN_LOCK_MESSAGES.ip;
  return null;
}
