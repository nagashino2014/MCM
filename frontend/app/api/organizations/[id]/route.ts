import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { isOrgCategory } from "@/lib/directory-categories";
import { companyKey, regionOf } from "@scraper/lib/contact-import/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const text = (value: unknown): string | null => {
  const s = value == null ? "" : String(value).trim();
  return s || null;
};

const contactOf = (r: Record<string, unknown>) => ({
  id: Number(r.id),
  personName: String(r.person_name),
  title: text(r.title),
  department: text(r.department),
  officePhone: text(r.office_phone),
  mobilePhone: text(r.mobile_phone),
  faxNumber: text(r.fax_number),
  email: text(r.email),
});

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("contact.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const org = rowsToObjects(await db.exec(`SELECT * FROM external_organizations WHERE org_id = $1 AND deleted_at IS NULL`, [id]))[0];
    if (!org) return NextResponse.json({ error: "기관을 찾을 수 없습니다." }, { status: 404 });
    const contacts = rowsToObjects(await db.exec(`SELECT * FROM external_org_contacts WHERE org_id = $1 ORDER BY person_name ASC, id ASC`, [id]));
    return NextResponse.json({
      organization: {
        orgId: String(org.org_id),
        orgName: String(org.org_name),
        orgCategory: text(org.org_category),
        businessRegistrationNo: text(org.business_registration_no),
        corporateRegistrationNo: text(org.corporate_registration_no),
        address: text(org.address),
        phoneNumber: text(org.phone_number),
        homepageUrl: text(org.homepage_url),
        memo: text(org.memo),
        source: String(org.source),
      },
      contacts: contacts.map(contactOf),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = text(body.orgName);
    if (!name) return NextResponse.json({ error: "기관명은 필수입니다." }, { status: 400 });
    const category = text(body.orgCategory);
    if (category && !isOrgCategory(category)) return NextResponse.json({ error: "기관 구분이 올바르지 않습니다." }, { status: 400 });
    const address = text(body.address);
    const region = regionOf(address);
    const now = new Date().toISOString();
    const key = companyKey(name);
    const result = await withDbWrite(async (db) => {
      const same = rowsToObjects(await db.exec(`SELECT org_id FROM external_organizations WHERE normalized_name = $1 AND org_id <> $2 AND deleted_at IS NULL`, [key, id]));
      if (same.length) return "duplicate" as const;
      const updated = rowsToObjects(await db.exec(
        `UPDATE external_organizations SET org_name = $2, normalized_name = $3, org_category = $4, business_registration_no = $5, corporate_registration_no = $6,
           address = $7, region_sido = $8, region_sigungu = $9, phone_number = $10, homepage_url = $11, memo = $12, updated_at = $13
         WHERE org_id = $1 AND deleted_at IS NULL RETURNING org_id`,
        [id, name, key, category, text(body.businessRegistrationNo), text(body.corporateRegistrationNo), address, region.sido, region.sigungu,
          text(body.phoneNumber), text(body.homepageUrl), text(body.memo), now]
      ));
      if (!updated.length) return "missing" as const;
      await recordAuditLogInline(db, { actorUserId: actor.userId, action: "organization_update", targetTable: "external_organizations", targetId: id, after: { name, category } });
      return "ok" as const;
    });
    if (result === "duplicate") return NextResponse.json({ error: "같은 이름의 기관이 이미 있습니다." }, { status: 409 });
    if (result === "missing") return NextResponse.json({ error: "기관을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(`UPDATE external_organizations SET deleted_at = $2, updated_at = $2 WHERE org_id = $1 AND deleted_at IS NULL`, [id, now]);
      // 나중에 올라오는 같은 회사 담당자가 삭제된 기관으로 들어가지 않게 제외로 돌린다.
      await db.run(`UPDATE contact_import_companies SET decision = 'exclude', decided_org_id = NULL, updated_at = $2 WHERE decided_org_id = $1`, [id, now]);
      await recordAuditLogInline(db, { actorUserId: actor.userId, action: "organization_delete", targetTable: "external_organizations", targetId: id });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
