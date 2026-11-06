import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const text = (value: unknown): string | null => {
  const s = value == null ? "" : String(value).trim();
  return s || null;
};

/** 담당자 추가·수정(id 있으면 수정). */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const personName = text(body.personName);
    if (!personName) return NextResponse.json({ error: "이름은 필수입니다." }, { status: 400 });
    const now = new Date().toISOString();
    const values = [personName, text(body.title), text(body.department), text(body.officePhone), text(body.mobilePhone), text(body.faxNumber), text(body.email)];
    const saved = await withDbWrite(async (db) => {
      const org = rowsToObjects(await db.exec(`SELECT org_id FROM external_organizations WHERE org_id = $1 AND deleted_at IS NULL`, [id]));
      if (!org.length) return null;
      const rows = body.id != null
        ? rowsToObjects(await db.exec(
            `UPDATE external_org_contacts SET person_name = $3, title = $4, department = $5, office_phone = $6, mobile_phone = $7, fax_number = $8, email = $9, updated_at = $10
             WHERE org_id = $1 AND id = $2 RETURNING id`,
            [id, Number(body.id), ...values, now]
          ))
        : rowsToObjects(await db.exec(
            `INSERT INTO external_org_contacts (org_id, person_name, title, department, office_phone, mobile_phone, fax_number, email, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
            [id, ...values, now]
          ));
      if (!rows.length) return null;
      await recordAuditLogInline(db, { actorUserId: actor.userId, action: "organization_contact_save", targetTable: "external_org_contacts", targetId: String(rows[0].id), after: { orgId: id } });
      return Number(rows[0].id);
    });
    if (saved === null) return NextResponse.json({ error: "기관이나 담당자를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ id: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const contactId = Number(req.nextUrl.searchParams.get("contactId"));
    if (!Number.isInteger(contactId)) return NextResponse.json({ error: "contactId 가 필요합니다." }, { status: 400 });
    await withDbWrite(async (db) => {
      await db.run(`DELETE FROM external_org_contacts WHERE org_id = $1 AND id = $2`, [id, contactId]);
      await recordAuditLogInline(db, { actorUserId: actor.userId, action: "organization_contact_delete", targetTable: "external_org_contacts", targetId: String(contactId), after: { orgId: id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
