import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import type { EnrichField } from "@/lib/ieps/facility-enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyItem {
  facilityId: string;
  field: EnrichField;
  value: string;
}

// 누락일 때만 채우는 컬럼별 가드 — 자동 보완이 기존 값을 덮지 않도록 한다.
const FIELD_GUARDS: Record<EnrichField, string> = {
  representative_name: "NULLIF(TRIM(COALESCE(representative_name,'')),'') IS NULL",
  phone_number: "NULLIF(TRIM(COALESCE(phone_number,'')),'') IS NULL",
  business_registration_no: "NULLIF(TRIM(COALESCE(business_registration_no,'')),'') IS NULL",
  industry_code: "NULLIF(TRIM(COALESCE(industry_code,'')),'') IS NULL",
  industry_name: "NULLIF(TRIM(COALESCE(industry_name,'')),'') IS NULL",
  site_address: "NULLIF(TRIM(COALESCE(site_address,'')),'') IS NULL",
};

/** 자동 보완 후보 중 사용자가 선택한 값들을 일괄 반영한다. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    const items = (Array.isArray(body.items) ? body.items : []) as ApplyItem[];
    const valid = items.filter(
      (it) =>
        it &&
        typeof it.facilityId === "string" &&
        it.facilityId &&
        typeof it.value === "string" &&
        it.value.trim() &&
        Object.prototype.hasOwnProperty.call(FIELD_GUARDS, it.field)
    );
    if (valid.length === 0) {
      return NextResponse.json({ error: "반영할 항목이 없습니다." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const result = await withDbWrite(async (db) => {
      let applied = 0;
      let skipped = 0;
      const byFacility = new Map<string, Record<string, string>>();
      for (const it of valid) {
        const r = await db.exec(
          `UPDATE facilities
              SET ${it.field} = $1, updated_at = $2
            WHERE facility_id = $3 AND deleted_at IS NULL AND ${FIELD_GUARDS[it.field]}
            RETURNING facility_id`,
          [it.value.trim(), now, it.facilityId]
        );
        if (r.length && r[0].values.length) {
          applied += 1;
          const acc = byFacility.get(it.facilityId) ?? {};
          acc[it.field] = it.value.trim();
          byFacility.set(it.facilityId, acc);
        } else {
          skipped += 1;
        }
      }
      for (const [facilityId, fields] of byFacility) {
        await recordAuditLogInline(db, {
          actorUserId: actor.userId,
          action: "facility_enrich_apply",
          targetTable: "facilities",
          targetId: facilityId,
          after: fields,
        });
      }
      return { applied, skipped };
    });

    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
