import { withContractTransactionWrite } from "@/lib/finance/contract-link-lock";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { applyMilestoneCollection, type CollectionPlan } from "@/lib/contracts/milestone-collection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; milestoneId: string }>;
}

// 부분입금 1건 추가 — 누적·완료 판정은 lib/contracts/milestone-collection.ts(자동대조와 같은 규칙).
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, milestoneId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const body = await req.json();
    const collectedAt = String(body.collectedAt ?? "").trim();
    const amount = toNumberOrNull(body.amount);
    const ratioInput = toNumberOrNull(body.ratio);
    const memo = body.memo ? String(body.memo).trim() : null;

    if (!collectedAt) return NextResponse.json({ error: "수금일이 필요합니다." }, { status: 400 });
    if (amount == null && ratioInput == null) {
      return NextResponse.json({ error: "수금금액 또는 수금비율 중 하나는 필요합니다." }, { status: 400 });
    }

    let result: (CollectionPlan & { baseAmount: number }) | null = null;
    await withContractTransactionWrite(contractId, milestoneId, async (db) => {
      // 비율만 들어오면 발행금액(없으면 단계 금액) 기준으로 금액을 환산한다.
      let computedAmount = amount;
      if (computedAmount == null) {
        const rows = rowsToObjects(
          await db.exec(
            "SELECT amount, invoice_amount FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
            [milestoneId, contractId]
          )
        );
        const baseAmount = Number(rows[0]?.invoice_amount ?? rows[0]?.amount ?? 0);
        computedAmount = baseAmount > 0 && ratioInput != null ? Math.round(baseAmount * ratioInput) : 0;
      }
      result = await applyMilestoneCollection(db, contractId, milestoneId, {
        mode: "add",
        amount: computedAmount,
        collectedAt,
        memo,
        actorUserId: actor.userId,
      });
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        after: { partialPayment: result.added, totalAmount: result.totalAmount, totalRatio: result.totalRatio },
      });
    });

    const r = result as (CollectionPlan & { baseAmount: number }) | null;
    return NextResponse.json({
      entry: r?.added ?? null,
      totalAmount: r?.totalAmount ?? 0,
      totalRatio: r?.totalRatio ?? 0,
      baseAmount: r?.baseAmount ?? 0,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
