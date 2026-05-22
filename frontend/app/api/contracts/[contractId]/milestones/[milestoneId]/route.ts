import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; milestoneId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId, milestoneId } = await ctx.params;
    const body = await req.json();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    const pushSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (body.stageLabel !== undefined) pushSet("stage_label", String(body.stageLabel ?? "").trim() || null);
    if (body.stageOrder !== undefined) pushSet("stage_order", toNumberOrZero(body.stageOrder));
    if (body.amount !== undefined) pushSet("amount", toNullableNumber(body.amount));
    if (body.amountRatio !== undefined) pushSet("amount_ratio", toNullableNumber(body.amountRatio));
    if (body.paymentTerms !== undefined) pushSet("payment_terms", body.paymentTerms ? String(body.paymentTerms) : null);
    if (body.invoiceIssued !== undefined) pushSet("invoice_issued", body.invoiceIssued ? 1 : 0);
    if (body.invoiceIssuedAt !== undefined) pushSet("invoice_issued_at", body.invoiceIssuedAt || null);
    if (body.invoiceAmount !== undefined) pushSet("invoice_amount", toNullableNumber(body.invoiceAmount));
    if (body.paymentCollected !== undefined) pushSet("payment_collected", body.paymentCollected ? 1 : 0);
    if (body.paymentCollectedAt !== undefined) pushSet("payment_collected_at", body.paymentCollectedAt || null);
    if (body.collectionRatio !== undefined) pushSet("collection_ratio", toNullableNumber(body.collectionRatio));
    if (body.collectedAmount !== undefined) pushSet("collected_amount", toNullableNumber(body.collectedAmount));
    if (body.partialPaymentMemo !== undefined) {
      const collectedAt = String(body.paymentCollectedAt ?? "").trim();
      const amount = toNullableNumber(body.collectedAmount);
      const ratio = toNullableNumber(body.collectionRatio);
      const memo = String(body.partialPaymentMemo ?? "").trim();
      setClauses.push(`partial_payments_json = $${values.length + 1}::jsonb`);
      values.push(
        collectedAt || amount != null || memo
          ? JSON.stringify([
              {
                id: "manual_edit",
                collectedAt: collectedAt || null,
                amount: amount ?? 0,
                ratio: ratio ?? 0,
                memo: memo || null,
                recordedBy: actor.userId,
                recordedAt: new Date().toISOString(),
              },
            ])
          : null
      );
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }
    pushSet("updated_at", new Date().toISOString());
    values.push(milestoneId, contractId);
    const sql = `UPDATE contract_payment_milestones SET ${setClauses.join(", ")} WHERE milestone_id = $${values.length - 1} AND contract_id = $${values.length}`;

    await withDbWrite(async (db) => {
      const exists = rowsToObjects(
        await db.exec(
          "SELECT milestone_id FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
          [milestoneId, contractId]
        )
      );
      if (exists.length === 0) throw new Error("단계를 찾을 수 없습니다.");
      await db.run(sql, values);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        after: body,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId, milestoneId } = await ctx.params;
    await withDbWrite(async (db) => {
      const exists = rowsToObjects(
        await db.exec(
          "SELECT milestone_id FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
          [milestoneId, contractId]
        )
      );
      if (exists.length === 0) throw new Error("단계를 찾을 수 없습니다.");
      await db.run("DELETE FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2", [milestoneId, contractId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        before: { contractId },
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNumberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
