import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDb, rowsToObjects } from "@/lib/db";
import { FACILITY_OTHER_SQL } from "@/lib/ieps/queries";
import { formatBusinessRegistrationNo, formatCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 기타 업체·기관 목록 — 사업장 마스터에 두지 않는 facilities 행. 담당자 연락처처럼 전 직원이 본다. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requirePermission("contact.view");
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim();
    const category = (params.get("category") ?? "").trim();
    const db = await getDb();
    const parties = rowsToObjects(await db.exec(
      `SELECT f.facility_id, f.company_name, f.org_category, f.source, f.listing,
              COALESCE(NULLIF(TRIM(f.business_registration_no), ''), f.site_business_registration_no) AS brn,
              f.region_sido, f.region_sigungu,
              (SELECT COUNT(*)::int FROM facility_contact_people p WHERE p.facility_id = f.facility_id AND p.status <> 'inactive') AS contact_count
         FROM facilities f
        WHERE f.deleted_at IS NULL AND ${FACILITY_OTHER_SQL}
          AND ($1 = '' OR f.company_name ILIKE '%' || $1 || '%' OR f.business_registration_no ILIKE '%' || $1 || '%'
               OR EXISTS (SELECT 1 FROM facility_contact_people p WHERE p.facility_id = f.facility_id AND p.person_name ILIKE '%' || $1 || '%'))
          AND ($2 = '' OR f.org_category = $2)
        ORDER BY f.company_name ASC`,
      [q, category]
    )).map((r) => ({
      facilityId: String(r.facility_id),
      companyName: formatCompanyName(String(r.company_name)) ?? String(r.company_name),
      orgCategory: r.org_category != null ? String(r.org_category) : null,
      businessRegistrationNo: formatBusinessRegistrationNo(r.brn != null ? String(r.brn) : null),
      region: [r.region_sido, r.region_sigungu].filter(Boolean).join(" ") || null,
      contactCount: Number(r.contact_count ?? 0),
    }));
    const [canEdit, canDelete, canViewFacility] = await Promise.all([
      hasPermission(actor.userId, "facility.edit"), hasPermission(actor.userId, "facility.delete"), hasPermission(actor.userId, "facility.view"),
    ]);
    return NextResponse.json({ parties, canEdit, canDelete, canViewFacility });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
