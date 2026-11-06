import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { addFacilityTradeRoles, TRADE_ROLES, type TradeRole } from "@/lib/contact-import/store";
import { formatBusinessRegistrationNo, formatCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const text = (value: unknown): string | null => {
  const s = value == null ? "" : String(value).trim();
  return s || null;
};

/** 기관 목록에 보이는 기존 사업장(거래처 아님)의 요약과 담당자. 고치는 곳은 사업장 화면이다. */
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("contact.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const facility = rowsToObjects(await db.exec(
      `SELECT facility_id, company_name, org_category, COALESCE(NULLIF(TRIM(business_registration_no), ''), site_business_registration_no) AS brn,
              site_address, phone_number, homepage_url
         FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`,
      [id]
    ))[0];
    if (!facility) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });
    const contacts = rowsToObjects(await db.exec(
      `SELECT p.id, p.person_name, p.title, d.department_name, p.office_phone, p.mobile_phone, p.email
         FROM facility_contact_people p
         LEFT JOIN facility_contact_departments d ON d.id = p.department_id
        WHERE p.facility_id = $1 AND p.status <> 'inactive'
        ORDER BY p.person_name ASC, p.id ASC`,
      [id]
    ));
    return NextResponse.json({
      organization: {
        orgId: String(facility.facility_id),
        orgName: formatCompanyName(String(facility.company_name)) ?? String(facility.company_name),
        orgCategory: text(facility.org_category),
        businessRegistrationNo: formatBusinessRegistrationNo(text(facility.brn)),
        corporateRegistrationNo: null,
        address: text(facility.site_address),
        phoneNumber: text(facility.phone_number),
        homepageUrl: text(facility.homepage_url),
        memo: null,
        source: "facility",
      },
      contacts: contacts.map((r) => ({
        id: Number(r.id),
        personName: String(r.person_name),
        title: text(r.title),
        department: text(r.department_name),
        officePhone: text(r.office_phone),
        mobilePhone: text(r.mobile_phone),
        faxNumber: null,
        email: text(r.email),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 거래처로 지정한다. 거래 구분이 생기면 사업장 마스터 기본 목록으로 옮겨 보인다. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { tradeRoles?: string[] };
    const roles = (body.tradeRoles ?? []).filter((r): r is TradeRole => (TRADE_ROLES as readonly string[]).includes(r));
    if (!roles.length) return NextResponse.json({ error: "매출·매입 중 거래 구분을 골라 주세요." }, { status: 400 });
    const now = new Date().toISOString();
    const found = await withDbWrite(async (db) => {
      const facility = rowsToObjects(await db.exec(`SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [id]));
      if (!facility.length) return false;
      await addFacilityTradeRoles(db, id, roles, now);
      await recordAuditLogInline(db, { actorUserId: actor.userId, action: "organization_promote", targetTable: "facilities", targetId: id, after: { tradeRoles: roles } });
      return true;
    });
    if (!found) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ facilityId: id, created: false });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
