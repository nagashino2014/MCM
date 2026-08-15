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

/**
 * 통상시급 맵(employeeId → 시급) — 최신 계약 기준.
 * ⚠ 100원 단위 반올림: 2026-05 대장 역산에서 실측 시급이 전부 100원 단위였다
 *   (이근형 19,200 · 이윤재 15,200 · 최태헌 18,000 · 한도경 24,900 …).
 *   이 반올림을 적용하면 14명 중 13명의 수당이 실측과 원 단위까지 일치한다.
 */
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
    if (ordinary > 0) map.set(String(c.employee_id), Math.round(ordinary / divisor / 100) * 100);
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

export interface OvertimeAmount {
  amount: number;
  dayMin: number;
  nightMin: number;
  /** 산정 근거: requested=신청서만, matched=신청서×근태 대조(작은 값), attendance=근태만(신청서 없음) */
  basis: "requested" | "matched" | "attendance";
  /** 근태가 신청보다 적어 깎인 분(대조 차이) */
  cappedMin: number;
}

/**
 * 급여대장 생성용 — 귀속 구간(전월 26 ~ 금월 25, §8-6) 인원별 초과근무수당.
 *
 * 산정 원칙(2026-08-15 사용자 확정 + 2026-05 대장 실측 대조):
 *   ① 기준은 **승인된 초과근무 신청서**(사전 승인 없는 근무는 수당 대상 아님).
 *   ② 같은 구간 근태(ADT) 기록이 있으면 **실제 인정 시간을 상한으로 캡**한다(신청만 하고 미수행 방지).
 *   ③ 근태가 아직 적재되지 않은 기간은 대조를 건너뛰고 신청 시간으로 산정한다(basis=requested).
 *   ④ 22:00~06:00 은 야간 가산(2.0배) — 실측에서 확인된 사규.
 * 주(week_start+6=토)의 종료일이 구간 내면 그 주 전체를 해당 월에 귀속시킨다.
 */
export async function overtimeAmounts(
  payYear: number,
  payMonth: number
): Promise<Map<string, OvertimeAmount>> {
  const db = await getDb();
  const rates = await getOvertimeRates();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
  const attRows = rowsToObjects(
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
  const attendance = new Map(
    attRows.map((r) => [String(r.employee_id), { day: toNum(r.day_min), night: toNum(r.night_min) }])
  );
  const hasAttendance = attRows.length > 0; // 구간에 근태 적재가 아예 없으면 대조 불가
  const requested = await requestedOvertime(payYear, payMonth);
  const hourly = await ordinaryHourlyWages(rates.divisorHours);

  const map = new Map<string, OvertimeAmount>();
  const empIds = new Set<string>([...requested.keys(), ...attendance.keys()]);
  for (const empId of empIds) {
    const wage = hourly.get(empId);
    if (!wage) continue;
    const req = requested.get(empId);
    const att = attendance.get(empId);

    let dayMin: number;
    let nightMin: number;
    let basis: OvertimeAmount["basis"];
    let cappedMin = 0;
    if (req && hasAttendance && att) {
      dayMin = Math.min(req.dayMin, att.day);
      nightMin = Math.min(req.nightMin, att.night);
      cappedMin = req.dayMin + req.nightMin - (dayMin + nightMin);
      basis = "matched";
    } else if (req) {
      dayMin = req.dayMin;
      nightMin = req.nightMin;
      basis = "requested";
    } else {
      // 신청서 없이 근태만 있는 경우 — 사전 승인 없는 근무라 수당 대상이 아니다(기록만 남긴다).
      map.set(empId, { amount: 0, dayMin: 0, nightMin: 0, basis: "attendance", cappedMin: 0 });
      continue;
    }
    map.set(empId, {
      amount: overtimePay(wage, dayMin, nightMin, rates),
      dayMin,
      nightMin,
      basis,
      cappedMin,
    });
  }
  return map;
}

/** 야간 가산 경계(사규: 22:00 ~ 익일 06:00 은 2.0배) */
const NIGHT_START_MIN = 22 * 60;
const NIGHT_END_MIN = 6 * 60;

/** 신청 시간대(HH:MM~HH:MM)를 주간/야간 분으로 쪼갠다. 종료가 시작보다 작으면 익일로 본다. */
export function splitDayNight(start: string, end: string): { dayMin: number; nightMin: number } {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const s = toMin(start);
  let e = toMin(end);
  if (e <= s) e += 24 * 60;
  let dayMin = 0;
  let nightMin = 0;
  for (let t = s; t < e; t += 1) {
    const mod = t % (24 * 60);
    if (mod >= NIGHT_START_MIN || mod < NIGHT_END_MIN) nightMin += 1;
    else dayMin += 1;
  }
  return { dayMin, nightMin };
}

export interface RequestedOvertime {
  employeeId: string;
  name: string;
  dayMin: number;
  nightMin: number;
  docCount: number;
}

/**
 * 승인된 초과근무 신청서(frm-overtime-request) 기준 시간 집계 — 귀속 구간 근무일 기준.
 * 실측(2026-05 대장 대조)상 회사는 **승인된 신청 시간**으로 수당을 지급하며,
 * 22시 이후분에는 야간 가산(2.0배)이 적용된다.
 */
export async function requestedOvertime(
  payYear: number,
  payMonth: number
): Promise<Map<string, RequestedOvertime>> {
  const db = await getDb();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.drafter_employee_id AS employee_id, d.drafter_name,
              d.field_values->'work_time'->>'start' AS t_start,
              d.field_values->'work_time'->>'end'   AS t_end
         FROM approval_docs d
        WHERE d.form_id = 'frm-overtime-request' AND d.status = 'approved'
          AND d.drafter_employee_id IS NOT NULL
          AND d.field_values->'work_period'->>'from' BETWEEN $1 AND $2`,
      [from, to]
    )
  );
  const map = new Map<string, RequestedOvertime>();
  for (const r of rows) {
    const start = r.t_start ? String(r.t_start) : null;
    const end = r.t_end ? String(r.t_end) : null;
    if (!start || !end) continue;
    const empId = String(r.employee_id);
    const { dayMin, nightMin } = splitDayNight(start, end);
    const cur = map.get(empId) ?? {
      employeeId: empId, name: String(r.drafter_name ?? ""), dayMin: 0, nightMin: 0, docCount: 0,
    };
    cur.dayMin += dayMin;
    cur.nightMin += nightMin;
    cur.docCount += 1;
    map.set(empId, cur);
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
