import { withContractTransactionWrite } from "@/lib/finance/contract-link-lock";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { deleteContractDocument } from "@/lib/storage/contract-document-storage";
import { getTaxInvoiceState } from "@/lib/barobill/tax-invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; milestoneId: string }>;
}

/**
 * 계산서 발행 취소 표시(2026-11-25 사용자 요청) — 바로빌·홈택스에서 이미 취소한 계산서를
 * 계약 단계에 반영한다. 바로빌·국세청에는 아무 요청도 보내지 않는 기록 정정이다.
 *
 * - 단계: 발행 여부·발행일·발행금액을 비운다(미발행으로 되돌림). 수금 기록은 그대로 둔다.
 * - 세금계산서 PDF: 이 단계에 등록된 계산서 파일(contract_documents·contract_invoices)을 지운다.
 * - 바로빌 발행 원장(tax_invoices): 이 단계의 활성 발행분에 canceled_at 을 남긴다(행은 지우지 않음).
 *   취소된 건은 매출 분개 초안·보관 PDF 백필·발행 창 중복 경고에서 빠진다.
 *   ⚠수정세금계산서로 이미 상쇄된 원본(같은 단계에 그 원본을 가리키는 활성 수정분이 있음)은
 *   원본·수정분 모두 그대로 둔다 — 원본만 취소로 바꾸면 음수 수정분만 남아 매출이 마이너스가 된다.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, milestoneId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = String(body.reason ?? "").trim().slice(0, 500) || null;

    // 바로빌 실제 상태를 먼저 읽어 둔다(네트워크 호출이라 트랜잭션 밖). 실패해도 취소 표시는 진행한다.
    const liveStates = new Map<string, number>();
    {
      const db = await getDb();
      const active = rowsToObjects(
        await db.exec(
          `SELECT invoice_id, mgt_key FROM tax_invoices
            WHERE contract_id = $1 AND milestone_id = $2 AND canceled_at IS NULL AND modify_code IS NULL`,
          [contractId, milestoneId]
        )
      );
      for (const row of active) {
        try {
          const state = await getTaxInvoiceState(String(row.mgt_key));
          liveStates.set(String(row.invoice_id), state.barobillState);
        } catch (err) {
          console.warn("[invoice-cancel] 바로빌 상태 조회 실패:", String(row.invoice_id), (err as Error).message);
        }
      }
    }

    let removedKeys: string[] = [];
    let canceledInvoiceIds: string[] = [];
    let offsetInvoiceIds: string[] = [];
    await withContractTransactionWrite(contractId, milestoneId, async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT milestone_id, stage_label, invoice_issued, invoice_issued_at, invoice_amount
             FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2`,
          [milestoneId, contractId]
        )
      );
      if (!rows.length) throw Object.assign(new Error("단계를 찾을 수 없습니다."), { status: 404 });
      const before = rows[0];
      if (Number(before.invoice_issued ?? 0) !== 1 && !before.invoice_issued_at) {
        throw Object.assign(new Error("이 단계에는 계산서 발행 기록이 없습니다."), { status: 400 });
      }
      const now = new Date().toISOString();

      // 1) 계산서 PDF — 단계 삭제(DELETE)와 같은 방식으로 문서·발행 기록 행을 지운다.
      const docs = rowsToObjects(
        await db.exec(
          `SELECT document_id, storage_key FROM contract_documents
            WHERE contract_id = $1 AND milestone_id = $2 AND document_type = 'tax_invoice'`,
          [contractId, milestoneId]
        )
      );
      removedKeys = docs.map((d) => String(d.storage_key ?? "")).filter(Boolean);
      await db.run(`DELETE FROM contract_invoices WHERE contract_id = $1 AND milestone_id = $2`, [contractId, milestoneId]);
      for (const d of docs) {
        await db.run(`DELETE FROM contract_invoices WHERE document_id = $1`, [String(d.document_id)]);
        await db.run(`DELETE FROM contract_documents WHERE document_id = $1`, [String(d.document_id)]);
      }

      // 2) 바로빌 발행 원장 — 수정분으로 상쇄되지 않은 활성 원본만 취소로 표시한다.
      const active = rowsToObjects(
        await db.exec(
          `SELECT invoice_id, modify_code, original_invoice_id FROM tax_invoices
            WHERE contract_id = $1 AND milestone_id = $2 AND canceled_at IS NULL`,
          [contractId, milestoneId]
        )
      );
      const offsetOrigins = new Set(
        active.filter((r) => r.modify_code != null && r.original_invoice_id).map((r) => String(r.original_invoice_id))
      );
      offsetInvoiceIds = active.filter((r) => r.modify_code != null || offsetOrigins.has(String(r.invoice_id))).map((r) => String(r.invoice_id));
      canceledInvoiceIds = active
        .filter((r) => r.modify_code == null && !offsetOrigins.has(String(r.invoice_id)))
        .map((r) => String(r.invoice_id));
      for (const invoiceId of canceledInvoiceIds) {
        const live = liveStates.get(invoiceId);
        await db.run(
          `UPDATE tax_invoices
              SET canceled_at = $2, barobill_state = COALESCE($3, barobill_state), updated_at = $2
            WHERE invoice_id = $1`,
          [invoiceId, now, live ?? null]
        );
      }

      // 3) 단계 — 미발행으로 되돌린다. 발행 요청(H10)이 있던 단계는 요청 대기로 다시 보이는데,
      //    다시 발행해야 하는 단계라 그대로 둔다.
      await db.run(
        `UPDATE contract_payment_milestones
            SET invoice_issued = 0, invoice_issued_at = NULL, invoice_amount = NULL, updated_at = $3
          WHERE milestone_id = $1 AND contract_id = $2`,
        [milestoneId, contractId, now]
      );

      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: milestoneId,
        before: {
          contractId,
          stageLabel: before.stage_label,
          invoiceIssuedAt: before.invoice_issued_at,
          invoiceAmount: before.invoice_amount,
        },
        after: {
          invoiceCanceled: true,
          reason,
          removedInvoiceDocuments: docs.length,
          canceledTaxInvoiceIds: canceledInvoiceIds,
          keptOffsetTaxInvoiceIds: offsetInvoiceIds,
        },
      });
    });

    // 스토리지 정리는 트랜잭션 밖에서 — 실패해도 DB 정합에는 영향이 없다(고아 객체만 남음).
    for (const key of removedKeys) {
      await deleteContractDocument(key).catch((err) =>
        console.warn("[invoice-cancel] 계산서 파일 삭제 실패:", key, (err as Error).message)
      );
    }
    return NextResponse.json({
      ok: true,
      removedInvoiceDocuments: removedKeys.length,
      canceledTaxInvoices: canceledInvoiceIds.length,
      keptOffsetTaxInvoices: offsetInvoiceIds.length,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
