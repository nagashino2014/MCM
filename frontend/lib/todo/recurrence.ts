/*
 * 반복 규칙 — 순수 TS(DB·Next 의존 없음). 설계: docs/todo-kanban-blueprint.md §6.1·§3.
 *
 * 규칙 문자열: daily · weekdays · weekly:MO,WE · monthly:15 · monthly:last · yearly:MM-DD · after:N(완료 후 N일)
 * 완료 시 현재 행을 done 처리하고 **다음 발생 1건**만 새로 만든다(미리 생성 금지).
 * 지난 반복을 뒤늦게 완료하면 다음 발생은 **완료일 이후 첫 발생**으로 건너뛴다(Todoist 방식).
 * 월말·2월·윤년: 매월 31일 규칙은 그 달의 마지막 날로, 매년 02-29 는 평년에 02-28 로 당긴다.
 */

export type RecurrenceSpec =
  | { type: "daily" }
  | { type: "weekdays" }
  | { type: "weekly"; days: number[] } // 월=0 … 일=6
  | { type: "monthly"; day: number | "last" }
  | { type: "yearly"; month: number; day: number }
  | { type: "after"; days: number };

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (ymd: string): Date => new Date(`${ymd}T12:00:00Z`);
const toYmd = (d: Date): string => d.toISOString().slice(0, 10);
const pad2 = (n: number): string => String(n).padStart(2, "0");
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const addDays = (ymd: string, n: number): string => {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
};
/** 월=0 … 일=6 */
const weekdayIndex = (ymd: string): number => (toDate(ymd).getUTCDay() + 6) % 7;

export function parseRecurrence(rule: string | null | undefined): RecurrenceSpec | null {
  const s = String(rule ?? "").trim();
  if (!s) return null;
  if (s === "daily") return { type: "daily" };
  if (s === "weekdays") return { type: "weekdays" };
  let m = /^weekly:([A-Z,]+)$/.exec(s);
  if (m) {
    const days = [...new Set(m[1].split(",").map((c) => WEEKDAY_CODES.indexOf(c.trim())).filter((i) => i >= 0))].sort(
      (a, b) => a - b
    );
    return days.length ? { type: "weekly", days } : null;
  }
  if (s === "monthly:last") return { type: "monthly", day: "last" };
  m = /^monthly:(\d{1,2})$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    return d >= 1 && d <= 31 ? { type: "monthly", day: d } : null;
  }
  m = /^yearly:(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { type: "yearly", month, day } : null;
  }
  m = /^after:(\d{1,3})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 ? { type: "after", days: n } : null;
  }
  return null;
}

export function isValidRecurrence(rule: string | null | undefined): boolean {
  return rule == null || rule === "" || parseRecurrence(rule) !== null;
}

/** 한국어 설명("매주 월·수", "매월 말일" …). */
export function describeRecurrence(rule: string | null | undefined): string | null {
  const spec = parseRecurrence(rule);
  if (!spec) return null;
  switch (spec.type) {
    case "daily":
      return "매일";
    case "weekdays":
      return "평일";
    case "weekly":
      return `매주 ${spec.days.map((d) => WEEKDAY_LABELS[d]).join("·")}`;
    case "monthly":
      return spec.day === "last" ? "매월 말일" : `매월 ${spec.day}일`;
    case "yearly":
      return `매년 ${spec.month}월 ${spec.day}일`;
    case "after":
      return `완료 후 ${spec.days}일`;
  }
}

/** 해당 달에서 규칙의 날짜(31일 규칙은 말일로 당김). */
function monthlyDate(y: number, m: number, day: number | "last"): string {
  const last = daysInMonth(y, m);
  const d = day === "last" ? last : Math.min(day, last);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** `after` 를 제외한 규칙에서 date 보다 **엄격히 뒤**인 첫 발생일. */
export function nextAfter(spec: RecurrenceSpec, date: string): string | null {
  switch (spec.type) {
    case "daily":
      return addDays(date, 1);
    case "weekdays": {
      let d = addDays(date, 1);
      while (weekdayIndex(d) >= 5) d = addDays(d, 1);
      return d;
    }
    case "weekly": {
      const cur = weekdayIndex(date);
      let best = 8;
      for (const wd of spec.days) {
        let diff = (wd - cur + 7) % 7;
        if (diff === 0) diff = 7;
        if (diff < best) best = diff;
      }
      return addDays(date, best);
    }
    case "monthly": {
      let y = Number(date.slice(0, 4));
      let m = Number(date.slice(5, 7));
      let cand = monthlyDate(y, m, spec.day);
      if (cand <= date) {
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
        cand = monthlyDate(y, m, spec.day);
      }
      return cand;
    }
    case "yearly": {
      let y = Number(date.slice(0, 4));
      const mk = (yy: number) => `${yy}-${pad2(spec.month)}-${pad2(Math.min(spec.day, daysInMonth(yy, spec.month)))}`;
      let cand = mk(y);
      if (cand <= date) {
        y += 1;
        cand = mk(y);
      }
      return cand;
    }
    case "after":
      return addDays(date, spec.days);
  }
}

/**
 * 완료 시 다음 발생일.
 * - `after:N` → completedDate + N.
 * - 그 외 → fromDate(현재 행의 do_date, 없으면 due_date·completedDate) 다음 발생. 그 값이 completedDate 이하면
 *   (지난 반복을 뒤늦게 완료) completedDate 이후 첫 발생으로 건너뛴다.
 * 규칙이 없거나 잘못됐으면 null.
 */
export function nextOccurrence(rule: string | null | undefined, fromDate: string | null | undefined, completedDate: string): string | null {
  const spec = parseRecurrence(rule);
  if (!spec) return null;
  if (!DATE_RE.test(completedDate)) return null;
  if (spec.type === "after") return addDays(completedDate, spec.days);
  const base = fromDate && DATE_RE.test(fromDate) ? fromDate : completedDate;
  let next = nextAfter(spec, base);
  if (next && next <= completedDate) next = nextAfter(spec, completedDate);
  return next;
}
