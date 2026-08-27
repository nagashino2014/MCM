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

/** 수신 경로. 'event' = 캡스 태그 이벤트 로그 집계(lib/adt/events.ts, 마이그 200). */
export type AttendanceSourceKind = "db" | "file" | "event";

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

/**
 * 직원별 근무 유형(attendance_work_schedules, 마이그 167).
 * 초과근무는 **소정근로 종료(endHhmm) 이후**부터 인정하므로 개인별 출근시각 설정이 산정의 전제다.
 * 직접 입력 대신 4가지 유형 중 선택 — 선택하면 출·퇴근 시각이 함께 정해진다.
 */
export type WorkScheduleKind = "early" | "normal" | "late10" | "late10_care";

export const WORK_SCHEDULE_KINDS: Array<{
  kind: WorkScheduleKind;
  label: string;
  startHhmm: string;
  endHhmm: string;
}> = [
  { kind: "early", label: "조기출근(8시)", startHhmm: "0800", endHhmm: "1700" },
  { kind: "normal", label: "정시출근(9시)", startHhmm: "0900", endHhmm: "1800" },
  { kind: "late10", label: "10시 출근", startHhmm: "1000", endHhmm: "1900" },
  // 육아기 근로시간 단축 — 1일 6시간(휴게 1h 포함 10:00~17:00). 소정 종료가 빨라 연장 시작도 앞당겨진다.
  { kind: "late10_care", label: "10시 출근(육아단축)", startHhmm: "1000", endHhmm: "1700" },
];

/** 미설정 직원의 기본값 — 본사·울산 대부분이 8시 출근이다. */
export const DEFAULT_WORK_SCHEDULE_KIND: WorkScheduleKind = "early";

export interface WorkScheduleRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  photoPath: string | null;
  kind: WorkScheduleKind;
  startHhmm: string;
  endHhmm: string;
  /** 저장된 설정 없이 기본값이 적용된 상태 */
  isDefault: boolean;
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
