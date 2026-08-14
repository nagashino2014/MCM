import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/**
 * 급여대장 서버 쿼리 (PL-P1, docs/payroll-labor-contract-blueprint.md §4-1·§4-3)
 * - 데이터는 scripts/payroll_import 로 적재된 payroll_* 테이블(2016~2026 전수 + 앱 생성분).
 * - 그리드는 플랫(직원 1행 — 원본 3단 구조는 열=항목으로 펼침), 값 있는 항목 열만 노출.
 * - 원본 합계(pay_total 등)는 검증 기준값이므로 라인 재합산으로 대체하지 않고 그대로 표시한다.
 */

export interface PayrollItemDef {
  itemId: string;
  name: string;
  kind: "pay" | "deduction";
  aliases: string[];
  inOrdinaryWage: boolean;
  displayOrder: number;
  isActive: boolean;
  usageCount?: number;
}

export interface PayrollLedgerMonth {
  ledgerId: string;
  payYear: number;
  payMonth: number;
  ledgerKind: string;
  title: string | null;
  source: string;
  sourceFile: string | null;
  status: string;
  headcount: number;
  payTotal: number;
  netTotal: number;
}

export interface PayrollEntryRow {
  entryId: string;
  employeeId: string | null;
  empNo: string | null;
  name: string;
  deptName: string | null;
  positionName: string | null;
  hiredAt: string | null;
  resignedAt: string | null;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  note: string | null;
  lines: Record<string, number>;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toItemDef(row: Record<string, unknown>): PayrollItemDef {
  return {
    itemId: String(row.item_id),
    name: String(row.name),
    kind: row.kind === "deduction" ? "deduction" : "pay",
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    inOrdinaryWage: toNum(row.in_ordinary_wage) === 1,
    displayOrder: toNum(row.display_order),
    isActive: toNum(row.is_active) === 1,
    usageCount: row.usage_count === undefined ? undefined : toNum(row.usage_count),
  };
}

/** 연·월·종류별 대장 목록(셀렉터·요약) */
export async function listLedgerMonths(): Promise<PayrollLedgerMonth[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.ledger_id, l.pay_year, l.pay_month, l.ledger_kind, l.title, l.source, l.source_file, l.status,
              count(e.entry_id) AS headcount,
              COALESCE(sum(e.pay_total), 0) AS pay_total,
              COALESCE(sum(e.net_pay), 0) AS net_total
         FROM payroll_ledgers l
         LEFT JOIN payroll_entries e ON e.ledger_id = l.ledger_id
        GROUP BY l.ledger_id
        ORDER BY l.pay_year DESC, l.pay_month DESC, l.ledger_kind`
    )
  );
  return rows.map((r) => ({
    ledgerId: String(r.ledger_id),
    payYear: toNum(r.pay_year),
    payMonth: toNum(r.pay_month),
    ledgerKind: String(r.ledger_kind),
    title: r.title ? String(r.title) : null,
    source: String(r.source),
    sourceFile: r.source_file ? String(r.source_file) : null,
    status: String(r.status),
    headcount: toNum(r.headcount),
    payTotal: toNum(r.pay_total),
    netTotal: toNum(r.net_total),
  }));
}

/** 특정 대장 상세 — 등장 항목(값 있는 것만) + 직원 행 */
export async function getLedgerDetail(ledgerId: string): Promise<{
  items: PayrollItemDef[];
  entries: PayrollEntryRow[];
} | null> {
  const db = await getDb();
  const ledger = rowsToObjects(
    await db.exec(`SELECT ledger_id FROM payroll_ledgers WHERE ledger_id = $1`, [ledgerId])
  );
  if (!ledger.length) return null;

  // 직급·부서는 매칭된 재직자면 현재 사용자 관리 정보를 우선 표시(원본 대장 스냅샷은 갱신 누락이 잦음),
  // 미매칭(퇴사자)은 원본 스냅샷 그대로 둔다.
  const entryRows = rowsToObjects(
    await db.exec(
      `SELECT e.entry_id, e.employee_id, e.emp_no, e.name,
              COALESCE(d.dept_name, e.dept_name) AS dept_name,
              COALESCE(pos.position_name, e.position_name) AS position_name,
              COALESCE(p.hired_at, e.hired_at) AS hired_at,
              e.resigned_at, e.pay_total, e.deduction_total, e.net_pay, e.row_order, e.note
         FROM payroll_entries e
         LEFT JOIN employee_profiles p ON p.employee_id = e.employee_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
         LEFT JOIN departments d ON d.dept_id = p.dept_id
        WHERE e.ledger_id = $1 ORDER BY e.row_order`,
      [ledgerId]
    )
  );
  const lineRows = rowsToObjects(
    await db.exec(
      `SELECT li.entry_id, li.item_id, li.amount
         FROM payroll_entry_lines li
         JOIN payroll_entries e ON e.entry_id = li.entry_id
        WHERE e.ledger_id = $1`,
      [ledgerId]
    )
  );
  const itemRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT d.item_id, d.name, d.kind, d.aliases, d.in_ordinary_wage, d.display_order, d.is_active
         FROM payroll_entry_lines li
         JOIN payroll_entries e ON e.entry_id = li.entry_id
         JOIN payroll_item_defs d ON d.item_id = li.item_id
        WHERE e.ledger_id = $1
        ORDER BY d.display_order`,
      [ledgerId]
    )
  );

  const linesByEntry = new Map<string, Record<string, number>>();
  for (const row of lineRows) {
    const eid = String(row.entry_id);
    const map = linesByEntry.get(eid) ?? {};
    map[String(row.item_id)] = toNum(row.amount);
    linesByEntry.set(eid, map);
  }

  return {
    items: itemRows.map(toItemDef),
    entries: entryRows.map((r) => ({
      entryId: String(r.entry_id),
      employeeId: r.employee_id ? String(r.employee_id) : null,
      empNo: r.emp_no ? String(r.emp_no) : null,
      name: String(r.name),
      deptName: r.dept_name ? String(r.dept_name) : null,
      positionName: r.position_name ? String(r.position_name) : null,
      hiredAt: r.hired_at ? String(r.hired_at) : null,
      resignedAt: r.resigned_at ? String(r.resigned_at) : null,
      payTotal: toNum(r.pay_total),
      deductionTotal: toNum(r.deduction_total),
      netPay: toNum(r.net_pay),
      note: r.note ? String(r.note) : null,
      lines: linesByEntry.get(String(r.entry_id)) ?? {},
    })),
  };
}

