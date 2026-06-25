import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { resetEmployeeAccountPassword } from "@/lib/auth/users";
import { recordAuditLog } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 조직 인원의 계정 비밀번호를 사번으로 초기화(+최초 로그인 시 강제 변경).
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("account.manage", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const loginId = await resetEmployeeAccountPassword(id);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "user_password_reset",
      targetTable: "employee_profiles",
      targetId: id,
      after: { loginId, resetToEmployeeNo: true },
    });
    return NextResponse.json({ loginId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
