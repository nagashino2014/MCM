import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";
import { syncGroupCompanyFacility } from "@/lib/ieps/group-company-facility-sync";

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
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { groupId, companyId } = await ctx.params;
    const body = await req.json();
    const groupRole =
      body.groupRole == null && body.isHeadquarters
        ? "group_representative"
        : normalizeCompanyRole(body.groupRole, "affiliate");
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_companies WHERE company_id = $1", [companyId]);
      const companyName = body.companyName ? normalizeCompanyName(body.companyName) ?? body.companyName : null;
      const businessRegistrationNo = normalizeBusinessRegistrationNo(body.businessRegistrationNo);
      const address = normalizeAddress(body.address);
      const phoneNumber = body.phoneNumber?.trim?.() || null;
      const logoPath = body.logoPath?.trim?.() || null;
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
          companyName,
          businessRegistrationNo,
          address,
          phoneNumber,
          logoPath,
          groupRole,
          groupRole === "group_representative" || body.isHeadquarters ? 1 : 0,
          now,
          companyId,
          groupId,
        ]
      );
      const current = await db.exec(
        `SELECT company_id, group_id, company_name, business_registration_no, address, phone_number, logo_path
           FROM facility_group_companies
          WHERE company_id = $1 AND group_id = $2`,
        [companyId, groupId]
      );
      const row = current[0]?.values?.[0];
      if (row) {
        await syncGroupCompanyFacility(db, {
          companyId: String(row[0] ?? ""),
          groupId: String(row[1] ?? ""),
          companyName: String(row[2] ?? ""),
          businessRegistrationNo: row[3] != null ? String(row[3]) : null,
          address: row[4] != null ? String(row[4]) : null,
          phoneNumber: row[5] != null ? String(row[5]) : null,
          logoPath: row[6] != null ? String(row[6]) : null,
        }, now);
      }
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
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
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
