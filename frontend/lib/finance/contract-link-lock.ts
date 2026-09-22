import { rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { loadTransactionLinkState } from "./transaction-links";
import { journalConflict } from "./journal-source";
import { lockAccountingWrite } from "./write-lock";

/** The old contract receipt totals use a different amount basis. They must not
 * consume the same receivable after an explicit gross allocation is recorded. */
export async function assertContractTransactionLinksMutable(db: PgDatabase, contractId: string, milestoneId?: string | null): Promise<void> {
  const milestones = rowsToObjects(await db.exec("SELECT milestone_id FROM contract_payment_milestones WHERE contract_id=$1 AND ($2::text IS NULL OR milestone_id=$2)", [contractId, milestoneId ?? null]));
  if (!milestones.length) return;
  const ids = new Set(milestones.map(row => String(row.milestone_id)));
  const apps = rowsToObjects(await db.exec("SELECT invoice_id,nts_send_key FROM tax_invoices WHERE milestone_id=ANY($1::text[])", [[...ids]]));
  const appIds = new Set(apps.map(row => String(row.invoice_id)));
  const invoiceKeys = new Set(apps.filter(row => String(row.nts_send_key ?? "").trim()).map(row => `invoice:${String(row.nts_send_key).trim()}`));
  const state = await loadTransactionLinkState(db);
  const relatedManual = state.links.filter(link => link.left.kind === "manual_invoice" && ids.has(link.left.id));
  for (const link of relatedManual) invoiceKeys.add(link.rightSnapshot.canonicalKey);
  const blocked = state.links.some(link => link.state === "active" && (
    (link.left.kind === "manual_invoice" && ids.has(link.left.id))
    || (link.right.kind === "tax_invoice" && appIds.has(link.right.id))
    || invoiceKeys.has(link.rightSnapshot.canonicalKey)));
  if (blocked) throw journalConflict("거래 연결에서 계산서·수금을 관리하는 계약 단계입니다. 거래 연결의 배부와 증빙을 먼저 검토·취소한 뒤 기존 계약 수금·발행 기록을 변경하세요.");
}

export async function withContractTransactionWrite<T>(contractId: string, milestoneId: string | null | undefined, callback: (db: PgDatabase) => Promise<T>, options: { protect?: boolean } = {}): Promise<T> {
  return withDbWrite(async db => {
    await lockAccountingWrite(db);
    if (options.protect !== false) await assertContractTransactionLinksMutable(db, contractId, milestoneId);
    return callback(db);
  }, { accountingSnapshot: true });
}
