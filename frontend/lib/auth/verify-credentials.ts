/**
 * 자격증명(사번/이메일 로컬파트 + 비밀번호) 검증 — 순수 함수.
 * - config.ts 의 Credentials.authorize 와 신규 모바일 로그인(/api/mobile/auth/login) 이
 *   공유한다(웹/모바일 로그인 로직 단일화 → 회귀 방지).
 * - throttle(brute-force 방어) + status active 검사 + bcrypt 검증을 모두 수행한다.
 */

import { findUserByLoginIdentifier } from "./users";
import { verifyPassword } from "./password";
import { ensureAdminSeeded } from "./seed";
import { recordAccessLog } from "./access-log";
import {
  clientIpFrom,
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
} from "./login-throttle";
import type { Role, UserStatus } from "./users";

export interface VerifiedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
}

/**
 * 성공 시 사용자 정보, 실패 시 null(사유 노출 안 함).
 * @param request throttle 의 클라이언트 IP 추출용(선택).
 */
export async function verifyCredentials(
  identifierRaw: string,
  passwordRaw: string,
  request?: Request
): Promise<VerifiedUser | null> {
  try {
    await ensureAdminSeeded();
  } catch (err) {
    console.warn("[auth] seed 실패: " + (err as Error).message);
  }

  // identifier 는 "로그인 식별자"(사번 또는 이메일 로컬파트).
  const identifier = String(identifierRaw ?? "").trim().toLowerCase();
  const password = String(passwordRaw ?? "");
  if (!identifier || !password) return null;

  // 무차별 대입 방어: 윈도 내 실패 임계 초과 시 자격 검증 없이 거부.
  const ip = clientIpFrom(request);
  if (await isLoginBlocked(identifier, ip)) {
    console.warn(`[auth] 로그인 차단(과도한 실패): id=${identifier} ip=${ip}`);
    return null;
  }

  const user = await findUserByLoginIdentifier(identifier);
  if (!user) {
    await recordLoginFailure(identifier, ip);
    return null;
  }
  if (user.status !== "active") {
    await recordLoginFailure(identifier, ip);
    return null;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await recordLoginFailure(identifier, ip);
    return null;
  }

  await clearLoginFailures(identifier);
  // 접속기록(PR-P1) — 로그인 성공 이력. 실패는 login_attempts(브루트포스 방어)가 담당.
  await recordAccessLog({
    actorUserId: user.userId,
    action: "login",
    targetKind: "session",
    detail: { identifier, ip },
  });
  return {
    id: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
  };
}
