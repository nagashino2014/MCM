import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { changeFacilityListing, TRADE_ROLES, type ListingAction, type TradeRole } from "@/lib/contact-import/store";
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

/** 사업장 조회 권한이 없는 직원용 요약과 담당자. 권한이 있으면 화면은 사업장 상세를 그대로 쓴다. */
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("contact.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const facility = rowsToObjects(await db.exec(
      `SELECT company_name, org_category, COALESCE(NULLIF(TRIM(business_registration_no), ''), site_business_registration_no) AS brn,
              representative_name, site_address, phone_number, homepage_url
         FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`,
      [id]
    ))[0];
    if (!facility) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
    const contacts = rowsToObjects(await db.exec(
      `SELECT p.id, p.person_name, p.title, d.department_name, p.office_phone, p.mobile_phone, p.email
         FROM facility_contact_people p
         LEFT JOIN facility_contact_departments d ON d.id = p.department_id
        WHERE p.facility_id = $1 AND p.status <> 'inactive'
        ORDER BY p.person_name ASC, p.id ASC`,
      [id]
    ));
    return NextResponse.json({
      party: {
        companyName: formatCompanyName(String(facility.company_name)) ?? String(facility.company_name),
        orgCategory: text(facility.org_category),
        businessRegistrationNo: formatBusinessRegistrationNo(text(facility.brn)),
        representativeName: text(facility.representative_name),
        address: text(facility.site_address),
        phoneNumber: text(facility.phone_number),
        homepageUrl: text(facility.homepage_url),
      },
      contacts: contacts.map((r) => ({
        id: Number(r.id),
        personName: String(r.person_name),
        title: text(r.title),
        department: text(r.department_name),
        officePhone: text(r.office_phone),
        mobilePhone: text(r.mobile_phone),
        email: text(r.email),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 사업장 마스터 ↔ 기타 목록 이동, 거래처 승격. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string; tradeRoles?: string[] };
    let change: ListingAction;
    if (body.action === "other" || body.action === "master") {
      change = { action: body.action };
    } else if (body.action === "promote") {
      const tradeRoles = (body.tradeRoles ?? []).filter((r): r is TradeRole => (TRADE_ROLES as readonly string[]).includes(r));
      if (!tradeRoles.length) return NextResponse.json({ error: "매출·매입 중 거래 구분을 골라 주세요." }, { status: 400 });
      change = { action: "promote", tradeRoles };
    } else {
      return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
    }
    await withDbWrite((db) => changeFacilityListing(db, id, change, actor.userId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
