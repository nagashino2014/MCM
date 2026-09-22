import type { PgDatabase } from "@/lib/db";

/** Settlement/CMS and disposition edits acquire this before their row reads/writes.
 * They never acquire accounting/payroll advisory locks. Journal regeneration
 * acquires accounting then expense; payroll reads do not acquire expense. */
export async function lockExpenseSettlement(db: PgDatabase): Promise<void> {
  await db.exec("SELECT pg_advisory_xact_lock(724303, 1)");
}
