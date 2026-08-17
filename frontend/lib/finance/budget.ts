// 계정과목(경비 카테고리)별 연간 예산 (블루프린트 P6-C) — 1차는 전사 예산(U1: 부서별은 후속).
// 집행액 = 전표(auto+confirmed) 기준 해당 계정의 연간 순차변 — 카드·지출결의·기타 출금이 모두 잡힌다.
// 기안 경고: 지출결의 draft 의 카테고리별 신청액(법인카드 행 제외 — 이미 카드 전표로 집행에 반영)과
//   예산·기집행을 비교해 사전검토(precheck) finding 을 만든다.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { loadCategories } from "@/lib/barobill/classify";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

export interface BudgetLine {
  budgetId: string;
  year: number;
  categoryKey: string;
  categoryLabel: string;
  accountCode: string | null;
  amount: number;
  spent: number;
  remaining: number;
  memo: string | null;
}

/** 연도 예산 목록 + 전표 기준 집행액. */
export async function listBudgets(year: number): Promise<BudgetLine[]> {
  const db = await getDb();
  const categories = await loadCategories();
  const catRows = rowsToObjects(await db.exec(`SELECT category_key, account_code FROM expense_categories`));
  const accByKey = new Map(catRows.map((r) => [String(r.category_key), r.account_code ? String(r.account_code) : null]));
  const labelByKey = new Map(categories.map((c) => [c.categoryKey, c.label]));

  const budgets = rowsToObjects(
    await db.exec(`SELECT budget_id, category_key, amount, memo FROM budget_lines WHERE year = $1 AND org_unit_id IS NULL`, [year]),
  );
  const accountCodes = [...new Set(budgets.map((b) => accByKey.get(String(b.category_key))).filter(Boolean))] as string[];
  const spentByAccount = new Map<string, number>();
  if (accountCodes.length) {
    const spentRows = rowsToObjects(
      await db.exec(
        `SELECT l.account_code, COALESCE(SUM(l.debit - l.credit), 0) AS spent
           FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
          WHERE e.status IN ('auto', 'confirmed') AND substr(e.entry_date, 1, 4) = $1
            AND l.account_code = ANY($2::text[])
          GROUP BY l.account_code`,
        [String(year), accountCodes],
      ),
    );
    for (const r of spentRows) spentByAccount.set(String(r.account_code), Number(r.spent || 0));
  }

  return budgets
    .map((b) => {
      const categoryKey = String(b.category_key);
      const accountCode = accByKey.get(categoryKey) ?? null;
      const amount = Number(b.amount || 0);
      const spent = accountCode ? spentByAccount.get(accountCode) ?? 0 : 0;
      return {
        budgetId: String(b.budget_id),
        year,
        categoryKey,
        categoryLabel: labelByKey.get(categoryKey) ?? categoryKey,
        accountCode,
        amount,
        spent,
        remaining: amount - spent,
        memo: b.memo ? String(b.memo) : null,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export async function saveBudgetLine(input: { year: number; categoryKey: string; amount: number; memo?: string | null }): Promise<string> {
  const budgetId = hashId("bg", `${input.year}::${input.categoryKey}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO budget_lines (budget_id, year, org_unit_id, category_key, amount, memo, created_at)
       VALUES ($1, $2, NULL, $3, $4, NULLIF($5, ''), $6)
       ON CONFLICT (year, org_unit_id, category_key) DO UPDATE SET
         amount = EXCLUDED.amount, memo = EXCLUDED.memo, updated_at = $6`,
      [budgetId, input.year, input.categoryKey, input.amount, input.memo ?? "", KST_NOW()],
    );
  });
  return budgetId;
}

export async function deleteBudgetLine(budgetId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM budget_lines WHERE budget_id = $1`, [budgetId]);
  });
}

// ── 기안 사전검토 (precheck budget_limit 규칙이 호출) ──

export interface BudgetCheckFinding {
  categoryLabel: string;
  budget: number;
  spent: number;
  requested: number;
  remainingAfter: number;
  over: boolean;
}

/**
 * 지출결의 draft 의 카테고리별 신청액 vs 연간 예산·기집행.
 * 예산이 등록된 카테고리만 평가한다(예산 없는 카테고리는 통제 대상 아님).
 */
export async function checkBudgetForExpenseValues(values: Record<string, unknown>, year: number): Promise<BudgetCheckFinding[]> {
  const categories = await loadCategories();
  const optionToKey = new Map<string, string>();
  for (const cat of categories) {
    for (const option of Object.values(cat.formOptionMap)) optionToKey.set(option, cat.categoryKey);
    optionToKey.set(cat.label, cat.categoryKey);
  }
  const tableRows = [
    ...(Array.isArray(values.expenses) ? (values.expenses as Record<string, unknown>[]) : []),
    ...(Array.isArray(values.trip_expenses) ? (values.trip_expenses as Record<string, unknown>[]) : []),
  ];
  const requestedByKey = new Map<string, number>();
  for (const row of tableRows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row._cardTxnId === "string" && row._cardTxnId) continue; // 카드 행 = 이미 집행(카드 전표) — 이중 방지
    const amount = Math.round(Number(String(row.amount ?? "").replace(/[^0-9.-]/g, "")) || 0);
    if (!amount) continue;
    const key = typeof row.category === "string" ? optionToKey.get(row.category) : undefined;
    if (!key) continue;
    requestedByKey.set(key, (requestedByKey.get(key) ?? 0) + amount);
  }
  if (!requestedByKey.size) return [];

  const budgets = await listBudgets(year);
  const findings: BudgetCheckFinding[] = [];
  for (const b of budgets) {
    const requested = requestedByKey.get(b.categoryKey);
    if (!requested) continue;
    const remainingAfter = b.amount - b.spent - requested;
    findings.push({
      categoryLabel: b.categoryLabel,
      budget: b.amount,
      spent: b.spent,
      requested,
      remainingAfter,
      over: remainingAfter < 0,
    });
  }
  return findings;
}
