import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string; divisionId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { groupId, divisionId } = await ctx.params;
    const body = await req.json();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_divisions WHERE division_id = $1", [divisionId]);
      await db.run(
        `UPDATE facility_group_divisions
            SET division_name = COALESCE($1, division_name), sort_order = $2, updated_at = $3
          WHERE division_id = $4 AND group_id = $5`,
        [body.divisionName?.trim?.() || null, Number(body.sortOrder ?? 0), now, divisionId, groupId]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_group_divisions",
        targetId: divisionId,
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
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { groupId, divisionId } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_divisions WHERE division_id = $1", [divisionId]);
      await db.run("UPDATE facility_group_companies SET division_id = NULL WHERE division_id = $1", [divisionId]);
      await db.run("DELETE FROM facility_group_divisions WHERE division_id = $1 AND group_id = $2", [
        divisionId,
        groupId,
      ]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_group_divisions",
        targetId: divisionId,
        before,
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
