import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string; companyId: string }>;
}

const COMPANY_ROLES = new Set(["group_representative", "affiliate", "other"]);

function normalizeCompanyRole(value: unknown, fallback: "group_representative" | "affiliate" | "other") {
  const role = String(value ?? "").trim();
  return COMPANY_ROLES.has(role) ? (role as "group_representative" | "affiliate" | "other") : fallback;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { groupId, companyId } = await ctx.params;
    const body = await req.json();
    const groupRole =
      body.groupRole == null && body.isHeadquarters
        ? "group_representative"
        : normalizeCompanyRole(body.groupRole, "affiliate");
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_companies WHERE company_id = $1", [companyId]);
      await db.run(
        `UPDATE facility_group_companies SET
           division_id = $1,
           company_name = COALESCE($2, company_name),
           business_registration_no = $3,
           address = $4,
           phone_number = $5,
           logo_path = $6,
           group_role = $7,
           is_headquarters = $8,
           updated_at = $9
         WHERE company_id = $10 AND group_id = $11`,
        [
          body.divisionId?.trim?.() || null,
          body.companyName ? normalizeCompanyName(body.companyName) ?? body.companyName : null,
          normalizeBusinessRegistrationNo(body.businessRegistrationNo),
          normalizeAddress(body.address),
          body.phoneNumber?.trim?.() || null,
          body.logoPath?.trim?.() || null,
          groupRole,
          groupRole === "group_representative" || body.isHeadquarters ? 1 : 0,
          now,
          companyId,
          groupId,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_group_companies",
        targetId: companyId,
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
    const { groupId, companyId } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_companies WHERE company_id = $1", [companyId]);
      await db.run("DELETE FROM facility_group_memberships WHERE company_id = $1", [companyId]);
      await db.run("DELETE FROM facility_group_companies WHERE company_id = $1 AND group_id = $2", [
        companyId,
        groupId,
      ]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_group_companies",
        targetId: companyId,
        before,
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
