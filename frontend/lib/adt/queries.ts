/**
 * ADT 근태 관리자 조회·매핑·정책 저장(서버 전용).
 * 화면: /approval/attendance. 라우트는 @/lib/db 의 getDb/withDbWrite 를 통해 이 함수들을 호출.
 */

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { weeklyOvertimeEstimates } from "@/lib/payroll/overtime";
import { loadAttendanceSettings } from "./settings";
import { DEFAULT_WORK_SCHEDULE_KIND, WORK_SCHEDULE_KINDS } from "./types";
import type { AttendanceSettings, WorkScheduleKind, WorkScheduleRow } from "./types";

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
  /** 통상시급(원) — 최신 근로계약의 통상임금 ÷ 209. 계약·임금 미등록 시 null */
  hourlyWage: number | null;
  /** 예상 초과근무수당(원) — 통상시급 × (1.5×연장 + 2.0×야간), 10원 절사(블루프린트 §6) */
  estimatedPay: number | null;
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

/** 최근 주(week_start) 목록 — 화면 드롭다운(연·월·주차 3단 선택이라 넉넉히 준다). */
export async function listWeekStarts(limit = 300): Promise<string[]> {
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
  // 예상 수당(§6 반영처1) — 통상시급은 근로계약 기준이라 payroll 모듈에서 산정.
  const estimates = await weeklyOvertimeEstimates(weekStart);
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
    hourlyWage: r.employee_id != null ? estimates.get(String(r.employee_id))?.hourlyWage ?? null : null,
    estimatedPay: r.employee_id != null ? estimates.get(String(r.employee_id))?.amount ?? null : null,
  }));
}

/**
 * 본인 근태(모바일 M5) — user_id 로 최근 N주 요약을 돌려준다.
 * 관리자 화면(listWeekly)은 주 단위로 전 직원을 보지만, 여기는 **본인 것만** 본다.
 */
/** 내 근태가 존재하는 월 목록('YYYY-MM', 최신순) — 모바일 연/월 탐색용. */
export async function listMyAttendanceMonths(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT to_char(w.week_start, 'YYYY-MM') AS ym
         FROM users u
         JOIN employee_profiles e ON e.employee_id = u.employee_id
         JOIN attendance_weekly w ON w.employee_id = e.employee_id
        WHERE u.user_id = $1
        ORDER BY ym DESC`,
      [userId]
    )
  );
  return rows.map((r) => String(r.ym));
}

export async function listMyWeekly(
  userId: string,
  limit = 8,
  month?: string | null // 'YYYY-MM' — 지정 시 그 달에 시작하는 주만(모바일 연/월 탐색)
): Promise<{ adtEmpNo: string | null; weeks: WeeklyRow[] }> {
  const db = await getDb();
  const monthCond = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
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
          AND ($3::text IS NULL OR to_char(w.week_start, 'YYYY-MM') = $3)
        ORDER BY w.week_start DESC
        LIMIT $2`,
      [userId, monthCond ? 100 : limit, monthCond]
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
    // 예상 수당은 관리자 주별 화면(listWeekly) 전용 — 개인 근태 조회에서는 표시하지 않는다.
    hourlyWage: null,
    estimatedPay: null,
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

/**
 * 직원별 근무 유형 목록(마이그 167) — 재직자 전원. 미설정자는 기본값(조기출근 8시)으로 채워 보여준다.
 * 초과근무 인정 시작 시각의 근거라 산정 정책 탭에서 관리한다.
 */
export async function listWorkSchedules(): Promise<WorkScheduleRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.photo_public_path, d.dept_name, p.position_name,
              s.schedule_kind, s.start_hhmm, s.end_hhmm
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN attendance_work_schedules s ON s.employee_id = e.employee_id
        WHERE e.status = 'active'
        ORDER BY d.dept_name NULLS LAST, e.name`
    )
  );
  const def = WORK_SCHEDULE_KINDS.find((k) => k.kind === DEFAULT_WORK_SCHEDULE_KIND)!;
  return rows.map((r) => {
    const kind = (r.schedule_kind ? String(r.schedule_kind) : null) as WorkScheduleKind | null;
    const preset = WORK_SCHEDULE_KINDS.find((k) => k.kind === kind);
    return {
      employeeId: String(r.employee_id),
      name: String(r.name ?? ""),
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      positionName: r.position_name != null ? String(r.position_name) : null,
      photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
      kind: kind ?? DEFAULT_WORK_SCHEDULE_KIND,
      startHhmm: r.start_hhmm != null ? String(r.start_hhmm) : (preset ?? def).startHhmm,
      endHhmm: r.end_hhmm != null ? String(r.end_hhmm) : (preset ?? def).endHhmm,
      isDefault: !kind,
    };
  });
}

/** 근무 유형 저장(일괄). 유형을 고르면 출·퇴근 시각은 프리셋에서 결정된다. */
export async function saveWorkSchedules(
  items: Array<{ employeeId: string; kind: WorkScheduleKind }>,
  actorUserId?: string | null
): Promise<number> {
  const valid = items
    .map((it) => ({ ...it, preset: WORK_SCHEDULE_KINDS.find((k) => k.kind === it.kind) }))
    .filter((it) => it.employeeId && it.preset);
  if (!valid.length) return 0;
  await withDbWrite(async (db) => {
    for (const it of valid) {
      await db.run(
        `INSERT INTO attendance_work_schedules (employee_id, schedule_kind, start_hhmm, end_hhmm, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5, now()::text)
         ON CONFLICT (employee_id) DO UPDATE SET
           schedule_kind = EXCLUDED.schedule_kind, start_hhmm = EXCLUDED.start_hhmm,
           end_hhmm = EXCLUDED.end_hhmm, updated_by = EXCLUDED.updated_by, updated_at = now()::text`,
        [it.employeeId, it.kind, it.preset!.startHhmm, it.preset!.endHhmm, actorUserId ?? null]
      );
    }
  });
  return valid.length;
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
