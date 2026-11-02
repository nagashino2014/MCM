import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { checkDateFields } from "@/lib/contracts/date-field";
import { recalcPurchaseContractAmount } from "@/lib/contracts/purchase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string; milestoneId: string }>;
}

/**
 * 단계 수정(331) — 단계명·금액·지급조건과 세금계산서 수취(invoiceReceived*)·대금 지급(paymentPaid*)·
 * 홈택스 매입계산서 연결(hometaxHtiId, null 이면 해제)을 부분 수정한다. 매출 milestone PATCH 패턴.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId, milestoneId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const body = await req.json();
    const dateError = checkDateFields({ "계산서 수취일": body.invoiceReceivedAt, 지급일: body.paymentPaidAt });
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const setClauses: string[] = [];
    const values: unknown[] = [];
    const pushSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };
    if (body.stageLabel !== undefined) {
      const label = String(body.stageLabel ?? "").trim();
      if (!label) return NextResponse.json({ error: "단계명이 필요합니다." }, { status: 400 });
      pushSet("stage_label", label);
    }
    if (body.amount !== undefined) pushSet("amount", toNullableNumber(body.amount));
    if (body.amountRatio !== undefined) pushSet("amount_ratio", toNullableNumber(body.amountRatio));
    if (body.paymentTerms !== undefined) pushSet("payment_terms", body.paymentTerms ? String(body.paymentTerms) : null);
    if (body.invoiceReceived !== undefined) pushSet("invoice_received", body.invoiceReceived ? 1 : 0);
    if (body.invoiceReceivedAt !== undefined) pushSet("invoice_received_at", body.invoiceReceivedAt || null);
    if (body.invoiceAmount !== undefined) pushSet("invoice_amount", toNullableNumber(body.invoiceAmount));
    if (body.hometaxHtiId !== undefined) pushSet("hometax_hti_id", body.hometaxHtiId ? String(body.hometaxHtiId) : null);
    if (body.paymentPaid !== undefined) pushSet("payment_paid", body.paymentPaid ? 1 : 0);
    if (body.paymentPaidAt !== undefined) pushSet("payment_paid_at", body.paymentPaidAt || null);
    if (body.paidAmount !== undefined) pushSet("paid_amount", toNullableNumber(body.paidAmount));
    if (body.memo !== undefined) pushSet("memo", String(body.memo ?? "").trim() || null);
    if (setClauses.length === 0) return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    const now = new Date().toISOString();
    pushSet("updated_at", now);
    values.push(milestoneId, purchaseContractId);
    const sql = `UPDATE purchase_contract_milestones SET ${setClauses.join(", ")} WHERE milestone_id = $${values.length - 1} AND purchase_contract_id = $${values.length}`;

    await withDbWrite(async (db) => {
      const exists = rowsToObjects(
        await db.exec("SELECT * FROM purchase_contract_milestones WHERE milestone_id = $1 AND purchase_contract_id = $2", [
          milestoneId,
          purchaseContractId,
        ])
      );
      if (exists.length === 0) throw Object.assign(new Error("단계를 찾을 수 없습니다."), { status: 404 });
      if (body.hometaxHtiId) {
        // 연결 대상은 매입(direction='purchase') 계산서여야 하고, 다른 단계에 이미 연결된 건은 막는다.
        const hti = rowsToObjects(
          await db.exec(
            `SELECT h.hti_id, h.direction, m.milestone_id AS linked_milestone_id
               FROM hometax_tax_invoices h
               LEFT JOIN purchase_contract_milestones m ON m.hometax_hti_id = h.hti_id AND m.milestone_id <> $2
              WHERE h.hti_id = $1`,
            [String(body.hometaxHtiId), milestoneId]
          )
        );
        if (hti.length === 0) throw Object.assign(new Error("홈택스 매입 계산서를 찾을 수 없습니다."), { status: 404 });
        if (String(hti[0].direction) !== "purchase") throw Object.assign(new Error("매입 계산서만 연결할 수 있습니다."), { status: 400 });
        if (hti[0].linked_milestone_id) throw Object.assign(new Error("이미 다른 단계에 연결된 계산서입니다."), { status: 409 });
      }
      await db.run(sql, values);
      if (body.amount !== undefined) await recalcPurchaseContractAmount(db, purchaseContractId, now);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_payment_update",
        targetTable: "purchase_contract_milestones",
        targetId: milestoneId,
        before: exists[0],
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
    const { purchaseContractId, milestoneId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const exists = rowsToObjects(
        await db.exec("SELECT * FROM purchase_contract_milestones WHERE milestone_id = $1 AND purchase_contract_id = $2", [
          milestoneId,
          purchaseContractId,
        ])
      );
      if (exists.length === 0) throw Object.assign(new Error("단계를 찾을 수 없습니다."), { status: 404 });
      await db.run("DELETE FROM purchase_contract_milestones WHERE milestone_id = $1 AND purchase_contract_id = $2", [
        milestoneId,
        purchaseContractId,
      ]);
      await recalcPurchaseContractAmount(db, purchaseContractId, now);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_payment_update",
        targetTable: "purchase_contract_milestones",
        targetId: milestoneId,
        before: exists[0],
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
