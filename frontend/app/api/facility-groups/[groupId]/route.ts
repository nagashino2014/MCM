import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { groupId } = await ctx.params;
    const body = await req.json();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_groups WHERE group_id = $1", [groupId]);
      await db.run(
        `UPDATE facility_groups SET
           group_name = COALESCE($1, group_name),
           logo_path = $2,
           total_revenue = $3,
           employee_count = $4,
           description = $5,
           updated_at = $6
         WHERE group_id = $7`,
        [
          body.groupName?.trim?.() || null,
          body.logoPath?.trim?.() || null,
          body.totalRevenue === "" || body.totalRevenue == null ? null : Number(body.totalRevenue),
          body.employeeCount === "" || body.employeeCount == null ? null : Number(body.employeeCount),
          body.description?.trim?.() || null,
          now,
          groupId,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_groups",
        targetId: groupId,
        before,
        after: body,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { groupId } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_groups WHERE group_id = $1", [groupId]);
      await db.run("DELETE FROM facility_group_memberships WHERE group_id = $1", [groupId]);
      await db.run("DELETE FROM facility_group_companies WHERE group_id = $1", [groupId]);
      await db.run("DELETE FROM facility_group_divisions WHERE group_id = $1", [groupId]);
      await db.run("DELETE FROM facility_groups WHERE group_id = $1", [groupId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_delete",
        targetTable: "facility_groups",
        targetId: groupId,
        before,
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
