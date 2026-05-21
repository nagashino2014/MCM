import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ entityId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { entityId } = await ctx.params;
    const body = await req.json();
    const entityName =
      body.entityName === undefined ? undefined : normalizeCompanyName(body.entityName) ?? String(body.entityName ?? "").trim();
    if (entityName !== undefined && !entityName) {
      return NextResponse.json({ error: "법인명은 필수입니다." }, { status: 400 });
    }
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM legal_entities WHERE entity_id = $1", [entityId]);
      await db.run(
        `UPDATE legal_entities SET
           entity_name = COALESCE($1, entity_name),
           business_registration_no = $2,
           address = $3,
           phone_number = $4,
           memo = $5,
           updated_at = $6
         WHERE entity_id = $7`,
        [
          entityName ?? null,
          normalizeBusinessRegistrationNo(body.businessRegistrationNo),
          normalizeAddress(body.address),
          body.phoneNumber?.trim?.() || null,
          body.memo?.trim?.() || null,
          now,
          entityId,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "legal_entity_update",
        targetTable: "legal_entities",
        targetId: entityId,
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
    const { entityId } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM legal_entities WHERE entity_id = $1", [entityId]);
      await db.run("DELETE FROM facility_operating_entities WHERE entity_id = $1", [entityId]);
      await db.run("DELETE FROM legal_entities WHERE entity_id = $1", [entityId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "legal_entity_delete",
        targetTable: "legal_entities",
        targetId: entityId,
        before,
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
