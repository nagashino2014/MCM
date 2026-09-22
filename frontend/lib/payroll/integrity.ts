import { createHash } from "node:crypto";
import { rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { lookupIncomeTax, NON_TAXABLE_ITEMS } from "@/lib/payroll/tax";

/** All payroll writers acquire this before row locks (also enforced by migration 222). */
export async function withPayrollWrite<T>(fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  return withDbWrite(async (db) => {
    await db.exec("SELECT pg_advisory_xact_lock(724301, 1)");
    return fn(db);
  });
}

export interface PayrollTaxReview {
  status: "pending" | "automatic" | "manual";
  reason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  basisHash?: string;
  basis?: unknown;
}

/** Includes explicit zero taxes as well as the inputs that can make a prior review stale. */
export async function entryTaxBasis(db: PgDatabase, entryId: string) {
  const meta = rowsToObjects(await db.exec(
    `SELECT e.employee_id, lg.pay_year, lg.pay_month,
            COALESCE(tp.withholding_rate,100) AS withholding_rate,
            COALESCE(tp.dependents,1) AS dependents, COALESCE(tp.child_deduction,0) AS children
       FROM payroll_entries e JOIN payroll_ledgers lg USING(ledger_id)
       LEFT JOIN payroll_tax_profiles tp ON tp.employee_id=e.employee_id WHERE e.entry_id=$1`, [entryId]
  ))[0];
  const lines = rowsToObjects(await db.exec(
    `SELECT l.item_id, d.kind, l.amount FROM payroll_entry_lines l
       JOIN payroll_item_defs d USING(item_id)
      WHERE l.entry_id=$1 AND (d.kind='pay' OR l.item_id IN ('income-tax','local-tax'))
      ORDER BY l.item_id, l.line_id`, [entryId]
  )).map((r) => ({ itemId: String(r.item_id), kind: String(r.kind), amount: Number(r.amount) }));
  const taxable = lines.filter((l) => l.kind === "pay" && !(NON_TAXABLE_ITEMS as readonly string[]).includes(l.itemId)).reduce((sum,l) => sum+l.amount,0);
  const tableVersion = rowsToObjects(await db.exec("SELECT max(year_version) AS version FROM income_tax_brackets"))[0]?.version ?? null;
  const calculation = taxable > 0 ? await lookupIncomeTax(taxable,Number(meta.dependents),Number(meta.children),Number(meta.withholding_rate),db) : null;
  const basis = { meta, lines, tableVersion, calculation };
  return { basis, basisHash: createHash("sha256").update(JSON.stringify(basis)).digest("hex") };
}

export async function markEntryTaxReview(db: PgDatabase, entryId: string, review: PayrollTaxReview) {
  const basis = await entryTaxBasis(db, entryId);
  const saved = { ...review, ...basis };
  await db.exec("UPDATE payroll_entries SET tax_review=$2::jsonb WHERE entry_id=$1", [entryId, JSON.stringify(saved)]);
  return saved;
}
