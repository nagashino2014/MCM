import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const newMilestoneId = () => "mil_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = await req.json();
    const stageLabel = String(body.stageLabel ?? "").trim();
    if (!stageLabel) return NextResponse.json({ error: "단계명이 필요합니다." }, { status: 400 });
    const stageOrderInput = Number(body.stageOrder);
    const amount = toNullableNumber(body.amount);
    const paymentTerms = body.paymentTerms != null ? String(body.paymentTerms).trim() || null : null;
    const milestoneId = newMilestoneId();
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const contractCheck = rowsToObjects(
        await db.exec("SELECT contract_id FROM contracts WHERE contract_id = $1", [contractId])
      );
      if (contractCheck.length === 0) throw new Error("계약을 찾을 수 없습니다.");

      let stageOrder = Number.isFinite(stageOrderInput) ? stageOrderInput : 0;
      if (!Number.isFinite(stageOrderInput)) {
        const maxRow = rowsToObjects(
          await db.exec(
            "SELECT COALESCE(MAX(stage_order), 0) AS max_order FROM contract_payment_milestones WHERE contract_id = $1",
            [contractId]
          )
        );
        stageOrder = Number(maxRow[0]?.max_order ?? 0) + 1;
      }
      const stageKey = String(body.stageKey ?? `stage_${stageOrder}_${milestoneId.slice(-6)}`);

      await db.run(
        `INSERT INTO contract_payment_milestones
          (milestone_id, contract_id, stage_key, stage_label, stage_order, amount, amount_ratio,
           payment_terms, invoice_issued, payment_collected, collection_ratio,
           created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7,
           $8, 0, 0, $9,
           $10, $11)`,
        [
          milestoneId,
          contractId,
          stageKey,
          stageLabel,
          stageOrder,
          amount,
          toNullableNumber(body.amountRatio),
          paymentTerms,
          toNullableNumber(body.collectionRatio),
          now,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        after: { contractId, stageKey, stageLabel, stageOrder, amount, paymentTerms },
      });
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
