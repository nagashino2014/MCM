import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite, rowsToObjects } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { parsePurchaseContractInput } from "@/lib/contracts/purchase/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = () => "pct_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** 매입 계약 등록(331). 금액은 단계 합계로 뒤에 채워지므로 여기서는 받지 않는다. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("purchase.edit");
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parsePurchaseContractInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const purchaseContractId = id();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const facility = rowsToObjects(
        await db.exec("SELECT facility_id FROM facilities WHERE facility_id = $1", [input.counterpartyFacilityId])
      );
      if (facility.length === 0) throw Object.assign(new Error("계약상대 업체를 찾을 수 없습니다."), { status: 400 });
      if (input.relatedContractId) {
        const related = rowsToObjects(
          await db.exec("SELECT contract_id FROM contracts WHERE contract_id = $1 AND deleted_at IS NULL", [input.relatedContractId])
        );
        if (related.length === 0) throw Object.assign(new Error("관련 매출 계약을 찾을 수 없습니다."), { status: 400 });
      }
      await db.run(
        `INSERT INTO purchase_contracts
          (purchase_contract_id, contract_title, counterparty_facility_id, contract_type, contract_category,
           related_contract_id, contract_date, completed_at, is_unit_price, has_extra_spend, is_metered,
           account_code, contract_status, memo, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, $14, $15, $15)`,
        [
          purchaseContractId,
          input.contractTitle,
          input.counterpartyFacilityId,
          input.contractType,
          input.contractCategory,
          input.relatedContractId,
          input.contractDate,
          input.completedAt,
          input.isUnitPrice,
          input.hasExtraSpend,
          input.isMetered,
          input.accountCode,
          input.memo,
          actor.userId,
          now,
        ]
      );
      // 계약상대를 매입처로 표시(거래 구분) — 이미 있으면 그대로.
      await db.run(
        `UPDATE facilities SET trade_roles = array_append(COALESCE(trade_roles, '{}'), 'purchase'), updated_at = $2
          WHERE facility_id = $1 AND NOT ('purchase' = ANY(COALESCE(trade_roles, '{}')))`,
        [input.counterpartyFacilityId, now]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_create",
        targetTable: "purchase_contracts",
        targetId: purchaseContractId,
        after: input,
      });
    });
    return NextResponse.json({ purchaseContractId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
