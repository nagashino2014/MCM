import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { buildInvoiceFileName } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; milestoneId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, milestoneId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
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
    if (body.settlementAmount !== undefined) pushSet("settlement_amount", toNullableNumber(body.settlementAmount));
    // 어음 수금 상세(마이그 200) — 만기일·대출실행일은 수금 자동대조의 날짜 매칭 근거가 된다.
    if (body.noteBank !== undefined) pushSet("note_bank", String(body.noteBank ?? "").trim() || null);
    if (body.noteIssuedDate !== undefined) pushSet("note_issued_date", body.noteIssuedDate || null);
    if (body.noteMaturityDate !== undefined) pushSet("note_maturity_date", body.noteMaturityDate || null);
    if (body.noteFee !== undefined) pushSet("note_fee", toNullableNumber(body.noteFee));
    if (body.noteLoanInterestRate !== undefined) pushSet("note_loan_interest_rate", toNullableNumber(body.noteLoanInterestRate));
    if (body.noteLoanInterestAmount !== undefined) pushSet("note_loan_interest_amount", toNullableNumber(body.noteLoanInterestAmount));
    if (body.noteLoanExecutedDate !== undefined) pushSet("note_loan_executed_date", body.noteLoanExecutedDate || null);
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
          "SELECT milestone_id, invoice_issued_at, invoice_requested_at, invoice_requested_by FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
          [milestoneId, contractId]
        )
      );
      if (exists.length === 0) throw new Error("단계를 찾을 수 없습니다.");
      await db.run(sql, values);

      // 발행 요청(H10) 상태였던 단계를 발행 완료 처리하면 요청자에게 회신 알림을 남긴다.
      // (요청 상태는 invoice_issued=1 이 되면 조회 조건상 자동 해소되므로 컬럼은 그대로 둔다.)
      if (body.invoiceIssued && exists[0]?.invoice_requested_at && exists[0]?.invoice_requested_by) {
        const meta = rowsToObjects(
          await db.exec(
            `SELECT c.contract_title, f.company_name AS facility_name,
                    m.stage_label
               FROM contract_payment_milestones m
               JOIN contracts c ON c.contract_id = m.contract_id
               LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
              WHERE m.milestone_id = $1 AND m.contract_id = $2`,
            [milestoneId, contractId]
          )
        )[0];
        const contractTitle = String(meta?.contract_title ?? "");
        const facilityName = String(meta?.facility_name ?? "");
        const stageLabel = String(meta?.stage_label ?? "");
        await db.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info', 'billing', 'invoice-issued', $1, $2, $3::jsonb, $4)`,
          [
            `세금계산서 발행 완료 · ${contractTitle || facilityName}`,
            `요청하신 "${stageLabel}" 단계 세금계산서가 발행되었습니다.`,
            JSON.stringify({
              contractId,
              milestoneId,
              contractTitle,
              facilityName,
              stageLabel,
              requestedBy: String(exists[0].invoice_requested_by),
              invoiceIssuedAt: body.invoiceIssuedAt || null,
            }),
            new Date().toISOString(),
          ]
        );
      }

      // 단계명(stage_label) 변경 시, 이 단계에 연결된 세금계산서의 표시명도
      // 새 단계명으로 재생성한다. 표시명은 (발행일)계약명 단계명 세금계산서.pdf 규칙.
      // (실제 저장 경로 storage_key 는 그대로 두고 display_name 만 갱신 — 목록/다운로드명 모두 여기서 나온다.)
      if (body.stageLabel !== undefined) {
        const invoiceDocs = rowsToObjects(
          await db.exec(
            `SELECT document_id FROM contract_documents
              WHERE contract_id = $1 AND milestone_id = $2 AND document_type = 'tax_invoice'`,
            [contractId, milestoneId]
          )
        );
        if (invoiceDocs.length > 0) {
          const newStage = String(body.stageLabel ?? "").trim() || null;
          const contractTitle = String(
            rowsToObjects(
              await db.exec("SELECT contract_title FROM contracts WHERE contract_id = $1", [contractId])
            )[0]?.contract_title ?? ""
          ).trim();
          // 발행일은 인보이스 레코드 우선, 없으면 단계의 invoice_issued_at 사용
          const invoiceRows = rowsToObjects(
            await db.exec(
              `SELECT issue_date FROM contract_invoices
                WHERE contract_id = $1 AND milestone_id = $2
                ORDER BY created_at DESC LIMIT 1`,
              [contractId, milestoneId]
            )
          );
          const issueDate =
            String(invoiceRows[0]?.issue_date ?? "").slice(0, 10) ||
            String(exists[0]?.invoice_issued_at ?? "").slice(0, 10);
          const newDisplayName = buildInvoiceFileName(issueDate, contractTitle, newStage);
          await db.run(
            `UPDATE contract_documents
               SET display_name = $1, updated_at = $2
              WHERE contract_id = $3 AND milestone_id = $4 AND document_type = 'tax_invoice'`,
            [newDisplayName, new Date().toISOString(), contractId, milestoneId]
          );
        }
      }

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
    const { contractId, milestoneId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
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
