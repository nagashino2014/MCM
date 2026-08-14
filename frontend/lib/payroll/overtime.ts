import { getDb, rowsToObjects } from "@/lib/db";

/**
 * 초과근무수당 산정 공용 모듈 (블루프린트 §6)
 * - 통상시급 = 통상임금 월액(계약 wage_components 중 in_ordinary_wage 항목 합) ÷ 209(attendance_settings).
 * - 금액 = 통상시급 × (주간배수 × 연장분/60 + 야간배수 × 야간분/60), 10원 미만 절사.
 * 사용처: ①급여대장 생성(귀속 전월26~금월25, generate.ts) ②근태 화면 주별 예상 금액(§6 반영처1).
 */

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export interface OvertimeRates {
  rateDay: number;
  rateNight: number;
  divisorHours: number;
}

export async function getOvertimeRates(): Promise<OvertimeRates> {
  const db = await getDb();
  const s = rowsToObjects(
    await db.exec(
      `SELECT overtime_rate_day, overtime_rate_night, wage_divisor_hours FROM attendance_settings LIMIT 1`
    )
  )[0];
  return {
    rateDay: toNum(s?.overtime_rate_day) || 1.5,
    rateNight: toNum(s?.overtime_rate_night) || 2.0,
    divisorHours: toNum(s?.wage_divisor_hours) || 209,
  };
}

/** 통상시급 맵(employeeId → 시급) — 최신 계약 기준 */
export async function ordinaryHourlyWages(divisorHours?: number): Promise<Map<string, number>> {
  const db = await getDb();
  const items = rowsToObjects(
    await db.exec(`SELECT name FROM payroll_item_defs WHERE in_ordinary_wage = 1`)
  ).map((r) => String(r.name));
  const divisor = divisorHours ?? (await getOvertimeRates()).divisorHours;
  const contracts = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (employee_id) employee_id, wage_components
         FROM labor_contracts
        WHERE status <> 'void' AND wage_components IS NOT NULL
        ORDER BY employee_id, contract_date DESC NULLS LAST, created_at DESC`
    )
  );
  const map = new Map<string, number>();
  for (const c of contracts) {
    const wage = (c.wage_components ?? {}) as Record<string, number>;
    const ordinary = items.reduce((a, k) => a + toNum(wage[k]), 0);
    if (ordinary > 0) map.set(String(c.employee_id), ordinary / divisor);
  }
  return map;
}

/** 시급·분 → 금액(10원 절사) */
export function overtimePay(
  hourlyWage: number,
  dayMinutes: number,
  nightMinutes: number,
  rates: OvertimeRates
): number {
  const amount =
    hourlyWage * ((rates.rateDay * dayMinutes) / 60 + (rates.rateNight * nightMinutes) / 60);
  return amount > 0 ? Math.floor(amount / 10) * 10 : 0;
}

/**
 * 급여대장 생성용 — 귀속 구간(전월 26 ~ 금월 25, §8-6) 합산액.
 * 주(week_start+6=토)의 종료일이 구간 내면 그 주 전체를 해당 월에 귀속시킨다.
 */
export async function overtimeAmounts(payYear: number, payMonth: number): Promise<Map<string, number>> {
  const db = await getDb();
  const rates = await getOvertimeRates();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id,
              sum(overtime_day_minutes) AS day_min, sum(overtime_night_minutes) AS night_min
         FROM attendance_weekly
        WHERE employee_id IS NOT NULL
          AND (week_start + 6) >= $1::date AND (week_start + 6) <= $2::date
        GROUP BY employee_id`,
      [from, to]
    )
  );
  const hourly = await ordinaryHourlyWages(rates.divisorHours);
  const map = new Map<string, number>();
  for (const r of rows) {
    const empId = String(r.employee_id);
    const wage = hourly.get(empId);
    if (!wage) continue;
    const amount = overtimePay(wage, toNum(r.day_min), toNum(r.night_min), rates);
    if (amount > 0) map.set(empId, amount);
  }
  return map;
}

export interface WeeklyPayEstimate {
  hourlyWage: number;
  amount: number;
}

/** 근태 화면용 — 해당 주 직원별 예상 수당(통상시급 동반). 계약 없는 직원은 맵에서 제외. */
export async function weeklyOvertimeEstimates(weekStart: string): Promise<Map<string, WeeklyPayEstimate>> {
  const db = await getDb();
  const rates = await getOvertimeRates();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, overtime_day_minutes, overtime_night_minutes
         FROM attendance_weekly
        WHERE week_start = $1::date AND employee_id IS NOT NULL`,
      [weekStart]
    )
  );
  const hourly = await ordinaryHourlyWages(rates.divisorHours);
  const map = new Map<string, WeeklyPayEstimate>();
  for (const r of rows) {
    const empId = String(r.employee_id);
    const wage = hourly.get(empId);
    if (!wage) continue;
    map.set(empId, {
      hourlyWage: Math.round(wage),
      amount: overtimePay(wage, toNum(r.overtime_day_minutes), toNum(r.overtime_night_minutes), rates),
    });
  }
  return map;
}
