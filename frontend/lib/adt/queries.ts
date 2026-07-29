/**
 * ADT 근태 관리자 조회·매핑·정책 저장(서버 전용).
 * 화면: /approval/attendance. 라우트는 @/lib/db 의 getDb/withDbWrite 를 통해 이 함수들을 호출.
 */

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { loadAttendanceSettings } from "./settings";
import type { AttendanceSettings } from "./types";

export interface WeeklyRow {
  adtEmpNo: string;
  weekStart: string;
  employeeId: string | null;
  name: string | null;
  deptName: string | null;
  positionName: string | null;
  photoPath: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  overtimeNightMinutes: number;
  overtimeDayMinutes: number;
  excessMinutes: number;
  nightMinutes: number;
  daysWorked: number;
  overLimit: boolean;
  excluded: boolean; // 초과근무 산정 제외(특수관계인·임원)
}

export interface DailyRow {
  workDate: string;
  employeeId: string | null;
  empName: string | null;
  deptSnapshot: string | null;
  inAt: string | null;
  outAt: string | null;
  presentMinutes: number | null;
  breakMinutes: number | null;
  workedMinutes: number | null;
  nightMinutes: number | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  isLeaveDay: boolean;
  vendorOverRaw: string | null;
  vendorNightRaw: string | null;
  source: string;
}

export interface UnmatchedRow {
  adtEmpNo: string;
  empName: string | null;
  deptSnapshot: string | null;
  days: number;
  lastDate: string;
}

export interface MappableEmployee {
  employeeId: string;
  name: string;
  employeeNo: string | null;
  adtEmpNo: string | null;
  deptName: string | null;
  overtimeExcluded: boolean;
}

/** 최근 주(week_start) 목록 — 화면 드롭다운. */
export async function listWeekStarts(limit = 26): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT to_char(week_start, 'YYYY-MM-DD') AS week_start
         FROM attendance_weekly ORDER BY week_start DESC LIMIT $1`,
      [limit]
    )
  );
  return rows.map((r) => String(r.week_start));
}

/** 지정 주의 직원별 초과근무 요약. */
export async function listWeekly(weekStart: string): Promise<WeeklyRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT w.adt_emp_no, to_char(w.week_start, 'YYYY-MM-DD') AS week_start, w.employee_id, w.emp_name,
              e.name AS emp_profile_name, e.photo_public_path, e.overtime_excluded, d.dept_name, p.position_name,
              w.worked_minutes, w.overtime_minutes, w.overtime_night_minutes, w.overtime_day_minutes,
              w.excess_minutes, w.night_minutes, w.days_worked, w.over_limit
         FROM attendance_weekly w
         LEFT JOIN employee_profiles e ON e.employee_id = w.employee_id
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE w.week_start = $1::date
          AND NOT EXISTS (SELECT 1 FROM attendance_ignored_emp g WHERE g.adt_emp_no = w.adt_emp_no)
        ORDER BY COALESCE(e.overtime_excluded, false), w.overtime_minutes DESC, w.excess_minutes DESC, w.adt_emp_no`,
      [weekStart]
    )
  );
  return rows.map((r) => ({
    adtEmpNo: String(r.adt_emp_no),
    weekStart: String(r.week_start),
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    name: (r.emp_profile_name ?? r.emp_name) != null ? String(r.emp_profile_name ?? r.emp_name) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    positionName: r.position_name != null ? String(r.position_name) : null,
    photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
    workedMinutes: Number(r.worked_minutes ?? 0),
    overtimeMinutes: Number(r.overtime_minutes ?? 0),
    overtimeNightMinutes: Number(r.overtime_night_minutes ?? 0),
    overtimeDayMinutes: Number(r.overtime_day_minutes ?? 0),
    excessMinutes: Number(r.excess_minutes ?? 0),
    nightMinutes: Number(r.night_minutes ?? 0),
    daysWorked: Number(r.days_worked ?? 0),
    overLimit: r.over_limit === true || r.over_limit === "t",
    excluded: r.overtime_excluded === true || r.overtime_excluded === "t",
  }));
}

