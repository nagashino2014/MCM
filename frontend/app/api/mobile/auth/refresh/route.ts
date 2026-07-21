import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "@/lib/auth/mobile-token";
import { findUserById } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 모바일 토큰 갱신 — refresh 토큰으로 새 access(+회전된 refresh) 발급.
 * body: { refreshToken: string }
 * 200: { accessToken, refreshToken }
 * 401: refresh 무효/만료 또는 계정 비활성.
 *
 * ⚠ 발급 전 findUserById 로 status/role 을 DB 재확인한다 — 정지·삭제된 계정이
 *    토큰 만료까지 유효해지는 문제를 차단(access TTL 60분 + refresh 시 재확인).
 */
export async function POST(req: NextRequest) {
  let body: { refreshToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const token = String(body.refreshToken ?? "");
  if (!token) {
    return NextResponse.json({ error: "refreshToken이 필요합니다." }, { status: 400 });
  }

  const decoded = await verifyRefreshToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "유효하지 않은 refresh 토큰입니다." }, { status: 401 });
  }

  const fresh = await findUserById(decoded.userId);
  if (!fresh || fresh.status !== "active") {
    return NextResponse.json({ error: "접근할 수 없는 계정입니다." }, { status: 401 });
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      userId: fresh.userId,
      email: fresh.email,
      name: fresh.name,
      role: fresh.role,
      status: fresh.status,
      mustChangePassword: fresh.mustChangePassword,
    }),
    signRefreshToken(fresh.userId), // 회전(rotation): 매 갱신마다 새 refresh
  ]);

  return NextResponse.json({ accessToken, refreshToken });
}
