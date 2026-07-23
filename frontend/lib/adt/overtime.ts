/**
 * ADT 근태 자체 산정기 — 순수 함수(테스트 가능).
 * 사규: 주 52h제(일요일 시작, 주 소정 40h + 연장 12h), 야간(22:00~06:00) 2.0배·그 외 연장 1.5배,
 *       주 12h 초과분은 특별휴가 대상(excess, 리포트).
 * 시각은 모두 KST(+09:00)로 해석한다(회사 소재·컨트롤러 로컬 시각).
 */

import type { AdtRawRecord, AttendanceSettings } from "./types";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

/** 'YYYYMMDD' → 'YYYY-MM-DD'. */
export function ymd8ToDate(d: string): string {
  const s = String(d ?? "").replace(/\D/g, "");
  if (s.length !== 8) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** ('YYYY-MM-DD', 'HHMMSS') → KST epoch ms. 유효하지 않으면 null. */
export function kstMs(date: string, hhmmss: string | null | undefined): number | null {
  if (!date) return null;
  const t = String(hhmmss ?? "").replace(/\D/g, "");
  if (t.length < 4) return null; // 최소 HHMM
  const hh = t.slice(0, 2);
  const mm = t.slice(2, 4);
  const ss = t.length >= 6 ? t.slice(4, 6) : "00";
  const ms = Date.parse(`${date}T${hh}:${mm}:${ss}+09:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** ISO8601(+09:00) 문자열. */
export function msToKstIso(ms: number | null): string | null {
  if (ms == null) return null;
  // KST 로컬 시각 문자열로 표현(+09:00 고정).
  const d = new Date(ms + 9 * 60 * MS_PER_MIN);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+09:00`;
}

/** 두 구간 [a1,a2]·[b1,b2]의 겹침 분(≥0). */
function overlapMin(a1: number, a2: number, b1: number, b2: number): number {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return hi > lo ? Math.round((hi - lo) / MS_PER_MIN) : 0;
}

/** 'HHMM' → {h,m}. */
function parseHhmm(v: string): { h: number; m: number } {
  const t = String(v ?? "").replace(/\D/g, "").padStart(4, "0");
  return { h: Number(t.slice(0, 2)), m: Number(t.slice(2, 4)) };
}

/** 근무일 date 기준 야간(nightStart~nightEnd 익일) 재실 겹침 분. 새벽 근무 대비 전일 야간도 합산. */
export function nightMinutes(
  inMs: number,
  outMs: number,
  date: string,
  settings: AttendanceSettings
): number {
  const start = parseHhmm(settings.nightStartHhmm); // 22:00
  const end = parseHhmm(settings.nightEndHhmm); // 06:00(익일)
  const base = Date.parse(`${date}T00:00:00+09:00`);
  const at = (dayOffset: number, h: number, m: number) => base + dayOffset * MS_PER_DAY + (h * 60 + m) * MS_PER_MIN;
  // nightEnd 가 nightStart 보다 이르면(예 22→06) 종료는 익일.
  const wraps = end.h * 60 + end.m <= start.h * 60 + start.m;
  const windows: Array<[number, number]> = [
    // 당일 야간: [D 22:00, (wraps?D+1:D) 06:00]
    [at(0, start.h, start.m), at(wraps ? 1 : 0, end.h, end.m)],
    // 전일 야간: [D-1 22:00, D 06:00] — 새벽 출근분 포착
    [at(-1, start.h, start.m), at(wraps ? 0 : -1, end.h, end.m)],
  ];
  let n = 0;
  for (const [ws, we] of windows) n += overlapMin(inMs, outMs, ws, we);
  return n;
}

/** VARCHAR(4) 벤더 시간 필드를 숫자(분 가정)로 — 실패 시 null. */
function toMinuteNumber(v: string | null | undefined): number | null {
  const s = String(v ?? "").trim();
  if (!s || !/^\d+$/.test(s)) return null;
  return Number(s);
}

export interface DailyComputed {
  inAt: string | null;
  outAt: string | null;
  presentMinutes: number | null;
  breakMinutes: number | null;
  workedMinutes: number | null;
  nightMinutes: number | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
}

/** 일별 원천 산정: 재실·휴게·실근무·야간분·자정보정. */
export function computeDaily(raw: AdtRawRecord, settings: AttendanceSettings): DailyComputed {
  const date = ymd8ToDate(raw.d_date);
  const inMs = kstMs(date, raw.in_time);
  let outMs = kstMs(date, raw.out_time);

  // 지각/조기는 소정 출퇴근 기준시각이 없어 자체 산정 불가 → 컨트롤러값(분 가정) 참고 보존.
  const lateMinutes = toMinuteNumber(raw.late_time);
  const earlyMinutes = toMinuteNumber(raw.early_time);

  if (inMs == null || outMs == null) {
    // 출근/퇴근 누락 — 시각만 가능한 것 저장, 시간류는 미산정(NULL).
    return {
      inAt: msToKstIso(inMs),
      outAt: msToKstIso(outMs),
      presentMinutes: null,
      breakMinutes: null,
      workedMinutes: null,
      nightMinutes: null,
      lateMinutes,
      earlyMinutes,
    };
  }

  // 퇴근이 출근보다 이르면 자정 넘긴 철야 → +1일 보정.
  if (outMs < inMs) outMs += MS_PER_DAY;

  const presentMinutes = Math.max(0, Math.round((outMs - inMs) / MS_PER_MIN));
  const breakMinutes = Math.min(settings.breakMinutes, presentMinutes);
  const workedMinutes = Math.max(0, presentMinutes - breakMinutes);
  const night = nightMinutes(inMs, outMs, date, settings);

  return {
    inAt: msToKstIso(inMs),
    outAt: msToKstIso(outMs),
    presentMinutes,
    breakMinutes,
    workedMinutes,
    nightMinutes: night,
    lateMinutes,
    earlyMinutes,
  };
}

/** 라운딩 단위(내림). unit<=0 이면 그대로. */
function floorUnit(min: number, unit: number): number {
  if (unit <= 0) return Math.max(0, Math.round(min));
  return Math.floor(Math.max(0, min) / unit) * unit;
}

/** ('YYYY-MM-DD', weekStartDow) → 그 주 시작일('YYYY-MM-DD'). UTC 정오 기준으로 오프셋 영향 제거. */
export function weekStartOf(date: string, weekStartDow: number): string {
  const noon = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(noon)) return "";
  const dow = new Date(noon).getUTCDay(); // 0=일
  const diff = (dow - weekStartDow + 7) % 7;
  const start = new Date(noon - diff * MS_PER_DAY);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${start.getUTCFullYear()}-${p(start.getUTCMonth() + 1)}-${p(start.getUTCDate())}`;
}

/** 주 단위 집계 입력(해당 주의 일별 산정 결과 일부). */
export interface WeeklyDailyInput {
  workedMinutes: number | null;
  nightMinutes: number | null;
  isLeaveDay: boolean;
}

export interface WeeklyComputed {
  workedMinutes: number;
  standardMinutes: number;
  overtimeMinutes: number;
  overtimeNightMinutes: number;
  overtimeDayMinutes: number;
  excessMinutes: number;
  nightMinutes: number;
  daysWorked: number;
  overLimit: boolean;
}

/**
 * 주(일요일~토요일) 초과근무 산정.
 * 주 실근무 합 - 소정 = 주 연장. 인정연장 = min(주연장, 한도). 초과분 = excess(특별휴가 대상).
 * 인정연장 중 야간 재실 몫을 2.0배(overtime_night), 나머지 1.5배(overtime_day)로 배분.
 */
export function computeWeekly(days: WeeklyDailyInput[], settings: AttendanceSettings): WeeklyComputed {
  const eligible = settings.excludeLeaveDays ? days.filter((d) => !d.isLeaveDay) : days;
  const workedSum = eligible.reduce((s, d) => s + (d.workedMinutes ?? 0), 0);
  const nightSum = eligible.reduce((s, d) => s + (d.nightMinutes ?? 0), 0);
  const daysWorked = eligible.filter((d) => (d.workedMinutes ?? 0) > 0).length;

  const std = settings.weeklyStandardMinutes;
  const limit = settings.weeklyOvertimeLimitMinutes;

  const weeklyOt = Math.max(0, workedSum - std);
  let recognized = Math.min(weeklyOt, limit);
  if (recognized < settings.minOvertimeMinutes) recognized = 0;
  const excessRaw = Math.max(0, weeklyOt - limit);

  // 인정연장 중 야간 몫(2.0). 야간 재실이 인정연장보다 많을 수 없다.
  const otNightRaw = Math.min(nightSum, recognized);
  const otDayRaw = Math.max(0, recognized - otNightRaw);

  const overtimeNightMinutes = floorUnit(otNightRaw, settings.roundUnitMinutes);
  const overtimeDayMinutes = floorUnit(otDayRaw, settings.roundUnitMinutes);
  const overtimeMinutes = overtimeNightMinutes + overtimeDayMinutes;
  const excessMinutes = floorUnit(excessRaw, settings.roundUnitMinutes);

  return {
    workedMinutes: workedSum,
    standardMinutes: std,
    overtimeMinutes,
    overtimeNightMinutes,
    overtimeDayMinutes,
    excessMinutes,
    nightMinutes: nightSum,
    daysWorked,
    overLimit: excessMinutes > 0,
  };
}
