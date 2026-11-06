import { NextRequest, NextResponse } from "next/server";
import { LoginLockedError, verifyCredentials, type VerifiedUser } from "@/lib/auth/verify-credentials";
import { LOGIN_LOCK_MESSAGES } from "@/lib/auth/login-lock";
import { signAccessToken, signRefreshToken } from "@/lib/auth/mobile-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 모바일 로그인 — 사번/이메일 로컬파트 + 비밀번호로 access/refresh 토큰 발급.
 * body: { identifier: string, password: string }
 * 200: { accessToken, refreshToken, user }
 * 401: 자격 불일치(사유 노출 안 함)
 * 429: 반복 실패로 잠김(앱은 error 문구를 그대로 표시)
 */
export async function POST(req: NextRequest) {
  let body: { identifier?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const identifier = String(body.identifier ?? "");
  const password = String(body.password ?? "");
  if (!identifier || !password) {
    return NextResponse.json({ error: "identifier/password가 필요합니다." }, { status: 400 });
  }

  let user: VerifiedUser | null;
  try {
    user = await verifyCredentials(identifier, password, req);
  } catch (err) {
    if (err instanceof LoginLockedError) {
      return NextResponse.json({ error: LOGIN_LOCK_MESSAGES[err.reason] }, { status: 429 });
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json(
      { error: "아이디 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
    }),
    signRefreshToken(user.id),
  ]);

  return NextResponse.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
}
