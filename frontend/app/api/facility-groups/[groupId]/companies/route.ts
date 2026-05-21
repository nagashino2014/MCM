import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

const COMPANY_ROLES = new Set(["group_representative", "affiliate", "other"]);

function normalizeCompanyRole(value: unknown): "group_representative" | "affiliate" | "other" {
  const role = String(value ?? "").trim();
  return COMPANY_ROLES.has(role) ? (role as "group_representative" | "affiliate" | "other") : "affiliate";
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { groupId } = await ctx.params;
    const body = await req.json();
    const companyName = normalizeCompanyName(body.companyName) ?? String(body.companyName ?? "").trim();
    if (!companyName) return NextResponse.json({ error: "상호는 필수입니다." }, { status: 400 });
    const groupRole =
      body.groupRole == null && body.isHeadquarters ? "group_representative" : normalizeCompanyRole(body.groupRole);
    const companyId = "co_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_group_companies
          (company_id, group_id, division_id, company_name, business_registration_no,
           address, phone_number, logo_path, group_role, is_headquarters, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          companyId,
          groupId,
          body.divisionId?.trim?.() || null,
          companyName,
          normalizeBusinessRegistrationNo(body.businessRegistrationNo),
          normalizeAddress(body.address),
          body.phoneNumber?.trim?.() || null,
          body.logoPath?.trim?.() || null,
          groupRole,
          groupRole === "group_representative" || body.isHeadquarters ? 1 : 0,
          now,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_update",
        targetTable: "facility_group_companies",
        targetId: companyId,
        after: body,
      });
    });
    return NextResponse.json({ companyId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
