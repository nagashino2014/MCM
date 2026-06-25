import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import {
  countAdmins,
  deleteUser,
  findUserById,
  updateUser,
  type Role,
  type UserStatus,
} from "@/lib/auth/users";
import { recordAuditLog } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  name?: string;
  role?: Role;
  status?: UserStatus;
  email?: string;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("account.manage", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const before = await findUserById(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = (await req.json()) as PatchBody;

    // 마지막 admin이 자기 자신을 비활성화/role 변경하지 못하게 방어
    if (
      before.role === "admin" &&
      ((body.role && body.role !== "admin") || (body.status && body.status !== "active"))
    ) {
      const adminTotal = await countAdmins();
      if (adminTotal <= 1) {
        return NextResponse.json(
          { error: "마지막 활성 관리자는 비활성화/역할 변경할 수 없습니다." },
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

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("account.manage", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    if (id === actor.userId) {
      return NextResponse.json({ error: "자기 자신을 삭제할 수 없습니다." }, { status: 400 });
    }
    const before = await findUserById(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (before.role === "admin") {
      const adminTotal = await countAdmins();
      if (adminTotal <= 1) {
        return NextResponse.json(
          { error: "마지막 활성 관리자는 삭제할 수 없습니다." },
          { status: 400 }
        );
      }
    }
    await deleteUser(id);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "user_delete",
      targetTable: "users",
      targetId: id,
      before,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
