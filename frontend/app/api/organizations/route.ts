import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { upsertOrganization } from "@/lib/contact-import/store";
import { isOrgCategory } from "@/lib/directory-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (value: unknown): string | null => {
  const s = value == null ? "" : String(value).trim();
  return s || null;
};

/** 기관 목록 — 거래처가 아닌 기관·업체. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requirePermission("contact.view");
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim();
    const category = (params.get("category") ?? "").trim();
    const db = await getDb();
    const organizations = rowsToObjects(await db.exec(
      `SELECT o.org_id, o.org_name, o.org_category, o.business_registration_no, o.address, o.region_sido, o.region_sigungu, o.phone_number, o.homepage_url,
              (SELECT COUNT(*)::int FROM external_org_contacts c WHERE c.org_id = o.org_id) AS contact_count
         FROM external_organizations o
        WHERE o.deleted_at IS NULL
          AND ($1 = '' OR o.org_name ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM external_org_contacts c WHERE c.org_id = o.org_id AND c.person_name ILIKE '%' || $1 || '%'))
          AND ($2 = '' OR o.org_category = $2)
        ORDER BY o.org_name ASC`,
      [q, category]
    )).map((r) => ({
      orgId: String(r.org_id),
      orgName: String(r.org_name),
      orgCategory: r.org_category != null ? String(r.org_category) : null,
      businessRegistrationNo: r.business_registration_no != null ? String(r.business_registration_no) : null,
      address: r.address != null ? String(r.address) : null,
      region: [r.region_sido, r.region_sigungu].filter(Boolean).join(" ") || null,
      phoneNumber: r.phone_number != null ? String(r.phone_number) : null,
      homepageUrl: r.homepage_url != null ? String(r.homepage_url) : null,
      contactCount: Number(r.contact_count ?? 0),
    }));
    const [canEdit, canPromote] = await Promise.all([hasPermission(actor.userId, "contact.edit"), hasPermission(actor.userId, "facility.edit")]);
    return NextResponse.json({ organizations, canEdit, canPromote });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = text(body.orgName);
    if (!name) return NextResponse.json({ error: "기관명은 필수입니다." }, { status: 400 });
    const category = text(body.orgCategory);
    if (category && !isOrgCategory(category)) return NextResponse.json({ error: "기관 구분이 올바르지 않습니다." }, { status: 400 });
    const now = new Date().toISOString();
    const orgId = await withDbWrite(async (db) => {
      const id = await upsertOrganization(db, {
        name, category, brn: text(body.businessRegistrationNo), address: text(body.address), phone: text(body.phoneNumber),
        homepage: text(body.homepageUrl), memo: text(body.memo), source: "manual", userId: actor.userId, now,
      });
      await recordAuditLogInline(db, { actorUserId: actor.userId, action: "organization_create", targetTable: "external_organizations", targetId: id, after: { name, category } });
      return id;
    });
    return NextResponse.json({ orgId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
