import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { recalcPurchaseContractAmount } from "@/lib/contracts/purchase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

const newMilestoneId = () => "pcm_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** 청구·지급 단계 추가(331) — 매출 milestones POST 와 같은 흐름. 저장 뒤 계약금액 = 단계 합계. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const body = await req.json();
    const stageLabel = String(body.stageLabel ?? "").trim();
    if (!stageLabel) return NextResponse.json({ error: "단계명이 필요합니다." }, { status: 400 });
    const stageOrderInput = Number(body.stageOrder);
    const amount = toNullableNumber(body.amount);
    const paymentTerms = body.paymentTerms != null ? String(body.paymentTerms).trim() || null : null;
    const milestoneId = newMilestoneId();
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const exists = rowsToObjects(
        await db.exec("SELECT purchase_contract_id FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL", [
          purchaseContractId,
        ])
      );
      if (exists.length === 0) throw Object.assign(new Error("매입 계약을 찾을 수 없습니다."), { status: 404 });

      let stageOrder = Number.isFinite(stageOrderInput) ? stageOrderInput : 0;
      if (!Number.isFinite(stageOrderInput)) {
        const maxRow = rowsToObjects(
          await db.exec(
            "SELECT COALESCE(MAX(stage_order), 0) AS max_order FROM purchase_contract_milestones WHERE purchase_contract_id = $1",
            [purchaseContractId]
          )
        );
        stageOrder = Number(maxRow[0]?.max_order ?? 0) + 1;
      }
      const stageKey = `stage_${stageOrder}_${milestoneId.slice(-6)}`;
      await db.run(
        `INSERT INTO purchase_contract_milestones
          (milestone_id, purchase_contract_id, stage_key, stage_label, stage_order, amount, amount_ratio, payment_terms,
           invoice_received, payment_paid, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $9)`,
        [milestoneId, purchaseContractId, stageKey, stageLabel, stageOrder, amount, toNullableNumber(body.amountRatio), paymentTerms, now]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_payment_update",
        targetTable: "purchase_contract_milestones",
        targetId: milestoneId,
        after: { purchaseContractId, stageKey, stageLabel, stageOrder, amount, paymentTerms },
      });
      await recalcPurchaseContractAmount(db, purchaseContractId, now);
    });
    return NextResponse.json({ milestoneId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
