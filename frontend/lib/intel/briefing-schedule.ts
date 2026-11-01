import type { BriefingFilters, BriefingProfileInput, BriefingSchedule } from "./briefing-types";

export function briefingError(message: string, status = 400): Error { return Object.assign(new Error(message), { status }); }
const dayMs = 86400000;
export function kstDate(now = new Date()): string { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function array(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.map(String).map(x => x.trim()).filter(Boolean))].slice(0, 100) : []; }
function amount(value: unknown): number | null { if (value == null || value === "") return null; const n = Number(value); if (!Number.isFinite(n) || n < 0) throw briefingError("규모는 0 이상의 숫자로 입력하세요."); return n; }
export function normalizeBriefingProfile(raw: unknown, ownerUserId: string): BriefingProfileInput {
  const r = (raw ?? {}) as Partial<BriefingProfileInput>;
  const f = (r.filters ?? {}) as Partial<BriefingFilters>;
  const s = (r.schedule ?? {}) as Partial<BriefingSchedule>;
  const startDate = s.startDate ?? kstDate(); const time = s.time ?? "08:30";
  if (!validDate(startDate)) throw briefingError("시작일을 YYYY-MM-DD 형식으로 입력하세요.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw briefingError("실행 시각을 HH:mm 형식으로 입력하세요.");
  const cadence = s.cadence ?? "weekly";
  if (!["daily", "every3days", "weekly", "monthly"].includes(cadence)) throw briefingError("지원하지 않는 실행 주기입니다.");
  const weekday = s.weekday ?? 1; const monthDay = s.monthDay ?? 1;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) throw briefingError("요일 또는 월간 실행일이 올바르지 않습니다.");
  const min = amount(f.amountMin), max = amount(f.amountMax);
  if (min != null && max != null && min > max) throw briefingError("최소 규모가 최대 규모보다 큽니다.");
  const name = String(r.name ?? "").trim().slice(0, 80); if (!name) throw briefingError("프로필 이름을 입력하세요.");
  const visibility = r.visibility === "shared" ? "shared" : "private";
  const recipients = new Map<string, Set<"inbox" | "email" | "app">>();
  for (const x of (Array.isArray(r.recipients) ? r.recipients : [])) {
    const uid = String(x?.userId ?? "").trim(); if (!uid || (visibility === "private" && uid !== ownerUserId)) continue;
    const channels = recipients.get(uid) ?? new Set<"inbox" | "email" | "app">(["inbox"]);
    for (const c of Array.isArray(x.channels) ? x.channels : []) if (c === "inbox" || c === "email" || c === "app") channels.add(c);
    recipients.set(uid, channels);
  }
  if (!recipients.has(ownerUserId)) recipients.set(ownerUserId, new Set(["inbox"]));
  if (recipients.size > 50) throw briefingError("수신자는 최대 50명입니다.");
  return {
    name, enabled: r.enabled === true, visibility,
    filters: { industries: array(f.industries), regions: array(f.regions), signalTypes: array(f.signalTypes), companyNames: array(f.companyNames), services: array(f.services), amountMin: min, amountMax: max, includeUnknownScale: f.includeUnknownScale !== false },
    schedule: { cadence, startDate, time, weekday, monthDay, timezone: "Asia/Seoul" },
    recipients: [...recipients].map(([userId, channels]) => ({ userId, channels: [...channels] })),
    reportLevel: r.reportLevel === "detailed" ? "detailed" : "summary", notifyNoChange: r.notifyNoChange === true,
    allowPartialSources: r.allowPartialSources === true, requiredSources: array(r.requiredSources),
    importantAlerts: r.importantAlerts === true, importantAmount: amount(r.importantAmount),
  };
}
export function matchesScheduleDate(s: BriefingSchedule, date: string): boolean {
  if (date < s.startDate) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (s.cadence === "daily") return true;
  if (s.cadence === "every3days") return Math.round((d.getTime() - Date.parse(`${s.startDate}T00:00:00Z`)) / dayMs) % 3 === 0;
  if (s.cadence === "weekly") return d.getUTCDay() === s.weekday;
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() === Math.min(s.monthDay, last);
}
/** 예정 시각은 KST 달력으로 계산한다. next는 strictly after여서 같은 슬롯을 다시 예약하지 않는다. */
export function nextBriefingSlot(s: BriefingSchedule, after = new Date()): string {
  const start = new Date(`${kstDate(after)}T00:00:00Z`);
  if (kstDate(after) < s.startDate) start.setTime(Date.parse(`${s.startDate}T00:00:00Z`));
  for (let i = 0; i < 370; i++) {
    const date = new Date(start.getTime() + i * dayMs).toISOString().slice(0, 10);
    const instant = new Date(`${date}T${s.time}:00+09:00`);
    if (instant > after && matchesScheduleDate(s, date)) return instant.toISOString();
  }
  throw briefingError("다음 실행 시각을 계산할 수 없습니다.");
}
/** 중단 기간의 슬롯은 최근 한 회차로 합친다. */
export function latestDueBriefingSlot(s: BriefingSchedule, firstDue: string, now = new Date()): string | null {
  if (Date.parse(firstDue) > now.getTime()) return null;
  const today = new Date(`${kstDate(now)}T00:00:00Z`);
  for (let i = 0; i < 370; i++) {
    const date = new Date(today.getTime() - i * dayMs).toISOString().slice(0, 10);
    const instant = new Date(`${date}T${s.time}:00+09:00`);
    if (instant <= now && matchesScheduleDate(s, date)) return instant.toISOString();
  }
  return null;
}
