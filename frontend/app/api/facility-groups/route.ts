import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = (prefix: string) => prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

const companyRoleFromRow = (row: Record<string, unknown>) => {
  const role = String(row.group_role ?? "").trim();
  if (role === "group_representative" || role === "affiliate" || role === "other") return role;
  return Number(row.is_headquarters ?? 0) === 1 ? "group_representative" : "affiliate";
};

export async function GET() {
  try {
    await requirePermission("facility.view");
    const db = await getDb();
    const groups = rowsToObjects(await db.exec("SELECT * FROM facility_groups ORDER BY group_name ASC")).map((row) => ({
      groupId: String(row.group_id ?? ""),
      groupName: String(row.group_name ?? ""),
      logoPath: row.logo_path != null ? String(row.logo_path) : null,
      totalRevenue: row.total_revenue != null ? Number(row.total_revenue) : null,
      employeeCount: row.employee_count != null ? Number(row.employee_count) : null,
      description: row.description != null ? String(row.description) : null,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      divisions: [] as any[],
      companies: [] as any[],
    }));
    const byGroup = new Map(groups.map((group) => [group.groupId, group]));
    const divisionRows = rowsToObjects(
      await db.exec("SELECT * FROM facility_group_divisions ORDER BY sort_order ASC, division_name ASC")
    );
    const divisionById = new Map<string, any>();
    for (const row of divisionRows) {
      const division = {
        divisionId: String(row.division_id ?? ""),
        groupId: String(row.group_id ?? ""),
        divisionName: String(row.division_name ?? ""),
        sortOrder: Number(row.sort_order ?? 0),
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? ""),
        companies: [] as any[],
      };
      divisionById.set(division.divisionId, division);
      byGroup.get(division.groupId)?.divisions.push(division);
    }
    const companyRows = rowsToObjects(
      await db.exec("SELECT * FROM facility_group_companies ORDER BY is_headquarters DESC, company_name ASC")
    );
    for (const row of companyRows) {
      const company = {
        companyId: String(row.company_id ?? ""),
        groupId: String(row.group_id ?? ""),
        divisionId: row.division_id != null ? String(row.division_id) : null,
        companyName: String(row.company_name ?? ""),
        businessRegistrationNo:
          row.business_registration_no != null ? String(row.business_registration_no) : null,
        address: row.address != null ? String(row.address) : null,
        phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
        logoPath: row.logo_path != null ? String(row.logo_path) : null,
        groupRole: companyRoleFromRow(row),
        isHeadquarters: Number(row.is_headquarters ?? 0) === 1,
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? ""),
      };
      byGroup.get(company.groupId)?.companies.push(company);
      if (company.divisionId) divisionById.get(company.divisionId)?.companies.push(company);
    }
    return NextResponse.json({ items: groups });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const body = await req.json();
    const groupName = String(body.groupName ?? "").trim();
    if (!groupName) return NextResponse.json({ error: "그룹명은 필수입니다." }, { status: 400 });
    const now = new Date().toISOString();
    const groupId = id("grp");
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_groups
          (group_id, group_name, logo_path, total_revenue, employee_count, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          groupId,
          groupName,
          body.logoPath ?? null,
          body.totalRevenue === "" || body.totalRevenue == null ? null : Number(body.totalRevenue),
          body.employeeCount === "" || body.employeeCount == null ? null : Number(body.employeeCount),
          body.description?.trim?.() || null,
          now,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_create",
        targetTable: "facility_groups",
        targetId: groupId,
        after: body,
      });
    });
    return NextResponse.json({ groupId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

