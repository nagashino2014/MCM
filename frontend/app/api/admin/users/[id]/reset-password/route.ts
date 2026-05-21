import { NextRequest, NextResponse } from "next/server";
import { requireRole, authErrorToResponse } from "@/lib/auth/guards";
import { findUserById, resetUserPassword } from "@/lib/auth/users";
import { recordAuditLog } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  password: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireRole("admin");
    const { id } = await ctx.params;
    const before = await findUserById(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = (await req.json()) as Body;
    if (!body?.password || body.password.length < 8) {
      return NextResponse.json(
        { error: "비밀번호는 최소 8자 이상이어야 합니다." },
        { status: 400 }
      );
    }
    await resetUserPassword(id, body.password);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "user_password_reset",
      targetTable: "users",
      targetId: id,
      after: { email: before.email },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
