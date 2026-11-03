import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite, rowsToObjects } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { parsePurchaseContractInput } from "@/lib/contracts/purchase/validate";
import { createAsset, updateAsset } from "@/lib/assets/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = () => "pct_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/**
 * 매입 계약 등록(331·333). 금액은 외주면 단계 합계로 뒤에 채워지고, 정기 구독만 본문의 월 구독료를 받는다.
 * 차량 렌트(333)는 자산관리 차량(reservable_assets)을 먼저 만들어 linked_asset_id 로 연결한다 — 자산 저장소가 자체
 * 트랜잭션을 쓰므로 계약 트랜잭션 밖에서 만들고, 계약 저장이 실패하면 비활성화로 되돌린다.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("purchase.edit");
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parsePurchaseContractInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const purchaseContractId = id();
    const now = new Date().toISOString();
    let linkedAssetId: string | null = null;
    const vehicle = input.typeDetails.vehicle;
    if (vehicle) {
      const asset = await createAsset({
        kind: "vehicle",
        name: vehicle.name,
        description: vehicle.description || `매입 계약 ${input.contractTitle}`,
        vehicle: {
          plateNo: vehicle.plateNo || null,
          ownership: vehicle.ownership,
          ownerName: vehicle.ownerName || null,
          acquiredAt: vehicle.acquiredAt || input.contractDate,
          contractMonths: vehicle.contractMonths,
          returnedAt: vehicle.returnedAt || null,
          acquisitionPrice: vehicle.acquisitionPrice,
          monthlyFee: vehicle.monthlyFee,
        },
      });
      linkedAssetId = asset.assetId;
    }
    try {
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
      // 계정과목 존재 검사 — journal_accounts 외래키는 재무 설치 지문을 깨서 332 에서 뺐다.
      if (input.accountCode) {
        const account = rowsToObjects(
          await db.exec("SELECT account_code FROM journal_accounts WHERE account_code = $1", [input.accountCode])
        );
        if (account.length === 0) throw Object.assign(new Error("계정과목을 찾을 수 없습니다."), { status: 400 });
      }
      await db.run(
        `INSERT INTO purchase_contracts
          (purchase_contract_id, contract_title, counterparty_facility_id, contract_type, contract_category,
           related_contract_id, contract_amount, contract_date, completed_at, is_unit_price, has_extra_spend, is_metered,
           account_code, contract_status, memo, type_details, linked_asset_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', $14, $15::jsonb, $16, $17, $18, $18)`,
        [
          purchaseContractId,
          input.contractTitle,
          input.counterpartyFacilityId,
          input.contractType,
          input.contractCategory,
          input.relatedContractId,
          input.contractAmount,
          input.contractDate,
          input.completedAt,
          input.isUnitPrice,
          input.hasExtraSpend,
          input.isMetered,
          input.accountCode,
          input.memo,
          JSON.stringify(input.typeDetails),
          linkedAssetId,
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
        after: { ...input, linkedAssetId },
      });
    });
    } catch (err) {
      // 계약 저장 실패 — 먼저 만든 차량 자산은 예약 이력이 없으므로 비활성화로 되돌린다(자산 삭제 정책과 같은 방식).
      if (linkedAssetId) await updateAsset(linkedAssetId, { active: false }).catch(() => undefined);
      throw err;
    }
    return NextResponse.json({ purchaseContractId, linkedAssetId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
