import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { changeOwnPassword, findUserWithHashById } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChangeBody {
  currentPassword?: string;
  newPassword?: string;
}

// 로그인한 본인의 비밀번호 변경. 초기 비번(=사번) 강제 변경 흐름에서도 사용.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json()) as ChangeBody;
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "현재/새 비밀번호를 모두 입력하세요." }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "새 비밀번호는 최소 8자 이상이어야 합니다." }, { status: 400 });
    }

    const user = await findUserWithHashById(ctx.userId);
    if (!user) return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "현재 비밀번호가 일치하지 않습니다." }, { status: 400 });

    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "기존과 다른 비밀번호를 사용하세요." }, { status: 400 });
    }

    await changeOwnPassword(ctx.userId, newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
