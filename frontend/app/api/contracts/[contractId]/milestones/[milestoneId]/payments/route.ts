import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; milestoneId: string }>;
}

interface PartialPaymentEntry {
  id: string;
  collectedAt: string;
  amount: number;
  ratio: number;
  memo: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId, milestoneId } = await ctx.params;
    const body = await req.json();
    const collectedAt = String(body.collectedAt ?? "").trim();
    const amount = toNumberOrNull(body.amount);
    const ratioInput = toNumberOrNull(body.ratio);
    const memo = body.memo ? String(body.memo).trim() : null;

    if (!collectedAt) return NextResponse.json({ error: "수금일이 필요합니다." }, { status: 400 });
    if (amount == null && ratioInput == null) {
      return NextResponse.json({ error: "수금금액 또는 수금비율 중 하나는 필요합니다." }, { status: 400 });
    }

    let entry: PartialPaymentEntry | null = null;
    let updatedTotalRatio = 0;
    let updatedTotalAmount = 0;
    let baseAmount = 0;

    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          "SELECT amount, partial_payments_json, collection_ratio, collected_amount FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
          [milestoneId, contractId]
        )
      );
      if (rows.length === 0) throw new Error("단계를 찾을 수 없습니다.");
      baseAmount = Number(rows[0].amount ?? 0);
      const existingRaw = rows[0].partial_payments_json;
      const existing: PartialPaymentEntry[] = Array.isArray(existingRaw)
        ? (existingRaw as PartialPaymentEntry[])
        : typeof existingRaw === "string" && existingRaw.length > 0
          ? (JSON.parse(existingRaw) as PartialPaymentEntry[])
          : [];

      const ratio = ratioInput != null
        ? ratioInput
        : baseAmount > 0 && amount != null
          ? amount / baseAmount
          : 0;
      const computedAmount = amount != null
        ? amount
        : baseAmount > 0 && ratioInput != null
          ? Math.round(baseAmount * ratioInput)
          : 0;

      entry = {
        id: "pp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        collectedAt,
        amount: computedAmount,
        ratio,
        memo,
        recordedBy: actor.userId,
        recordedAt: new Date().toISOString(),
      };

      const next = [...existing, entry];
      updatedTotalAmount = next.reduce((acc, item) => acc + Number(item.amount ?? 0), 0);
      updatedTotalRatio = baseAmount > 0
        ? Math.round((updatedTotalAmount / baseAmount) * 1000) / 1000
        : next.reduce((acc, item) => acc + Number(item.ratio ?? 0), 0);

      const isCollected = baseAmount > 0
        ? updatedTotalAmount >= baseAmount - 1
        : updatedTotalRatio >= 1;
      const now = new Date().toISOString();
      await db.run(
        `UPDATE contract_payment_milestones
         SET partial_payments_json = $1::jsonb,
             collected_amount = $2,
             collection_ratio = $3,
             payment_collected = $4,
             payment_collected_at = COALESCE(payment_collected_at, $5),
             updated_at = $6
         WHERE milestone_id = $7 AND contract_id = $8`,
        [
          JSON.stringify(next),
          updatedTotalAmount,
          updatedTotalRatio,
          isCollected ? 1 : 0,
          collectedAt,
          now,
          milestoneId,
          contractId,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        after: { partialPayment: entry, totalAmount: updatedTotalAmount, totalRatio: updatedTotalRatio },
      });
    });

    return NextResponse.json({
      entry,
      totalAmount: updatedTotalAmount,
      totalRatio: updatedTotalRatio,
      baseAmount,
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
