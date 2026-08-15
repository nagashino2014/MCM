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
  const attendanceEmps = new Set(attRows.map((r) => String(r.employee_id)));
  const matches = await matchOvertimeRequests(payYear, payMonth);
  const hourly = await ordinaryHourlyWages(rates.divisorHours);

  // 인원별 집계 — 일자별 대조 결과를 그대로 합산한다(주 합계 min 은 일자 간 상쇄가 생겨 쓰지 않는다).
  const agg = new Map<string, { dayMin: number; nightMin: number; reqMin: number; actualMin: number; noRecord: boolean }>();
  for (const m of matches) {
    const cur = agg.get(m.employeeId) ?? { dayMin: 0, nightMin: 0, reqMin: 0, actualMin: 0, noRecord: false };
    cur.dayMin += m.dayMin;
    cur.nightMin += m.nightMin;
    cur.reqMin += m.reqMin;
    cur.actualMin += m.actualMin;
    if (m.verdict === "no-record") cur.noRecord = true;
    agg.set(m.employeeId, cur);
  }

  const map = new Map<string, OvertimeAmount>();
  for (const [empId, a] of agg) {
    const wage = hourly.get(empId);
    if (!wage) continue;
    map.set(empId, {
      amount: overtimePay(wage, a.dayMin, a.nightMin, rates),
      dayMin: a.dayMin,
      nightMin: a.nightMin,
      basis: a.noRecord ? "requested" : "matched",
      cappedMin: Math.max(0, a.reqMin - a.actualMin),
    });
  }
  // 신청서 없이 근태만 있는 인원 — 사전 승인이 없어 수당 대상이 아니다(기록만 남긴다).
  for (const empId of attendanceEmps) {
    if (!agg.has(empId) && hourly.has(empId)) {
      map.set(empId, { amount: 0, dayMin: 0, nightMin: 0, basis: "attendance", cappedMin: 0 });
    }
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

/** 'YYYY-MM-DDTHH:MM' 또는 Date 문자열 → 그 날 00:00 기준 분(익일이면 +1440) */
function minutesFromBase(iso: string, baseDate: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  const dayDiff = Math.round(
    (Date.parse(`${m[1]}T00:00:00Z`) - Date.parse(`${baseDate}T00:00:00Z`)) / 86400000
  );
  return dayDiff * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

/** 분 구간을 주간/야간(22:00~06:00)으로 쪼갠다. */
function splitRange(startMin: number, endMin: number): { dayMin: number; nightMin: number } {
  let dayMin = 0;
  let nightMin = 0;
  for (let t = Math.floor(startMin); t < Math.ceil(endMin); t += 1) {
    const mod = ((t % 1440) + 1440) % 1440;
    if (mod >= NIGHT_START_MIN || mod < NIGHT_END_MIN) nightMin += 1;
    else dayMin += 1;
  }
  return { dayMin, nightMin };
}

/** 신청 1건과 그 날 근태의 대조 결과(일자 단위) */
export interface OvertimeMatchRow {
  employeeId: string;
  name: string;
  workDate: string;
  reqStart: string;
  reqEnd: string;
  reqMin: number;
  /** 실제 인정분 = 신청 시간대 ∩ 실제 재실 시간대 */
  actualMin: number;
  dayMin: number;
  nightMin: number;
  /** 'no-record'=근태 없음(대조 불가) · 'absent'=출퇴근 기록 없음/미근무 · 'short'=조기 퇴근 등으로 축소 · 'full'=전량 인정 */
  verdict: "no-record" | "absent" | "short" | "full";
}

/**
 * 승인된 초과근무 신청서 × 근태 기록 **일자별 대조**.
 *
 * 신청 시간대와 실제 재실(출근~퇴근) 시간대의 **교집합**만 인정한다.
 *   - 신청했으나 출퇴근 기록이 없거나 겹치지 않으면 0분(absent)
 *   - 신청보다 일찍 퇴근했으면 겹친 만큼만(short)
 *   - 근태 자체가 적재되지 않은 기간은 대조 불가라 신청 시간을 그대로 인정(no-record)
 * 22:00~06:00 구간은 야간(2.0배)으로 분리한다.
 */
export async function matchOvertimeRequests(
  payYear: number,
  payMonth: number
): Promise<OvertimeMatchRow[]> {
  const db = await getDb();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
  const reqs = rowsToObjects(
    await db.exec(
      `SELECT d.drafter_employee_id AS employee_id, d.drafter_name,
              d.field_values->'work_period'->>'from' AS work_date,
              d.field_values->'work_time'->>'start' AS t_start,
              d.field_values->'work_time'->>'end'   AS t_end
         FROM approval_docs d
        WHERE d.form_id = 'frm-overtime-request' AND d.status = 'approved'
          AND d.drafter_employee_id IS NOT NULL
          AND d.field_values->'work_period'->>'from' BETWEEN $1 AND $2`,
      [from, to]
    )
  );
  // 같은 구간 근태 일별 기록(KST 기준 문자열로 뽑아 시간대 변환 오류를 피한다)
  const attRows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
              to_char(in_at  AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI') AS in_at,
              to_char(out_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI') AS out_at
         FROM attendance_daily
        WHERE employee_id IS NOT NULL AND work_date BETWEEN $1::date AND $2::date`,
      [from, to]
    )
  );
  // 한 직원이 본사·지사 두 단말 사번을 가질 수 있어 같은 날짜에 행이 둘일 수 있다
  // (예: 최태헌 본사 0020 빈 행 + 울산 U0008 실기록). 출퇴근이 기록된 행을 우선한다.
  const att = new Map<string, { inAt: string | null; outAt: string | null }>();
  for (const a of attRows) {
    const key = `${String(a.employee_id)}|${String(a.work_date)}`;
    const rec = { inAt: a.in_at ? String(a.in_at) : null, outAt: a.out_at ? String(a.out_at) : null };
    const prev = att.get(key);
    if (prev && prev.inAt && prev.outAt && !(rec.inAt && rec.outAt)) continue;
    att.set(key, rec);
  }
  const hasAttendanceInRange = attRows.length > 0;

  const out: OvertimeMatchRow[] = [];
  for (const r of reqs) {
    const empId = String(r.employee_id);
    const workDate = r.work_date ? String(r.work_date) : null;
    const start = r.t_start ? String(r.t_start) : null;
    const end = r.t_end ? String(r.t_end) : null;
    if (!workDate || !start || !end) continue;

    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const reqStartMin = sh * 60 + sm;
    let reqEndMin = eh * 60 + em;
    if (reqEndMin <= reqStartMin) reqEndMin += 1440; // 자정 넘김
    const reqMin = reqEndMin - reqStartMin;

    const a = att.get(`${empId}|${workDate}`);
    let actualStart = reqStartMin;
    let actualEnd = reqEndMin;
    let verdict: OvertimeMatchRow["verdict"];

    if (!hasAttendanceInRange) {
      verdict = "no-record"; // 근태 미적재 기간 — 신청 시간 그대로
    } else if (!a || !a.inAt || !a.outAt) {
      verdict = "absent";
      actualStart = actualEnd = 0;
    } else {
      const inMin = minutesFromBase(a.inAt, workDate);
      const outMin = minutesFromBase(a.outAt, workDate);
      if (inMin == null || outMin == null) {
        verdict = "absent";
        actualStart = actualEnd = 0;
      } else {
        const outAdj = outMin <= inMin ? outMin + 1440 : outMin; // 자정 넘겨 퇴근
        actualStart = Math.max(reqStartMin, inMin);
        actualEnd = Math.min(reqEndMin, outAdj);
        if (actualEnd <= actualStart) {
          verdict = "absent";
          actualStart = actualEnd = 0;
        } else {
          verdict = actualEnd - actualStart < reqMin ? "short" : "full";
        }
      }
    }

    const actualMin = Math.max(0, actualEnd - actualStart);
    const split = actualMin > 0 ? splitRange(actualStart, actualEnd) : { dayMin: 0, nightMin: 0 };
    out.push({
      employeeId: empId,
      name: String(r.drafter_name ?? ""),
      workDate,
      reqStart: start,
      reqEnd: end,
      reqMin,
      actualMin,
      dayMin: split.dayMin,
      nightMin: split.nightMin,
      verdict,
    });
  }
  return out.sort((x, y) => (x.name === y.name ? x.workDate.localeCompare(y.workDate) : x.name.localeCompare(y.name)));
}

/** 인원별 집계(대조 반영) */
export async function requestedOvertime(
  payYear: number,
  payMonth: number
): Promise<Map<string, RequestedOvertime>> {
  const rows = await matchOvertimeRequests(payYear, payMonth);
  const map = new Map<string, RequestedOvertime>();
  for (const r of rows) {
    const cur = map.get(r.employeeId) ?? {
      employeeId: r.employeeId, name: r.name, dayMin: 0, nightMin: 0, docCount: 0,
    };
    cur.dayMin += r.dayMin;
    cur.nightMin += r.nightMin;
    cur.docCount += 1;
    map.set(r.employeeId, cur);
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