/** 해당 연도에 등장하는 성명 목록(연간 뷰 셀렉터) */
export async function listYearNames(year: number): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT e.name
         FROM payroll_entries e
         JOIN payroll_ledgers l ON l.ledger_id = e.ledger_id
        WHERE l.pay_year = $1
        ORDER BY e.name`,
      [year]
    )
  );
  return rows.map((r) => String(r.name));
}

/** 직원(성명)×연도 — 월별 항목 피벗(연간 추이) */
export async function getEmployeeAnnual(year: number, name: string): Promise<{
  items: Array<PayrollItemDef & { amounts: Record<number, number>; total: number }>;
  monthTotals: Record<number, { pay: number; ded: number; net: number }>;
}> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.pay_month, li.item_id, d.name AS item_name, d.kind, d.display_order, sum(li.amount) AS amount
         FROM payroll_entries e
         JOIN payroll_ledgers l ON l.ledger_id = e.ledger_id
         JOIN payroll_entry_lines li ON li.entry_id = e.entry_id
         JOIN payroll_item_defs d ON d.item_id = li.item_id
        WHERE l.pay_year = $1 AND e.name = $2
        GROUP BY l.pay_month, li.item_id, d.name, d.kind, d.display_order
        ORDER BY d.display_order, l.pay_month`,
      [year, name]
    )
  );
  const totalRows = rowsToObjects(
    await db.exec(
      `SELECT l.pay_month,
              sum(e.pay_total) AS pay, sum(e.deduction_total) AS ded, sum(e.net_pay) AS net
         FROM payroll_entries e
         JOIN payroll_ledgers l ON l.ledger_id = e.ledger_id
        WHERE l.pay_year = $1 AND e.name = $2
        GROUP BY l.pay_month`,
      [year, name]
    )
  );

  const byItem = new Map<string, PayrollItemDef & { amounts: Record<number, number>; total: number }>();
  for (const r of rows) {
    const id = String(r.item_id);
    const item =
      byItem.get(id) ??
      ({
        itemId: id,
        name: String(r.item_name),
        kind: r.kind === "deduction" ? "deduction" : "pay",
        aliases: [],
        inOrdinaryWage: false,
        displayOrder: toNum(r.display_order),
        isActive: true,
        amounts: {},
        total: 0,
      } as PayrollItemDef & { amounts: Record<number, number>; total: number });
    const amt = toNum(r.amount);
    item.amounts[toNum(r.pay_month)] = (item.amounts[toNum(r.pay_month)] ?? 0) + amt;
    item.total += amt;
    byItem.set(id, item);
  }
  const monthTotals: Record<number, { pay: number; ded: number; net: number }> = {};
  for (const r of totalRows) {
    monthTotals[toNum(r.pay_month)] = { pay: toNum(r.pay), ded: toNum(r.ded), net: toNum(r.net) };
  }
  return { items: [...byItem.values()], monthTotals };
}

/** 항목 사전 전체(설정 화면, 사용 라인 수 포함) */
export async function listPayrollItems(): Promise<PayrollItemDef[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.item_id, d.name, d.kind, d.aliases, d.in_ordinary_wage, d.display_order, d.is_active,
              count(li.line_id) AS usage_count
         FROM payroll_item_defs d
         LEFT JOIN payroll_entry_lines li ON li.item_id = d.item_id
        GROUP BY d.item_id
        ORDER BY d.kind, d.display_order`
    )
  );
  return rows.map(toItemDef);
}

/** 항목 사전 저장(수정/신규) — item_id 존재 시 갱신 */
export async function savePayrollItem(input: {
  itemId: string;
  name: string;
  kind: "pay" | "deduction";
  aliases: string[];
  inOrdinaryWage: boolean;
  displayOrder: number;
  isActive: boolean;
}): Promise<void> {
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO payroll_item_defs (item_id, name, kind, aliases, in_ordinary_wage, display_order, is_active, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now()::text)
       ON CONFLICT (item_id) DO UPDATE SET
         name = EXCLUDED.name, kind = EXCLUDED.kind, aliases = EXCLUDED.aliases,
         in_ordinary_wage = EXCLUDED.in_ordinary_wage,
         display_order = EXCLUDED.display_order, is_active = EXCLUDED.is_active`,
      [
        input.itemId,
        input.name,
        input.kind,
        JSON.stringify(input.aliases),
        input.inOrdinaryWage ? 1 : 0,
        input.displayOrder,
        input.isActive ? 1 : 0,
      ]
    );
  });
}
