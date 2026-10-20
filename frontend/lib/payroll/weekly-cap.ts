/*
 * 주 연장근로 한도 배분(F-21, 2026-10-20 사용자 확정) — 순수 계산.
 * 같은 직원·같은 주의 인정 구간을 날짜·시각 순서로 쌓아 한도(기본 12h)까지는 수당(paid),
 * 그 뒤는 대체휴가(excess)로 넘긴다. 동의서 '임금 지급에 갈음' — 같은 시간이 수당과 휴가로 두 번 나가지 않는다.
 * 잘린 시간의 주간/야간 구분은 실제 시간대(22:00~06:00 야간)로 나눈다.
 */

/** 야간 가산 경계(사규: 22:00 ~ 익일 06:00 은 2.0배) */
const NIGHT_START_MIN = 22 * 60;
const NIGHT_END_MIN = 6 * 60;

/** 분 구간(근무일 00:00 기준, 익일은 +1440)을 주간/야간으로 쪼갠다. */
export function splitDayNightRange(startMin: number, endMin: number): { dayMin: number; nightMin: number } {
  let dayMin = 0;
  let nightMin = 0;
  for (let t = Math.floor(startMin); t < Math.ceil(endMin); t += 1) {
    const mod = ((t % 1440) + 1440) % 1440;
    if (mod >= NIGHT_START_MIN || mod < NIGHT_END_MIN) nightMin += 1;
    else dayMin += 1;
  }
  return { dayMin, nightMin };
}

export interface WeeklyCapRow {
  docId: string;
  employeeId: string;
  workDate: string;
  /** 인정 구간 — 근무일 00:00 기준 분 */
  segs: Array<[number, number]>;
}

export interface WeeklyCapShare {
  paidDay: number;
  paidNight: number;
  excessDay: number;
  excessNight: number;
}

const dayIndex = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86400000);

/** docId → 수당/대체휴가 몫. weekKey 는 근무일이 속한 주의 키(주 시작일). */
export function capWeeklyOvertime(
  rows: WeeklyCapRow[],
  limitMinutes: number,
  weekKey: (workDate: string) => string
): Map<string, WeeklyCapShare> {
  const out = new Map<string, WeeklyCapShare>();
  const groups = new Map<string, Array<{ docId: string; abs: number; s: number; e: number }>>();
  for (const r of rows) {
    out.set(r.docId, { paidDay: 0, paidNight: 0, excessDay: 0, excessNight: 0 });
    const key = `${r.employeeId}|${weekKey(r.workDate)}`;
    const list = groups.get(key) ?? [];
    for (const [s, e] of r.segs) {
      if (e > s) list.push({ docId: r.docId, abs: dayIndex(r.workDate) * 1440 + s, s, e });
    }
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.abs - b.abs || a.docId.localeCompare(b.docId));
    let used = 0;
    for (const seg of list) {
      const share = out.get(seg.docId)!;
      const paidLen = Math.max(0, Math.min(seg.e - seg.s, limitMinutes - used));
      used += paidLen;
      const paid = splitDayNightRange(seg.s, seg.s + paidLen);
      const excess = splitDayNightRange(seg.s + paidLen, seg.e);
      share.paidDay += paid.dayMin;
      share.paidNight += paid.nightMin;
      share.excessDay += excess.dayMin;
      share.excessNight += excess.nightMin;
    }
  }
  return out;
}

/** 귀속 구간(전월 26 ~ 금월 25) — 근무일이 속한 급여 귀속 연월. */
export function payPeriodOf(ymd: string): { year: number; month: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  if (d >= 26) return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  return { year: y, month: m };
}
