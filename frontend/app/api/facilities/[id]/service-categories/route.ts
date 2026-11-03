import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  normalizeFacilityCompanySize,
  normalizePurchaseContractTypes,
  normalizeServiceCategories,
  normalizeTradeRoles,
  type FacilityCompanySize,
  type FacilityServiceCategory,
  type FacilityTradeRole,
} from "@/lib/ieps/facility-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  serviceCategories?: FacilityServiceCategory[];
  companySize?: FacilityCompanySize | null;
  /** 거래 구분(331) — 생략하면 기존 값을 유지한다(구 클라이언트 호환). */
  tradeRoles?: FacilityTradeRole[];
  /** 계약 유형 중 매입 계약(334) — 생략하면 기존 값을 유지한다(구 클라이언트 호환). */
  purchaseContractTypes?: string[];
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as Body;
    const categories = normalizeServiceCategories(body.serviceCategories);
    const companySize = normalizeFacilityCompanySize(body.companySize);
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const before = {
        categories: await db.exec("SELECT category FROM facility_service_categories WHERE facility_id = $1", [id]),
        companySize: await db.exec("SELECT company_size FROM facilities WHERE facility_id = $1", [id]),
      };
      await db.run("DELETE FROM facility_service_categories WHERE facility_id = $1", [id]);
      for (const category of categories) {
        await db.run(
          `INSERT INTO facility_service_categories
            (facility_id, category, created_at, created_by)
           VALUES ($1, $2, $3, $4)`,
          [id, category, now, actor.userId]
        );
      }
      await db.run("UPDATE facilities SET company_size = $1, updated_at = $2 WHERE facility_id = $3", [
        companySize,
        now,
        id,
      ]);
      // 거래 구분(331) — 매출처·매입처. 본문에 있을 때만 바꾼다.
      const tradeRoles = body.tradeRoles !== undefined ? normalizeTradeRoles(body.tradeRoles) : null;
      if (tradeRoles) {
        await db.run("UPDATE facilities SET trade_roles = $1::text[], updated_at = $2 WHERE facility_id = $3", [tradeRoles, now, id]);
      }
      // 계약 유형 중 매입 계약(334) — 외주·정기 구독·임대·관리. 본문에 있을 때만 바꾼다.
      const purchaseContractTypes =
        body.purchaseContractTypes !== undefined ? normalizePurchaseContractTypes(body.purchaseContractTypes) : null;
      if (purchaseContractTypes) {
        await db.run(
          "UPDATE facilities SET purchase_contract_types = $1::text[], updated_at = $2 WHERE facility_id = $3",
          [purchaseContractTypes, now, id]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_service_update",
        targetTable: "facilities",
        targetId: id,
        before,
        after: {
          serviceCategories: categories,
          companySize,
          ...(tradeRoles ? { tradeRoles } : {}),
          ...(purchaseContractTypes ? { purchaseContractTypes } : {}),
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
