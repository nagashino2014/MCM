/**
 * ADT 근태 산정 정책(attendance_settings) 로드/저장.
 * 단일 행 'default'. 마이그레이션 089 가 사규 기본값으로 시드한다.
 */

import { PgDatabase, rowsToObjects } from "@/lib/db";
import type { AttendanceSettings } from "./types";

/** 사규 기본값 — DB 시드와 일치(089). 행이 없을 때의 fallback 로도 쓴다. */
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  weekStartDow: 0,
  weeklyStandardMinutes: 2400,
  weeklyOvertimeLimitMinutes: 720,
  dailyStandardMinutes: 480,
  breakMinutes: 60,
  nightStartHhmm: "2200",
  nightEndHhmm: "0600",
  overtimeRateDay: 1.5,
  overtimeRateNight: 2.0,
  wageDivisorHours: 209,
  roundUnitMinutes: 10,
  minOvertimeMinutes: 0,
  excludeLeaveDays: true,
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** attendance_settings('default')를 로드. 행이 없으면 기본값. */
export async function loadAttendanceSettings(db: PgDatabase): Promise<AttendanceSettings> {
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM attendance_settings WHERE id = 'default' LIMIT 1")
  );
  if (!rows.length) return { ...DEFAULT_ATTENDANCE_SETTINGS };
  const r = rows[0];
  const d = DEFAULT_ATTENDANCE_SETTINGS;
  return {
    weekStartDow: num(r.week_start_dow, d.weekStartDow),
    weeklyStandardMinutes: num(r.weekly_standard_minutes, d.weeklyStandardMinutes),
    weeklyOvertimeLimitMinutes: num(r.weekly_overtime_limit_minutes, d.weeklyOvertimeLimitMinutes),
    dailyStandardMinutes: num(r.daily_standard_minutes, d.dailyStandardMinutes),
    breakMinutes: num(r.break_minutes, d.breakMinutes),
    nightStartHhmm: String(r.night_start_hhmm ?? d.nightStartHhmm),
    nightEndHhmm: String(r.night_end_hhmm ?? d.nightEndHhmm),
    overtimeRateDay: num(r.overtime_rate_day, d.overtimeRateDay),
    overtimeRateNight: num(r.overtime_rate_night, d.overtimeRateNight),
    wageDivisorHours: num(r.wage_divisor_hours, d.wageDivisorHours),
    roundUnitMinutes: num(r.round_unit_minutes, d.roundUnitMinutes),
    minOvertimeMinutes: num(r.min_overtime_minutes, d.minOvertimeMinutes),
    excludeLeaveDays: r.exclude_leave_days === true || r.exclude_leave_days === "t" || r.exclude_leave_days === 1,
  };
}
