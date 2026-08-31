import { getDb, rowsToObjects } from "@/lib/db";
import type { BonusPeriod } from "@/lib/bonus/source";

/**
 * 인건비 반영 산정(BS-P4, docs/bonus-calculation-blueprint.md §1.3)의 반기 인건비 집계.
 * - 소스는 급여대장(155 payroll_ledgers/entries/entry_lines) — 블루프린트 §3-6 이 예고한
 *   bonus_employee_salaries 는 급여 데이터가 이미 구축돼 신설하지 않는다.
 * - 합산 대상 = 통상임금 산입 항목(payroll_item_defs.in_ordinary_wage = 1:
 *   기본급·식대·자격증수당·연구수당·업무수당)만 — 성과급·초과근무 등 변동분은 제외(사용자 확정).
 * - 별도 상여대장(ledger_kind='bonus')은 제외한다(월 급여가 아님).
 */

export interface HalfLaborCost {
  /** 반기 통상임금 산입 항목 합계(원) */
  total: number;
  /** 집계된 대장 수(=월수) — 6개월 미만이면 급여 데이터 누락 가능 */
  months: number;
}

const HALF_MONTHS: Record<"H1" | "H2", [number, number]> = { H1: [1, 6], H2: [7, 12] };

/** 반기 직원별 인건비(통상임금 산입 항목 합계). 급여대장에 없는 직원은 맵에 담기지 않는다. */
export async function listHalfLaborCosts(p: BonusPeriod): Promise<Map<string, HalfLaborCost>> {
  const [fromMonth, toMonth] = HALF_MONTHS[p.half];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id,
              SUM(l.amount) AS total,
              count(DISTINCT g.ledger_id) AS months
         FROM payroll_ledgers g
         JOIN payroll_entries e ON e.ledger_id = g.ledger_id
         JOIN payroll_entry_lines l ON l.entry_id = e.entry_id
         JOIN payroll_item_defs d ON d.item_id = l.item_id
        WHERE g.pay_year = $1 AND g.pay_month BETWEEN $2 AND $3
          AND g.ledger_kind <> 'bonus'
          AND d.in_ordinary_wage = 1
          AND e.employee_id IS NOT NULL
        GROUP BY e.employee_id`,
      [p.year, fromMonth, toMonth]
    )
  );
  return new Map(
    rows.map((r) => [
      String(r.employee_id),
      { total: Number(r.total ?? 0), months: Number(r.months ?? 0) },
    ])
  );
}
