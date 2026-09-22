import { rowsToObjects, type PgDatabase } from "@/lib/db";

/** All journal/closing writers acquire this transaction lock before reading state.
 * One accounting domain avoids date-movement races and lock-order inversions across years.
 * It does not lock source collection or replace source-to-journal reconciliation. */
export async function lockAccountingWrite(db: PgDatabase): Promise<void> {
  await db.exec("SELECT pg_advisory_xact_lock(1296256326, 1)");
}

export function validateFiscalYear(year: number): void {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw Object.assign(new Error("회계연도가 올바르지 않습니다."), { status: 400 });
  }
}

export function validateAccountingRange(from: string, to: string): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number(value.slice(0, 4)) >= 1000
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) {
    throw Object.assign(new Error("기간(YYYY-MM-DD)이 올바르지 않습니다."), { status: 400 });
  }
}

/** Call after lockAccountingWrite, with the same transaction handle as the write. */
export async function assertAccountingYearsOpen(db: PgDatabase, years: number[]): Promise<void> {
  const unique = [...new Set(years)];
  for (const year of unique) validateFiscalYear(year);
  if (!unique.length) return;
  const closed = rowsToObjects(await db.exec(
    "SELECT fiscal_year FROM fiscal_closings WHERE status = 'closed' AND fiscal_year = ANY($1::integer[]) ORDER BY fiscal_year LIMIT 1",
    [unique],
  ));
  if (closed.length) {
    throw Object.assign(new Error(`${closed[0].fiscal_year}년은 결산 마감되어 변경할 수 없습니다. 사유를 기록하고 마감을 해제한 뒤 다시 진행하세요.`), { status: 409 });
  }
}

export async function assertAccountingDatesOpen(db: PgDatabase, dates: string[]): Promise<void> {
  await assertAccountingYearsOpen(db, dates.map((date) => Number(date.slice(0, 4))));
}

export async function assertAccountingRangeOpen(db: PgDatabase, from: string, to: string): Promise<void> {
  validateAccountingRange(from, to);
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  await assertAccountingYearsOpen(db, Array.from({ length: last - first + 1 }, (_, index) => first + index));
}

export async function assertJournalEntriesOpen(db: PgDatabase, entryIds: string[]): Promise<void> {
  const entries = rowsToObjects(await db.exec(
    "SELECT DISTINCT entry_date FROM journal_entries WHERE entry_id = ANY($1::text[])", [entryIds],
  ));
  await assertAccountingDatesOpen(db, entries.map((entry) => String(entry.entry_date)));
}
