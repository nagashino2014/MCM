import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite, rowsToObjects } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getPurchaseContractDetail } from "@/lib/contracts/purchase/queries";
import { parsePurchaseContractInput } from "@/lib/contracts/purchase/validate";
import { parseTypeDetails } from "@/lib/contracts/purchase/type-details";
import { createAsset, updateAsset } from "@/lib/assets/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    await requirePermission("purchase.view");
    const detail = await getPurchaseContractDetail(purchaseContractId);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 계약 정보 수정 — 등록과 같은 검증(parsePurchaseContractInput)을 전체 본문에 적용한다.
 * 화면이 현재 값을 모두 보내므로 부분 PATCH 가 아니라 전체 치환이다(외주 금액은 단계 합계라 본문 값을 쓰지 않는다).
 * 차량 렌트(333)는 연결된 자산관리 차량을 같이 고치고, 연결이 없으면(분류를 차량 렌트로 바꾼 경우) 새로 만든다.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const before = await getPurchaseContractDetail(purchaseContractId);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parsePurchaseContractInput({ ...before.contract, ...camelFromRow(before.contract), ...body });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;
    const now = new Date().toISOString();
    // 외주 계약은 단계 합계(recalc)가 금액이라 기존 값을 유지한다.
    const contractAmount = input.contractType === "outsourcing" ? (before.contract.contract_amount as number | null) ?? null : input.contractAmount;

    let linkedAssetId: string | null = before.contract.linked_asset_id != null && String(before.contract.linked_asset_id) ? String(before.contract.linked_asset_id) : null;
    const vehicle = input.typeDetails.vehicle;
    if (vehicle) {
      const vehicleInput = {
        plateNo: vehicle.plateNo || null,
        ownership: vehicle.ownership,
        ownerName: vehicle.ownerName || null,
        acquiredAt: vehicle.acquiredAt || input.contractDate,
        contractMonths: vehicle.contractMonths,
        returnedAt: vehicle.returnedAt || null,
        acquisitionPrice: vehicle.acquisitionPrice,
        monthlyFee: vehicle.monthlyFee,
      };
      if (linkedAssetId) {
        await updateAsset(linkedAssetId, { name: vehicle.name, description: vehicle.description || null, vehicle: vehicleInput });
      } else {
        const asset = await createAsset({ kind: "vehicle", name: vehicle.name, description: vehicle.description || `매입 계약 ${input.contractTitle}`, vehicle: vehicleInput });
        linkedAssetId = asset.assetId;
      }
    }

    await withDbWrite(async (db) => {
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
        `UPDATE purchase_contracts
            SET contract_title = $2, counterparty_facility_id = $3, contract_type = $4, contract_category = $5,
                related_contract_id = $6, contract_date = $7, completed_at = $8,
                is_unit_price = $9, has_extra_spend = $10, is_metered = $11, account_code = $12, memo = $13,
                contract_status = $14, contract_amount = $15, type_details = $16::jsonb, linked_asset_id = $17, updated_at = $18
          WHERE purchase_contract_id = $1 AND deleted_at IS NULL`,
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
          normalizeStatus(body.contractStatus, String(before.contract.contract_status ?? "active")),
          contractAmount,
          JSON.stringify(input.typeDetails),
          linkedAssetId,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_update",
        targetTable: "purchase_contracts",
        targetId: purchaseContractId,
        before: before.contract,
        after: { ...input, linkedAssetId },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 삭제 — soft delete(deleted_at·사유). 휴지통(trash_items) 연동은 후속. */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.delete");
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "삭제 사유를 입력해 주세요." }, { status: 400 });
    const before = await getPurchaseContractDetail(purchaseContractId);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `UPDATE purchase_contracts SET deleted_at = $2, deleted_by = $3, delete_reason = $4, updated_at = $2
          WHERE purchase_contract_id = $1 AND deleted_at IS NULL`,
        [purchaseContractId, now, actor.userId, reason]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_delete",
        targetTable: "purchase_contracts",
        targetId: purchaseContractId,
        before: before.contract,
        after: { reason },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 저장된 행(snake_case)을 등록 본문 키로 바꿔 부분 수정의 기본값으로 쓴다. */
function camelFromRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    contractTitle: row.contract_title,
    counterpartyFacilityId: row.counterparty_facility_id,
    contractType: row.contract_type,
    contractCategory: row.contract_category,
    relatedContractId: row.related_contract_id,
    contractDate: row.contract_date,
    completedAt: row.completed_at,
    isUnitPrice: row.is_unit_price,
    hasExtraSpend: row.has_extra_spend,
    isMetered: row.is_metered,
    accountCode: row.account_code,
    memo: row.memo,
    contractAmount: row.contract_amount,
    typeDetails: parseTypeDetails(row.type_details),
  };
}

function normalizeStatus(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return ["active", "terminated", "suspended"].includes(text) ? text : fallback;
}
