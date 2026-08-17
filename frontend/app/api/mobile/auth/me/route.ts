import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { findUserByIdStrict } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 현재 로그인 사용자 — 앱이 **재시작할 때마다** 호출한다.
 *
 * 앱은 토큰만 SecureStore 에 보관하므로, 재시작 후에는 누구로 로그인했는지 알 수 없다.
 * 이 라우트로 사용자 정보를 복원하고, 동시에 토큰이 아직 살아 있는지도 확인한다
 * (401 이면 apiFetch 가 refresh → 그래도 실패하면 자동 로그아웃).
 * 권한·이름은 DB 에서 새로 읽는다 — 토큰 발급 후 바뀌었을 수 있다.
 */
export async function GET() {
  try {
    const ctx = await requireSession();
    // strict: DB 일시 장애는 503 으로 나간다(authErrorToResponse) — 401 이면 앱이 토큰을 폐기하므로.
    const u = await findUserByIdStrict(ctx.userId);
    if (!u || u.status !== "active") {
      return NextResponse.json({ error: "접근할 수 없는 계정입니다." }, { status: 401 });
    }
    return NextResponse.json({
      user: {
        id: u.userId,
        email: u.email,
        name: u.name,
        role: u.role,
        mustChangePassword: u.mustChangePassword,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
