import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  relatedFacilityId?: string | null;
  facilityId?: string | null;
  entityName?: string | null;
  businessRegistrationNo?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
  memo?: string | null;
  relationType?: string | null;
  relationMemo?: string | null;
  startedAt?: string | null;
}

const RELATION_TYPES = new Set(["operating_entity", "owner_entity", "manager_entity", "other"]);

function normalizeRelationType(value: unknown) {
  const relationType = String(value ?? "operating_entity").trim();
  return RELATION_TYPES.has(relationType) ? relationType : "operating_entity";
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const body = (await req.json()) as Body;
    const now = new Date().toISOString();
    let relatedFacilityId = body.relatedFacilityId?.trim() || body.facilityId?.trim() || "";
    const relationType = normalizeRelationType(body.relationType);
    const entityName = normalizeCompanyName(body.entityName) ?? String(body.entityName ?? "").trim();
    if (!relatedFacilityId && !entityName) {
      return NextResponse.json({ error: "연결할 업체를 선택하거나 업체명을 입력해야 합니다." }, { status: 400 });
    }

    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_operating_entities WHERE facility_id = $1 AND ended_at IS NULL", [id]);

      if (!relatedFacilityId) {
        const brn = normalizeBusinessRegistrationNo(body.businessRegistrationNo);
        if (brn) {
          const found = await db.exec(
            "SELECT facility_id FROM facilities WHERE business_registration_no = $1 AND deleted_at IS NULL LIMIT 1",
            [brn]
          );
          if (found.length && found[0].values.length) {
            relatedFacilityId = String(found[0].values[0][0]);
          }
        }
      }

      if (!relatedFacilityId) {
        relatedFacilityId = "facm_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const companyName = entityName || "미지정 업체";
        const address = normalizeAddress(body.address);
        await db.run(
          `INSERT INTO facilities
            (facility_id, company_name, business_registration_no, site_address, site_address_verbatim,
             phone_number, normalized_company_name, normalized_address, source, memo, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            relatedFacilityId,
            companyName,
            normalizeBusinessRegistrationNo(body.businessRegistrationNo),
            address,
            true,
            body.phoneNumber?.trim() || null,
            companyName.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase(),
            address,
            "manual",
            body.memo?.trim() || null,
            now,
            now,
          ]
        );
      }

      await db.run(
        `INSERT INTO facility_operating_entities
          (facility_id, related_facility_id, relation_type, started_at, ended_at, is_primary, memo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, 1, $5, $6, $7)
         ON CONFLICT (facility_id, relation_type) WHERE ended_at IS NULL AND is_primary = 1
         DO UPDATE SET
           related_facility_id = excluded.related_facility_id,
           started_at = excluded.started_at,
           memo = excluded.memo,
           updated_at = excluded.updated_at`,
        [
          id,
          relatedFacilityId,
          relationType,
          body.startedAt?.trim() || null,
          body.relationMemo?.trim() || null,
          now,
          now,
        ]
      );

      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_operating_entity_update",
        targetTable: "facility_operating_entities",
        targetId: id,
        before,
        after: { ...body, relatedFacilityId, relationType },
      });
    });

    return NextResponse.json({ ok: true, relatedFacilityId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_operating_entities WHERE facility_id = $1 AND ended_at IS NULL", [id]);
      await db.run("DELETE FROM facility_operating_entities WHERE facility_id = $1 AND ended_at IS NULL", [id]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_operating_entity_update",
        targetTable: "facility_operating_entities",
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
