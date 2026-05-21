import { NextRequest, NextResponse } from "next/server";
import {
  authErrorToResponse,
  requireAuthenticated,
  requireEditor,
} from "@/lib/auth/guards";
import { getFacilityDetail } from "@/lib/ieps/queries";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { extractRegion } from "@scraper/lib/ieps/region";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";
import { normalizeFacilityCompanySize, type FacilityCompanySize } from "@/lib/ieps/facility-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { id } = await ctx.params;
    const detail = await getFacilityDetail(id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PatchBody {
  companyName?: string;
  businessRegistrationNo?: string | null;
  siteAddress?: string | null;
  phoneNumber?: string | null;
  industryCode?: string | null;
  industryName?: string | null;
  memo?: string | null;
  logoPath?: string | null;
  companySize?: FacilityCompanySize | null;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const body = (await req.json()) as PatchBody;
    const before = await getFacilityDetail(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    await withDbWrite(async (db) => {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      const pushSet = (column: string, value: unknown) => {
        setClauses.push(`${column} = $${values.length + 1}`);
        values.push(value);
      };

      if (body.companyName !== undefined) {
        const formattedCompanyName = normalizeCompanyName(body.companyName) ?? "";
        pushSet("company_name", formattedCompanyName);
        const norm = formattedCompanyName
          .replace(/\s+/g, "")
          .replace(/[\(\)（）]/g, "")
          .trim()
          .toLowerCase();
        pushSet("normalized_company_name", norm);
      }
      if (body.businessRegistrationNo !== undefined) {
        pushSet("business_registration_no", normalizeBusinessRegistrationNo(body.businessRegistrationNo));
      }
      if (body.siteAddress !== undefined) {
        const formattedAddress = normalizeAddress(body.siteAddress);
        pushSet("site_address", formattedAddress);
        const norm = formattedAddress?.replace(/\s+/g, " ").trim() ?? null;
        pushSet("normalized_address", norm);
        const region = extractRegion(formattedAddress);
        pushSet("region_sido", region.sido);
        pushSet("region_sigungu", region.sigungu);
      }
      if (body.phoneNumber !== undefined) {
        pushSet("phone_number", body.phoneNumber);
      }
      if (body.industryCode !== undefined) {
        pushSet("industry_code", body.industryCode);
      }
      if (body.industryName !== undefined) {
        pushSet("industry_name", body.industryName);
      }
      if (body.memo !== undefined) {
        pushSet("memo", body.memo);
      }
      if (body.logoPath !== undefined) {
        pushSet("logo_path", body.logoPath);
      }
      if (body.companySize !== undefined) {
        pushSet("company_size", normalizeFacilityCompanySize(body.companySize));
      }
      if (setClauses.length === 0) return;
      pushSet("updated_at", new Date().toISOString());
      values.push(id);
      await db.run(
        `UPDATE facilities SET ${setClauses.join(", ")} WHERE facility_id = $${values.length}`,
        values as any[]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_update",
        targetTable: "facilities",
        targetId: id,
        before,
        after: body,
      });
    });

    const after = await getFacilityDetail(id);
    return NextResponse.json(after);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const before = await getFacilityDetail(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    await withDbWrite(async (db) => {
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_delete",
        targetTable: "facilities",
        targetId: id,
        before,
        after: { deleted: true },
      });
      await db.run("DELETE FROM facility_annual_reports WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_aliases WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_service_categories WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_manual_products WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_group_memberships WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_main_numbers WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_logs WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_people WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_departments WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facilities WHERE facility_id = $1", [id]);
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
