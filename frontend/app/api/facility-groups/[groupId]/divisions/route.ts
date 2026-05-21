import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { groupId } = await ctx.params;
    const body = await req.json();
    const divisionName = String(body.divisionName ?? "").trim();
    if (!divisionName) return NextResponse.json({ error: "부문명은 필수입니다." }, { status: 400 });
    const divisionId = "div_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_group_divisions
          (division_id, group_id, division_name, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [divisionId, groupId, divisionName, Number(body.sortOrder ?? 0), now, now]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_group_divisions",
        targetId: divisionId,
        after: body,
      });
    });
    return NextResponse.json({ divisionId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
