import { createHash } from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { validateAccountingRange } from "./write-lock";

export const JOURNAL_SOURCE_KINDS = ["card", "bank_in", "bank_out", "tax_invoice", "hometax_invoice", "invoice_manual", "expense_doc", "income_doc", "depreciation", "payroll"] as const;
export type JournalSourceKind = typeof JOURNAL_SOURCE_KINDS[number];
export interface JournalSourceRef { sourceKind: string; sourceId: string }
export interface JournalSourceState { date: string | null; exists: boolean; actualKind?: string }
export const sourceKey = (ref: JournalSourceRef) => JSON.stringify([ref.sourceKind, ref.sourceId]);
export const isManagedJournalSource = (kind: string): kind is JournalSourceKind => (JOURNAL_SOURCE_KINDS as readonly string[]).includes(kind);
export function journalConflict(message: string, conflicts: unknown[] = []): Error & { status: number; conflicts: unknown[] } {
  return Object.assign(new Error(message), { status: 409, conflicts });
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
export function sourceFingerprint(ref: JournalSourceRef & { status?: string }, date: string, evidence: unknown) {
  // Learning a counter-account may turn pending into auto without source edits.
  // A machine exclusion disappearing is different: preserving it would hide a payable.
  const source = { version: 1, sourceKind: ref.sourceKind, sourceId: ref.sourceId, entryDate: date, generatedExclusion: ref.status === "excluded", evidence };
  return { source, hash: createHash("sha256").update(JSON.stringify(canonical(source))).digest("hex") };
}
export function sourceWon(value: unknown, source: string, field: string): number {
  const amount = value === null || value === undefined || value === "" ? 0 : Number(value);
  if (!Number.isSafeInteger(amount)) throw journalConflict(`${source}: ${field} 금액이 원 단위 안전한 정수가 아닙니다.`);
  return amount;
}
export function validateJournalDrafts(drafts: Array<JournalSourceRef & { entryDate: string; lines: Array<{accountCode: string; debit:number;credit:number}> }>, validAccounts: Set<string>): void {
  const keys = new Set<string>();
  for (const draft of drafts) {
    const key = sourceKey(draft);
    if (!draft.sourceId || !isManagedJournalSource(draft.sourceKind) || keys.has(key)) throw journalConflict("전표 원천 식별자가 비어 있거나 중복되었습니다.", [draft.sourceKind,draft.sourceId]);
    keys.add(key);
    try { validateAccountingRange(draft.entryDate,draft.entryDate); } catch { throw journalConflict(`${draft.sourceKind}/${draft.sourceId}: 원천 회계일자가 올바르지 않습니다.`); }
    let debit=0,credit=0;
    if(draft.lines.length<2)throw journalConflict(`${draft.sourceKind}/${draft.sourceId}: 분개 라인이 부족합니다.`);
    for(const line of draft.lines){
      if(!validAccounts.has(line.accountCode)||!Number.isSafeInteger(line.debit)||!Number.isSafeInteger(line.credit)||line.debit<0||line.credit<0||(line.debit>0&&line.credit>0))throw journalConflict(`${draft.sourceKind}/${draft.sourceId}: 계정 또는 차대 금액을 확인하세요.`);
      debit+=line.debit;credit+=line.credit;
    }
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit<=0||debit!==credit)throw journalConflict(`${draft.sourceKind}/${draft.sourceId}: 차변 ${debit}원과 대변 ${credit}원이 일치하지 않습니다. 기존 전표를 보존했습니다.`);
  }
}

/** Locate previous sources at their current date even when outside the requested range.
 * Status/cancellation is intentionally not filtered: disappearing drafts must be reconciled. */
export async function loadJournalSourceStates(db: PgDatabase, refs: JournalSourceRef[]): Promise<Map<string, JournalSourceState>> {
  const states = new Map<string, JournalSourceState>();
  for(const kind of JOURNAL_SOURCE_KINDS){
    const group=refs.filter(ref=>ref.sourceKind===kind);
    if(!group.length)continue;
    const ids=[...new Set(group.map(ref=>ref.sourceId))];
    let sql:string;
    switch(kind){
      case "card":sql="SELECT card_txn_id AS id, substr(approved_at,1,10) AS date FROM card_transactions WHERE card_txn_id=ANY($1::text[])";break;
      case "bank_in":case "bank_out":sql="SELECT txn_id AS id, substr(txn_at,1,10) AS date, 'bank_'||direction AS actual_kind FROM bank_transactions WHERE txn_id=ANY($1::text[])";break;
      case "tax_invoice":sql="SELECT invoice_id AS id, substr(write_date,1,10) AS date FROM tax_invoices WHERE invoice_id=ANY($1::text[])";break;
      case "hometax_invoice":sql="SELECT hti_id AS id, substr(write_date,1,10) AS date FROM hometax_tax_invoices WHERE hti_id=ANY($1::text[])";break;
      case "invoice_manual":sql="SELECT milestone_id AS id, substr(invoice_issued_at,1,10) AS date FROM contract_payment_milestones WHERE milestone_id=ANY($1::text[])";break;
      case "expense_doc":sql="SELECT doc_id AS id, substr(completed_at,1,10) AS date FROM approval_docs WHERE doc_id=ANY($1::text[])";break;
      case "income_doc":sql="SELECT entry_id AS id, substr(pay_date,1,10) AS date FROM income_payment_ledger WHERE entry_id=ANY($1::text[])";break;
      case "payroll":sql="SELECT ledger_id AS id, CASE WHEN pay_year BETWEEN 1000 AND 9999 AND pay_month BETWEEN 1 AND 12 THEN to_char(make_date(pay_year,pay_month,1)+interval '1 month - 1 day','YYYY-MM-DD') ELSE NULL END AS date FROM payroll_ledgers WHERE ledger_id=ANY($1::text[])";break;
      case "depreciation": {
        const assets=rowsToObjects(await db.exec("SELECT fa_id FROM fixed_assets WHERE fa_id=ANY($1::text[])",[ids.map(id=>id.slice(0,-8))]));
        const existing=new Set(assets.map(row=>String(row.fa_id)));
        for(const ref of group){const month=ref.sourceId.slice(-7);const date=/^\d{4}-\d{2}$/.test(month)?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10):null;states.set(sourceKey(ref),{exists:existing.has(ref.sourceId.slice(0,-8)),date});}
        continue;
      }
    }
    const current=new Map(rowsToObjects(await db.exec(sql,[ids])).map(row=>[String(row.id),row]));
    for(const ref of group){const row=current.get(ref.sourceId);states.set(sourceKey(ref),{exists:!!row,date:row?.date==null?null:String(row.date),...(row?.actual_kind?{actualKind:String(row.actual_kind)}:{})});}
  }
  return states;
}
