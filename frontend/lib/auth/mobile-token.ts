/**
 * 모바일 네이티브 앱용 자체 서명 JWT (access / refresh).
 * - next-auth 세션은 HttpOnly 쿠키 기반이라 RN 앱에서 쓸 수 없다. 앱은 이 토큰을
 *   SecureStore 에 저장하고 Authorization: Bearer 헤더로 API 를 호출한다.
 * - 서명키는 next-auth 와 동일한 AUTH_SECRET(HS256) 을 재사용한다(추가 env 불필요).
 * - jose 는 edge/node 양쪽 호환이지만, 이 파일은 Node 라우트/guards 에서만 import 한다.
 *   (edge middleware 는 토큰 존재만 확인하고 검증은 라우트에 위임 — edge-config.ts 참고)
 */

import { SignJWT, jwtVerify } from "jose";
import type { Role, UserStatus } from "./users";

const ACCESS_TTL = "60m"; // 짧게: 권한 변경이 최대 60분 내 반영되도록
const REFRESH_TTL = "30d"; // 길게: 외근 중 잦은 재로그인 방지

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET(또는 NEXTAUTH_SECRET) 환경변수가 필요합니다.");
  return new TextEncoder().encode(s);
}

export interface MobileAccessClaims {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
}

export async function signAccessToken(u: MobileAccessClaims): Promise<string> {
  return new SignJWT({
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    typ: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secretKey());
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ typ: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(secretKey());
}

/** access 토큰 검증. 무효/만료/타입불일치면 null. */
export async function verifyAccessToken(token: string): Promise<MobileAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ !== "access" || !payload.sub) return null;
    return {
      userId: String(payload.sub),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: (payload.role as Role) ?? "viewer",
      status: (payload.status as UserStatus) ?? "active",
      mustChangePassword: payload.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}

/** refresh 토큰 검증. 무효/만료/타입불일치면 null. (status/role 은 발급 시 DB 재확인) */
export async function verifyRefreshToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ !== "refresh" || !payload.sub) return null;
    return { userId: String(payload.sub) };
  } catch {
    return null;
  }
}
