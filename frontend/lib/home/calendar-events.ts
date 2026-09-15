import type { CalendarEvent, CalendarTagKey } from "@/lib/calendar/types";

const DAY_MS = 86_400_000;

function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime() / DAY_MS;
}

/** 홈의 기존 6주 격자에 표시되는 회의·면접 날짜. 기간과 미시행 처리는 일정 메뉴와 같다. */
export function homeCalendarEntryDays(
  events: CalendarEvent[],
  tag: CalendarTagKey | "",
  year: number,
  month0: number
): Array<{ event: CalendarEvent; date: string }> {
  if (tag !== "meeting" && tag !== "interview") return [];
  const first = new Date(Date.UTC(year, month0, 1));
  const gridStart = first.getTime() / DAY_MS - first.getUTCDay();
  const gridEnd = gridStart + 41;
  const days: Array<{ event: CalendarEvent; date: string }> = [];

  for (const event of events) {
    if (event.tag !== tag || event.canceled) continue;
    const start = dayNumber(event.startDate);
    if (start === null) continue;
    const end = Math.max(start, dayNumber(event.endDate || event.startDate) ?? start);
    for (let day = Math.max(start, gridStart); day <= Math.min(end, gridEnd); day++) {
      days.push({ event, date: new Date(day * DAY_MS).toISOString().slice(0, 10) });
    }
  }
  return days;
}
