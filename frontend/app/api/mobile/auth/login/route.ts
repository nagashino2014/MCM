import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth/verify-credentials";
import { signAccessToken, signRefreshToken } from "@/lib/auth/mobile-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 모바일 로그인 — 사번/이메일 로컬파트 + 비밀번호로 access/refresh 토큰 발급.
 * body: { identifier: string, password: string }
 * 200: { accessToken, refreshToken, user }
 * 401: 자격 불일치(사유 노출 안 함)
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

  const user = await verifyCredentials(identifier, password, req);
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