/**
 * 본인 근태(모바일 M5) — user_id 로 최근 N주 요약을 돌려준다.
 * 관리자 화면(listWeekly)은 주 단위로 전 직원을 보지만, 여기는 **본인 것만** 본다.
 */
export async function listMyWeekly(
  userId: string,
  limit = 8
): Promise<{ adtEmpNo: string | null; weeks: WeeklyRow[] }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT w.adt_emp_no, to_char(w.week_start, 'YYYY-MM-DD') AS week_start, w.employee_id, w.emp_name,
              e.name AS emp_profile_name, e.photo_public_path, e.overtime_excluded, d.dept_name, p.position_name,
              w.worked_minutes, w.overtime_minutes, w.overtime_night_minutes, w.overtime_day_minutes,
              w.excess_minutes, w.night_minutes, w.days_worked, w.over_limit
         FROM users u
         JOIN employee_profiles e ON e.employee_id = u.employee_id
         JOIN attendance_weekly w ON w.employee_id = e.employee_id
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE u.user_id = $1
        ORDER BY w.week_start DESC
        LIMIT $2`,
      [userId, limit]
    )
  );
  const weeks = rows.map((r) => ({
    adtEmpNo: String(r.adt_emp_no),
    weekStart: String(r.week_start),
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    name: (r.emp_profile_name ?? r.emp_name) != null ? String(r.emp_profile_name ?? r.emp_name) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    positionName: r.position_name != null ? String(r.position_name) : null,
    photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
    workedMinutes: Number(r.worked_minutes ?? 0),
    overtimeMinutes: Number(r.overtime_minutes ?? 0),
    overtimeNightMinutes: Number(r.overtime_night_minutes ?? 0),
    overtimeDayMinutes: Number(r.overtime_day_minutes ?? 0),
    excessMinutes: Number(r.excess_minutes ?? 0),
    nightMinutes: Number(r.night_minutes ?? 0),
    daysWorked: Number(r.days_worked ?? 0),
    overLimit: r.over_limit === true || r.over_limit === "t",
    excluded: r.overtime_excluded === true || r.overtime_excluded === "t",
  }));
  return { adtEmpNo: weeks[0]?.adtEmpNo ?? null, weeks };
}

/** 한 직원(adt_emp_no)의 특정 주 일별 근태(주 상세 펼침). */
export async function listDailyForWeek(adtEmpNo: string, weekStart: string): Promise<DailyRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT to_char(work_date, 'YYYY-MM-DD') AS work_date, employee_id, emp_name, dept_snapshot,
              to_char(in_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') AS in_at,
              to_char(out_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') AS out_at,
              present_minutes, break_minutes, worked_minutes, night_minutes,
              late_minutes, early_minutes, is_leave_day, vendor_over_raw, vendor_night_raw, source
         FROM attendance_daily
        WHERE adt_emp_no = $1 AND work_date >= $2::date AND work_date < ($2::date + 7)
        ORDER BY work_date`,
      [adtEmpNo, weekStart]
    )
  );
  return rows.map(mapDaily);
}

function mapDaily(r: Record<string, unknown>): DailyRow {
  return {
    workDate: String(r.work_date),
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    empName: r.emp_name != null ? String(r.emp_name) : null,
    deptSnapshot: r.dept_snapshot != null ? String(r.dept_snapshot) : null,
    inAt: r.in_at != null ? String(r.in_at) : null,
    outAt: r.out_at != null ? String(r.out_at) : null,
    presentMinutes: r.present_minutes != null ? Number(r.present_minutes) : null,
    breakMinutes: r.break_minutes != null ? Number(r.break_minutes) : null,
    workedMinutes: r.worked_minutes != null ? Number(r.worked_minutes) : null,
    nightMinutes: r.night_minutes != null ? Number(r.night_minutes) : null,
    lateMinutes: r.late_minutes != null ? Number(r.late_minutes) : null,
    earlyMinutes: r.early_minutes != null ? Number(r.early_minutes) : null,
    isLeaveDay: r.is_leave_day === true || r.is_leave_day === "t",
    vendorOverRaw: r.vendor_over_raw != null ? String(r.vendor_over_raw) : null,
    vendorNightRaw: r.vendor_night_raw != null ? String(r.vendor_night_raw) : null,
    source: String(r.source ?? "db"),
  };
}

