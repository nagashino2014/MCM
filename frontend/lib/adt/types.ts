/**
 * ADT캡스 근태 연동 — 공용 타입.
 * 설계: docs/ADT_attendance_integration_handoff.md §3~§4 + 사규(주 52h제), infra/aws/089_adt_attendance.sql.
 */

/** 스테이징(adt_attendance_raw) 무손실 원본 레코드. 컨트롤러 직접 INSERT/파일 파싱이 이 형태로 수렴한다. */
export interface AdtRawRecord {
  fpid?: number | null;
  c_dept?: string | null;
  c_pos?: string | null;
  e_group?: number | null;
  e_idno: string; // 사원번호 (키)
  e_name?: string | null;
  d_date: string; // 근무일자 YYYYMMDD (키)
  n_date?: string | null;
  in_time?: string | null; // HHMMSS
  out_time?: string | null; // HHMMSS
  leave_time?: string | null;
  return_time?: string | null;
  late_time?: string | null;
  early_time?: string | null;
  over_time?: string | null; // 컨트롤러 산정 연장(감사용)
  night_time?: string | null;
  total_time?: string | null;
  allow_time?: string | null;
}

/** 수신 경로. */
export type AttendanceSourceKind = "db" | "file";

/** 자체 초과근무 산정 정책(attendance_settings). */
export interface AttendanceSettings {
  weekStartDow: number; // 0=일요일
  weeklyStandardMinutes: number; // 주 소정(40h=2400)
  weeklyOvertimeLimitMinutes: number; // 주 연장 인정 한도(12h=720)
  dailyStandardMinutes: number; // 참고
  breakMinutes: number;
  nightStartHhmm: string; // 'HHMM'
  nightEndHhmm: string; // 'HHMM' (익일)
  overtimeRateDay: number; // 1.5
  overtimeRateNight: number; // 2.0
  wageDivisorHours: number; // 209
  roundUnitMinutes: number; // 0 = 미적용
  minOvertimeMinutes: number;
  excludeLeaveDays: boolean;
}

/** 일별 정규화·산정 결과(attendance_daily 1행). */
export interface AttendanceDaily {
  adtEmpNo: string;
  workDate: string; // 'YYYY-MM-DD'
  employeeId: string | null;
  empName: string | null;
  deptSnapshot: string | null;
  posSnapshot: string | null;
  inAt: string | null; // ISO8601(+09:00)
  outAt: string | null; // ISO8601(+09:00)
  presentMinutes: number | null;
  breakMinutes: number | null;
  workedMinutes: number | null;
  nightMinutes: number | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  isLeaveDay: boolean;
  vendorOverRaw: string | null;
  vendorNightRaw: string | null;
  vendorTotalRaw: string | null;
  vendorAllowRaw: string | null;
  source: AttendanceSourceKind;
}

/** 주별 초과근무 산정 결과(attendance_weekly 1행). */
export interface AttendanceWeekly {
  adtEmpNo: string;
  weekStart: string; // 'YYYY-MM-DD' (주 시작일=일요일)
  employeeId: string | null;
  empName: string | null;
  workedMinutes: number;
  standardMinutes: number;
  overtimeMinutes: number; // 인정 연장(min(주연장, 한도))
  overtimeNightMinutes: number; // 2.0배 대상
  overtimeDayMinutes: number; // 1.5배 대상
  excessMinutes: number; // 12h 초과분(특별휴가 대상)
  nightMinutes: number;
  daysWorked: number;
  overLimit: boolean;
}
