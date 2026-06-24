import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  groupId?: string | null;
  companyId?: string | null;
  divisionId?: string | null;
  companyRole?: string | null;
  relationType?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

const RELATION_TYPES = new Set(["site", "operating_company", "owner_company", "other"]);
const COMPANY_ROLES = new Set(["group_representative", "affiliate", "other"]);
const newCompanyId = () => "gco_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

function normalizeRelationType(value: string | null | undefined) {
  const relationType = value?.trim() || "operating_company";
  return RELATION_TYPES.has(relationType) ? relationType : null;
}

function normalizeCompanyRole(value: string | null | undefined) {
  const role = value?.trim() || "affiliate";
  return COMPANY_ROLES.has(role) ? role : "affiliate";
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as Body;
    if (!body.groupId) {
      return NextResponse.json({ error: "그룹을 선택해야 합니다." }, { status: 400 });
    }
    const groupId = body.groupId;
    let companyId = body.companyId?.trim() || "";
    const divisionId = body.divisionId?.trim() || null;
    const companyRole = normalizeCompanyRole(body.companyRole);
    const relationType = normalizeRelationType(body.relationType);
    if (!relationType) {
      return NextResponse.json({ error: "지원하지 않는 사업장 연결 관계입니다." }, { status: 400 });
    }
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_memberships WHERE facility_id = $1", [id]);
      if (!companyId) {
        const facilityRows = await db.exec(
          `SELECT company_name, business_registration_no, site_address, phone_number
             FROM facilities
            WHERE facility_id = $1
              AND deleted_at IS NULL
            LIMIT 1`,
          [id]
        );
        const facility = facilityRows.length && facilityRows[0].values.length
          ? Object.fromEntries(facilityRows[0].columns.map((column, index) => [column, facilityRows[0].values[0][index]]))
          : null;
        if (!facility) throw new Error("사업장을 찾을 수 없습니다.");

        const existingCompanyRows = facility.business_registration_no
          ? await db.exec(
              `SELECT company_id
                 FROM facility_group_companies
                WHERE group_id = $1
                  AND business_registration_no = $2
                LIMIT 1`,
              [groupId, facility.business_registration_no]
            )
          : await db.exec(
              `SELECT company_id
                 FROM facility_group_companies
                WHERE group_id = $1
                  AND company_name = $2
                LIMIT 1`,
              [groupId, facility.company_name]
            );
        if (existingCompanyRows.length && existingCompanyRows[0].values.length) {
          companyId = String(existingCompanyRows[0].values[0][0]);
          await db.run(
            `UPDATE facility_group_companies
                SET division_id = $1,
                    group_role = $2,
                    is_headquarters = $3,
                    updated_at = $4
              WHERE company_id = $5`,
            [divisionId, companyRole, companyRole === "group_representative" ? 1 : 0, now, companyId]
          );
        } else {
          companyId = newCompanyId();
          await db.run(
            `INSERT INTO facility_group_companies
              (company_id, group_id, division_id, company_name, business_registration_no,
               address, phone_number, group_role, is_headquarters, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              companyId,
              groupId,
              divisionId,
              facility.company_name,
              facility.business_registration_no,
              facility.site_address,
              facility.phone_number,
              companyRole,
              companyRole === "group_representative" ? 1 : 0,
              now,
              now,
            ]
          );
        }
      }
      await db.run(
        `INSERT INTO facility_group_memberships
          (facility_id, group_id, company_id, relation_type, started_at, ended_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (facility_id) DO UPDATE SET
           group_id = excluded.group_id,
           company_id = excluded.company_id,
           relation_type = excluded.relation_type,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           updated_at = excluded.updated_at`,
        [
          id,
          groupId,
          companyId,
          relationType,
          body.startedAt?.trim() || null,
          body.endedAt?.trim() || null,
          now,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_membership_update",
        targetTable: "facility_group_memberships",
        targetId: id,
        before,
        after: { ...body, companyId, divisionId, companyRole },
      });
    });
    return NextResponse.json({ ok: true, companyId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_memberships WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_group_memberships WHERE facility_id = $1", [id]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_membership_update",
        targetTable: "facility_group_memberships",
        targetId: id,
        before,
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