/** 직원 미매칭(employee_id NULL) 근태의 adt_emp_no 목록 — 매핑 대상. */
export async function listUnmatched(): Promise<UnmatchedRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT adt_emp_no,
              MAX(emp_name) AS emp_name,
              MAX(dept_snapshot) AS dept_snapshot,
              COUNT(*) AS days,
              to_char(MAX(work_date), 'YYYY-MM-DD') AS last_date
         FROM attendance_daily d
        WHERE employee_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM attendance_ignored_emp g WHERE g.adt_emp_no = d.adt_emp_no)
        GROUP BY adt_emp_no
        ORDER BY MAX(work_date) DESC`
    )
  );
  return rows.map((r) => ({
    adtEmpNo: String(r.adt_emp_no),
    empName: r.emp_name != null ? String(r.emp_name) : null,
    deptSnapshot: r.dept_snapshot != null ? String(r.dept_snapshot) : null,
    days: Number(r.days ?? 0),
    lastDate: String(r.last_date),
  }));
}

/** 매핑 드롭다운용 재직 직원 목록. */
export async function listMappableEmployees(): Promise<MappableEmployee[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.employee_no, e.adt_emp_no, e.overtime_excluded, d.dept_name
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
        WHERE e.status = 'active'
        ORDER BY e.name`
    )
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    name: String(r.name ?? ""),
    employeeNo: r.employee_no != null ? String(r.employee_no) : null,
    adtEmpNo: r.adt_emp_no != null ? String(r.adt_emp_no) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    overtimeExcluded: r.overtime_excluded === true || r.overtime_excluded === "t",
  }));
}

export interface IgnoredEmp {
  adtEmpNo: string;
  label: string | null;
  reason: string | null;
  createdAt: string;
}

/** 근태 관리대상 아님(퇴사자·비직원) 목록. */
export async function listIgnoredEmps(): Promise<IgnoredEmp[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT adt_emp_no, label, reason, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS created_at
         FROM attendance_ignored_emp ORDER BY adt_emp_no`
    )
  );
  return rows.map((r) => ({
    adtEmpNo: String(r.adt_emp_no),
    label: r.label != null ? String(r.label) : null,
    reason: r.reason != null ? String(r.reason) : null,
    createdAt: String(r.created_at),
  }));
}

/** 관리대상 아님 지정(멱등). label 은 수신 성명 스냅샷. */
export async function ignoreAdtEmpNo(adtEmpNo: string, opts: { label?: string | null; reason?: string | null; actorUserId?: string | null } = {}): Promise<void> {
  const no = String(adtEmpNo).trim();
  if (!no) throw new Error("ADT 사번이 비어 있습니다.");
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO attendance_ignored_emp (adt_emp_no, label, reason, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (adt_emp_no) DO UPDATE SET label = EXCLUDED.label, reason = EXCLUDED.reason`,
      [no, opts.label ?? null, opts.reason ?? null, opts.actorUserId ?? null]
    );
  });
}

/** 관리대상 아님 해제(다시 매핑 대상으로). */
export async function unignoreAdtEmpNo(adtEmpNo: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM attendance_ignored_emp WHERE adt_emp_no = $1`, [String(adtEmpNo).trim()]);
  });
}

/** 초과근무 산정 제외(특수관계인·임원) 지정/해제. */
export async function setOvertimeExcluded(employeeId: string, excluded: boolean): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE employee_profiles SET overtime_excluded = $1, updated_at = $2 WHERE employee_id = $3`, [excluded, new Date().toISOString(), employeeId]);
  });
}

/**
 * ADT 사번(adt_emp_no)을 직원에 매핑.
 * 1) 같은 사번을 쓰던 다른 직원 해제(unique 보장) → 2) 대상 직원에 설정
 * 3) 기존 미매칭 attendance 즉시 rebind(이름 표시) 4) 관련 스테이징 재처리 예약(휴가판정까지 정밀 재산정).
 */
