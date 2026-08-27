import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { deleteContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; invoiceId: string }>;
}

/**
 * 세금계산서 파일 삭제(2026-08-26 사용자 요청) — 계약 상세의 '세금계산서 파일' 목록에서
 * 개별 항목을 지운다. 단계 삭제 시 함께 지워지지만, 이미 단계가 사라져 고아로 남은 파일이나
 * 잘못 올린 파일을 손으로 정리할 수단이 필요하다.
 * 바로빌 발행 원장(tax_invoices)은 국세청에 나간 사실이라 지우지 않고 계약 연결만 끊는다
 * (보관 PDF 백필이 이 건을 다시 만들지 않게 하는 효과도 있다).
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, invoiceId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    let storageKey = "";
    let displayName = "";
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT i.invoice_id, i.document_id, i.milestone_id, d.storage_key, d.display_name
             FROM contract_invoices i
             LEFT JOIN contract_documents d ON d.document_id = i.document_id
            WHERE i.invoice_id = $1 AND i.contract_id = $2`,
          [invoiceId, contractId]
        )
      );
      if (!rows.length) throw new Error("세금계산서 파일을 찾을 수 없습니다.");
      const row = rows[0];
      storageKey = row.storage_key != null ? String(row.storage_key) : "";
      displayName = row.display_name != null ? String(row.display_name) : "";
      const documentId = row.document_id != null ? String(row.document_id) : null;
      const milestoneId = row.milestone_id != null ? String(row.milestone_id) : null;

      await db.run(`DELETE FROM contract_invoices WHERE invoice_id = $1`, [invoiceId]);
      if (documentId) {
        await db.run(`DELETE FROM contract_documents WHERE document_id = $1`, [documentId]);
      }
      if (milestoneId) {
        await db.run(
          `UPDATE tax_invoices SET contract_id = NULL, updated_at = $3 WHERE contract_id = $1 AND milestone_id = $2`,
          [contractId, milestoneId, new Date().toISOString()]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_update",
        targetTable: "contract_invoices",
        targetId: invoiceId,
        before: { contractId, documentId, displayName },
        after: { deleted: true },
      });
    });
    // 스토리지 정리는 트랜잭션 밖 — 실패해도 DB 정합에는 영향 없다(고아 객체만 남음).
    if (storageKey) {
      await deleteContractDocument(storageKey).catch((err) =>
        console.warn("[invoice] 계산서 파일 삭제 실패:", storageKey, (err as Error).message)
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
