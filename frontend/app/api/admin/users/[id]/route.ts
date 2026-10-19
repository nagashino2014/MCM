import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import {
  countSystemAdmins,
  findUserById,
  isSystemAdminUser,
  updateUser,
  type UserStatus,
} from "@/lib/auth/users";
import { recordAuditLog } from "@/lib/auth/audit";
import { purgeAccount } from "@/lib/auth/account-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * role 은 더 이상 받지 않는다(role 일원화 WP6, 2026-10-19). "관리자 지정"은 계정·권한 관리 화면에서
 * tpl-system-admin 템플릿을 부여하는 것이고, 마지막 관리자 보호는 그 템플릿 보유자 수로 판정한다.
 */
interface PatchBody {
  name?: string;
  status?: UserStatus;
  email?: string;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("account.manage", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const before = await findUserById(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    const raw = (await req.json()) as PatchBody & { role?: unknown };
    const body: PatchBody = { name: raw.name, status: raw.status, email: raw.email };

    // 마지막 시스템 관리자(유효한 tpl-system-admin 보유 활성 계정)가 비활성화되지 않게 방어
    if (body.status && body.status !== "active" && (await isSystemAdminUser(id))) {
      const adminTotal = await countSystemAdmins();
      if (adminTotal <= 1) {
        return NextResponse.json(
          { error: "마지막 시스템 관리자(tpl-system-admin 보유자)는 비활성화할 수 없습니다." },
          { status: 400 }
        );
      }
    }

    await updateUser(id, body);
    const after = await findUserById(id);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "user_update",
      targetTable: "users",
      targetId: id,
      before,
      after,
    });
    return NextResponse.json({ user: after });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 계정 영구 삭제(2026-10-19) — ?confirm=<로그인 ID 또는 이메일>&employee=1|0&ack=1. 미리보기는 GET /purge. 업무 기록이 있는데 ack 가 없으면 409.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("account.manage", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const sp = req.nextUrl.searchParams;
    const confirm = sp.get("confirm") ?? "";
    if (!confirm) return NextResponse.json({ error: "확인 문자열(confirm)이 필요합니다. 미리보기: GET /api/admin/users/[id]/purge" }, { status: 400 });
    const result = await purgeAccount(actor.userId, id, { confirm, withEmployee: sp.get("employee") !== "0", ack: sp.get("ack") === "1" });
    return NextResponse.json({ ok: true, employeeDeleted: result.employeeDeleted, preview: result.preview });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