export async function mapAdtEmpNo(employeeId: string, adtEmpNo: string): Promise<{ rebound: number }> {
  const no = String(adtEmpNo).trim();
  if (!no) throw new Error("ADT 사번이 비어 있습니다.");
  return withDbWrite(async (db) => {
    await db.run(`UPDATE employee_profiles SET adt_emp_no = NULL, updated_at = $2 WHERE adt_emp_no = $1 AND employee_id <> $3`, [no, new Date().toISOString(), employeeId]);
    await db.run(`UPDATE employee_profiles SET adt_emp_no = $1, updated_at = $2 WHERE employee_id = $3`, [no, new Date().toISOString(), employeeId]);
    const d = await db.exec(`UPDATE attendance_daily SET employee_id = $1, updated_at = now() WHERE adt_emp_no = $2 AND employee_id IS DISTINCT FROM $1`, [employeeId, no]);
    await db.run(`UPDATE attendance_weekly SET employee_id = $1, updated_at = now() WHERE adt_emp_no = $2 AND employee_id IS DISTINCT FROM $1`, [employeeId, no]);
    // 다음 ingest 주기에 직원 기준 휴가일 판정까지 반영되도록 스테이징 재처리 예약.
    await db.run(`UPDATE adt_attendance_raw SET processed = false WHERE e_idno = $1`, [no]);
    return { rebound: (d as unknown as { rowCount?: number })?.rowCount ?? 0 };
  });
}

/** 매핑 해제(프로필만; attendance 는 다음 재처리에서 재평가). */
export async function unmapAdtEmpNo(employeeId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE employee_profiles SET adt_emp_no = NULL, updated_at = $1 WHERE employee_id = $2`, [new Date().toISOString(), employeeId]);
  });
}

export async function getAttendanceSettings(): Promise<AttendanceSettings> {
  return loadAttendanceSettings(await getDb());
}

/** 정책 저장(부분 갱신). */
export async function saveAttendanceSettings(patch: Partial<AttendanceSettings>): Promise<void> {
  const cur = await getAttendanceSettings();
  const s = { ...cur, ...patch };
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO attendance_settings
         (id, week_start_dow, weekly_standard_minutes, weekly_overtime_limit_minutes, daily_standard_minutes,
          break_minutes, night_start_hhmm, night_end_hhmm, overtime_rate_day, overtime_rate_night,
          wage_divisor_hours, round_unit_minutes, min_overtime_minutes, exclude_leave_days, updated_at)
       VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()::text)
       ON CONFLICT (id) DO UPDATE SET
          week_start_dow=EXCLUDED.week_start_dow, weekly_standard_minutes=EXCLUDED.weekly_standard_minutes,
          weekly_overtime_limit_minutes=EXCLUDED.weekly_overtime_limit_minutes, daily_standard_minutes=EXCLUDED.daily_standard_minutes,
          break_minutes=EXCLUDED.break_minutes, night_start_hhmm=EXCLUDED.night_start_hhmm, night_end_hhmm=EXCLUDED.night_end_hhmm,
          overtime_rate_day=EXCLUDED.overtime_rate_day, overtime_rate_night=EXCLUDED.overtime_rate_night,
          wage_divisor_hours=EXCLUDED.wage_divisor_hours, round_unit_minutes=EXCLUDED.round_unit_minutes,
          min_overtime_minutes=EXCLUDED.min_overtime_minutes, exclude_leave_days=EXCLUDED.exclude_leave_days, updated_at=now()::text`,
      [
        s.weekStartDow, s.weeklyStandardMinutes, s.weeklyOvertimeLimitMinutes, s.dailyStandardMinutes,
        s.breakMinutes, s.nightStartHhmm, s.nightEndHhmm, s.overtimeRateDay, s.overtimeRateNight,
        s.wageDivisorHours, s.roundUnitMinutes, s.minOvertimeMinutes, s.excludeLeaveDays,
      ]
    );
  });
}
