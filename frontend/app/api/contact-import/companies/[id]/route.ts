import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 회사의 담당자 명단 — 행을 펼칠 때만 불러온다. */
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.edit");
    const { id } = await ctx.params;
    const db = await getDb();
    const contacts = rowsToObjects(await db.exec(
      `SELECT id, person_name, title, department, office_phone, mobile_phone, fax_number, email, status
         FROM contact_import_rows WHERE company_id = $1 ORDER BY person_name ASC, id ASC`,
      [id]
    )).map((r) => ({
      id: Number(r.id),
      personName: String(r.person_name),
      title: r.title != null ? String(r.title) : null,
      department: r.department != null ? String(r.department) : null,
      officePhone: r.office_phone != null ? String(r.office_phone) : null,
      mobilePhone: r.mobile_phone != null ? String(r.mobile_phone) : null,
      email: r.email != null ? String(r.email) : null,
      status: String(r.status),
    }));
    return NextResponse.json({ contacts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
