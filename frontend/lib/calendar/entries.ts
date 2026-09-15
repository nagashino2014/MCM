/*
 * 일정 메뉴 직접 등록 일정(회의·면접·미팅, 마이그 219) — 저장·조회·정기 회의 규칙 전개.
 *
 * - 회의(meeting): calendar.meeting.manage(관리자·임원)만 등록·편집. 정기 규칙(calendar_meeting_rules)은
 *   "매월 n번째 요일" 방식으로 월 조회 시 occurrence 를 멱등 생성한다(ensureRuleOccurrences).
 *   사람이 손댄 occurrence(is_modified=1)는 규칙이 바뀌어도 보존하고, 미시행은 is_canceled=1 로 남긴다
 *   (행을 지우면 다음 조회에서 다시 생성돼 버린다).
 * - 면접(interview): calendar.interview.manage 만 등록·편집. 일정 자체는 참석자·등록자·면접 관리자만 본다.
 *   이력서(extra.resume)는 같은 집합만 열람.
 * - 미팅(visit): 로그인 사용자 누구나 등록. 편집은 등록자 또는 회의 관리 권한자.
 *   별도 태그 없이 참석자가 본인/부서/선택 집합에 있으면 그 태그로 표시된다(queries.ts).
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { sendPush } from "@/lib/notify/push-expo";
import type {
  CalendarAccess,
  CalendarEntry,
  CalendarEntryExtra,
  CalendarEntryInput,
  CalendarEntryKind,
  CalendarMeetingRule,
  CalendarPerson,
} from "@/lib/calendar/types";

const newId = () => "cal-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
const nowIso = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ENTRY_KINDS: CalendarEntryKind[] = ["meeting", "interview", "visit"];

export interface EntryAccess extends CalendarAccess {
  userId: string;
  employeeId: string | null;
}

/** 현재 사용자의 직접 등록 권한 + employee_id. */
export async function loadEntryAccess(userId: string): Promise<EntryAccess> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT employee_id FROM users WHERE user_id = $1`, [userId]));
  let employeeId = rows[0]?.employee_id != null ? String(rows[0].employee_id) : null;
  if (!employeeId) {
    const prof = rowsToObjects(await db.exec(`SELECT employee_id FROM employee_profiles WHERE user_id = $1 LIMIT 1`, [userId]));
    employeeId = prof[0]?.employee_id != null ? String(prof[0].employee_id) : null;
  }
  const [meeting, interview] = await Promise.all([
    hasPermission(userId, "calendar.meeting.manage"),
    hasPermission(userId, "calendar.interview.manage"),
  ]);
  return { userId, employeeId, meeting, interview };
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === "string" && s.trim()).map(String))] : [];
}

/** employee_id 목록 → 인원 정보(이름·직함·부서). */
export async function resolvePeople(ids: string[]): Promise<Map<string, CalendarPerson>> {
  const out = new Map<string, CalendarPerson>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, dep.dept_name, pos.position_name
         FROM employee_profiles e
         LEFT JOIN departments dep ON dep.dept_id = e.dept_id
         LEFT JOIN positions pos ON pos.position_id = e.position_id
        WHERE e.employee_id = ANY($1::text[])`,
      [ids]
    )
  );
  for (const r of rows) {
    out.set(String(r.employee_id), {
      employeeId: String(r.employee_id),
      name: String(r.name ?? ""),
      positionName: r.position_name != null ? String(r.position_name) : null,
      deptName: r.dept_name != null ? String(r.dept_name) : null,
    });
  }
  return out;
}

// ── 정기 규칙 전개 ──

/** year/month0 의 n번째(1~5) weekday 날짜. 없으면 null(예: 5번째 월요일이 없는 달). */
export function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): string | null {
  const first = new Date(year, month0, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  if (day > lastDay) return null;
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface RuleRow {
  ruleId: string;
  name: string;
  weekday: number;
  weeks: number[];
  startTime: string;
  endTime: string;
  location: string | null;
  attendeeIds: string[];
  isActive: boolean;
  sortOrder: number;
}

function mapRule(r: Record<string, unknown>): RuleRow {
  return {
    ruleId: String(r.rule_id),
    name: String(r.name ?? ""),
    weekday: Number(r.weekday ?? 1),
    weeks: parseJson<unknown[]>(r.weeks, []).map(Number).filter((n) => n >= 1 && n <= 5),
    startTime: String(r.start_time ?? "09:00"),
    endTime: String(r.end_time ?? "10:00"),
    location: r.location != null ? String(r.location) : null,
    attendeeIds: strArr(parseJson(r.attendee_ids, [])),
    isActive: Number(r.is_active ?? 1) === 1,
    sortOrder: Number(r.sort_order ?? 100),
  };
}

async function listRuleRows(activeOnly: boolean): Promise<RuleRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM calendar_meeting_rules ${activeOnly ? "WHERE is_active = 1" : ""} ORDER BY sort_order, name`)
  );
  return rows.map(mapRule);
}

export async function listRules(): Promise<CalendarMeetingRule[]> {
  const rules = await listRuleRows(false);
  const people = await resolvePeople(rules.flatMap((r) => r.attendeeIds));
  return rules.map((r) => ({
    ...r,
    attendees: r.attendeeIds.map((id) => people.get(id)).filter((p): p is CalendarPerson => !!p),
  }));
}

/**
 * 해당 월의 정기 회의 occurrence 를 멱등 생성한다(현재 월 이후만 — 과거는 실제 시행 여부를 모른다).
 * 이미 있는 (rule_id, occurrence_key) 는 건드리지 않는다(수정·미시행 보존).
 */
export async function ensureRuleOccurrences(month: string): Promise<void> {
  const cur = new Date();
  const curMonth = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
  if (month < curMonth) return;
  const rules = await listRuleRows(true);
  if (!rules.length) return;
  const [y, m] = month.split("-").map(Number);
  const ts = nowIso();
  await withDbWrite(async (db) => {
    for (const rule of rules) {
      for (const n of rule.weeks) {
        const date = nthWeekdayOfMonth(y, m - 1, rule.weekday, n);
        if (!date) continue;
        await db.run(
          `INSERT INTO calendar_entries
             (entry_id, kind, title, entry_date, start_time, end_time, location, attendee_ids, note, extra,
              rule_id, occurrence_key, is_modified, is_canceled, created_by, created_at, updated_at)
           VALUES ($1, 'meeting', $2, $3, $4, $5, $6, $7::jsonb, NULL, '{}'::jsonb, $8, $9, 0, 0, NULL, $10, $10)
           ON CONFLICT (rule_id, occurrence_key) WHERE rule_id IS NOT NULL DO NOTHING`,
          [newId(), rule.name, date, rule.startTime, rule.endTime, rule.location, JSON.stringify(rule.attendeeIds), rule.ruleId, `${month}:${n}`, ts]
        );
      }
    }
  });
}

export interface RuleInput {
  ruleId?: string | null;
  name: string;
  weekday: number;
  weeks: number[];
  startTime: string;
  endTime: string;
  location: string | null;
  attendeeIds: string[];
  isActive: boolean;
}

/**
 * 정기 규칙 일괄 저장(추가·수정·삭제). 목록에 없는 기존 규칙은 비활성화한다.
 * 규칙이 바뀌면 오늘 이후의 **미수정** occurrence 를 지운다 — 다음 월 조회에서 새 규칙대로 재생성된다.
 * 사람이 손댄 건(is_modified=1)은 그대로 둔다.
 */
export async function saveRules(inputs: RuleInput[], access: EntryAccess): Promise<CalendarMeetingRule[]> {
  if (!access.meeting) throw new Error("정기 회의 규칙은 관리자·임원만 설정할 수 있습니다.");
  const existing = await listRuleRows(false);
  const today = new Date().toISOString().slice(0, 10);
  const ts = nowIso();
  await withDbWrite(async (db) => {
    const keep = new Set<string>();
    let order = 10;
    for (const raw of inputs) {
      const name = String(raw.name ?? "").trim();
      if (!name) throw new Error("회의명을 입력하세요.");
      const weekday = Number(raw.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("요일이 올바르지 않습니다.");
      const weeks = [...new Set((raw.weeks ?? []).map(Number).filter((n) => n >= 1 && n <= 5))].sort();
      if (!weeks.length) throw new Error(`${name}: 시행 주(첫째~다섯째)를 하나 이상 고르세요.`);
      const startTime = TIME_RE.test(raw.startTime) ? raw.startTime : "09:00";
      const endTime = TIME_RE.test(raw.endTime) ? raw.endTime : "10:00";
      const location = raw.location?.trim() || null;
      const attendeeIds = strArr(raw.attendeeIds);
      const isActive = raw.isActive !== false;
      const prev = raw.ruleId ? existing.find((r) => r.ruleId === raw.ruleId) : null;
      const ruleId = prev ? prev.ruleId : "rule-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
      keep.add(ruleId);
      await db.run(
        `INSERT INTO calendar_meeting_rules
           (rule_id, name, weekday, weeks, start_time, end_time, location, attendee_ids, is_active, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10, $11, $11)
         ON CONFLICT (rule_id) DO UPDATE SET
           name = EXCLUDED.name, weekday = EXCLUDED.weekday, weeks = EXCLUDED.weeks,
           start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, location = EXCLUDED.location,
           attendee_ids = EXCLUDED.attendee_ids, is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order,
           updated_at = EXCLUDED.updated_at`,
        [ruleId, name, weekday, JSON.stringify(weeks), startTime, endTime, location, JSON.stringify(attendeeIds), isActive ? 1 : 0, order, ts]
      );
      order += 10;
      // 규칙 내용이 달라졌으면(또는 신규) 미래 미수정 occurrence 를 지워 재생성 대상으로 만든다.
      const changed =
        !prev ||
        prev.weekday !== weekday ||
        JSON.stringify(prev.weeks) !== JSON.stringify(weeks) ||
        prev.startTime !== startTime ||
        prev.endTime !== endTime ||
        (prev.location ?? "") !== (location ?? "") ||
        prev.name !== name ||
        JSON.stringify(prev.attendeeIds) !== JSON.stringify(attendeeIds) ||
        prev.isActive !== isActive;
      if (changed) {
        await db.run(`DELETE FROM calendar_entries WHERE rule_id = $1 AND is_modified = 0 AND entry_date >= $2`, [ruleId, today]);
      }
    }
    for (const r of existing) {
      if (keep.has(r.ruleId)) continue;
      await db.run(`UPDATE calendar_meeting_rules SET is_active = 0, updated_at = $2 WHERE rule_id = $1`, [r.ruleId, ts]);
      await db.run(`DELETE FROM calendar_entries WHERE rule_id = $1 AND is_modified = 0 AND entry_date >= $2`, [r.ruleId, today]);
    }
  });
  return listRules();
}

// ── 일정 행 ──

export interface CalendarEntryRow {
  entryId: string;
  kind: CalendarEntryKind;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  attendeeIds: string[];
  note: string | null;
  extra: CalendarEntryExtra;
  ruleId: string | null;
  occurrenceKey: string | null;
  isModified: boolean;
  isCanceled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapEntryRow(r: Record<string, unknown>): CalendarEntryRow {
  return {
    entryId: String(r.entry_id),
    kind: String(r.kind) as CalendarEntryKind,
    title: String(r.title ?? ""),
    date: String(r.entry_date ?? "").slice(0, 10),
    startTime: r.start_time != null ? String(r.start_time) : null,
    endTime: r.end_time != null ? String(r.end_time) : null,
    location: r.location != null ? String(r.location) : null,
    attendeeIds: strArr(parseJson(r.attendee_ids, [])),
    note: r.note != null ? String(r.note) : null,
    extra: parseJson<CalendarEntryExtra>(r.extra, {}),
    ruleId: r.rule_id != null ? String(r.rule_id) : null,
    occurrenceKey: r.occurrence_key != null ? String(r.occurrence_key) : null,
    isModified: Number(r.is_modified ?? 0) === 1,
    isCanceled: Number(r.is_canceled ?? 0) === 1,
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** 편집·삭제 가능 여부 — 회의/면접은 권한, 미팅은 등록자 또는 회의 관리 권한자. */
export function canEditEntry(row: { kind: CalendarEntryKind; createdBy: string | null }, access: EntryAccess): boolean {
  if (row.kind === "meeting") return access.meeting;
  if (row.kind === "interview") return access.interview;
  return (row.createdBy != null && row.createdBy === access.userId) || access.meeting;
}

/** 면접 일정·이력서 열람 가능 여부 — 참석자·등록자·면접 관리자. */
export function canViewInterview(row: { attendeeIds: string[]; createdBy: string | null }, access: EntryAccess): boolean {
  if (access.interview) return true;
  if (row.createdBy != null && row.createdBy === access.userId) return true;
  return !!access.employeeId && row.attendeeIds.includes(access.employeeId);
}

async function toEntries(rows: CalendarEntryRow[], access: EntryAccess): Promise<CalendarEntry[]> {
  const people = await resolvePeople(rows.flatMap((r) => r.attendeeIds));
  return rows.map((r) => ({
    ...r,
    attendees: r.attendeeIds.map((id) => people.get(id)).filter((p): p is CalendarPerson => !!p),
    canEdit: canEditEntry(r, access),
  }));
}

/** 월 단위 원시 행(queries.ts 통합 조회용). 정기 회의 occurrence 를 먼저 보장한다. */
export async function listMonthEntryRows(month: string): Promise<CalendarEntryRow[]> {
  await ensureRuleOccurrences(month);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM calendar_entries WHERE entry_date LIKE $1 ORDER BY entry_date, start_time NULLS FIRST, title`, [`${month}-%`])
  );
  return rows.map(mapEntryRow);
}

/** 원시 행 단건(이력서 라우트의 권한 판정용 — 면접 열람 제한 없이 행만). */
export async function getEntryRow(entryId: string): Promise<CalendarEntryRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM calendar_entries WHERE entry_id = $1`, [entryId]));
  return rows.length ? mapEntryRow(rows[0]) : null;
}

export async function getEntry(entryId: string, access: EntryAccess): Promise<CalendarEntry | null> {
  const row = await getEntryRow(entryId);
  if (!row) return null;
  if (row.kind === "interview" && !canViewInterview(row, access)) return null;
  return (await toEntries([row], access))[0];
}

function assertKindPermission(kind: CalendarEntryKind, access: EntryAccess): void {
  if (kind === "meeting" && !access.meeting) throw new Error("회의 일정은 관리자·임원만 등록·편집할 수 있습니다.");
  if (kind === "interview" && !access.interview) throw new Error("면접 일정은 면접 관리자만 등록·편집할 수 있습니다.");
}

/** 입력 정규화 + 종류별 필수값·제목 조립. */
function normalizeInput(raw: Partial<CalendarEntryInput>, kind: CalendarEntryKind) {
  const date = String(raw.date ?? "").trim();
  if (!DATE_RE.test(date)) throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const startTime = raw.startTime && TIME_RE.test(raw.startTime) ? raw.startTime : null;
  const endTime = raw.endTime && TIME_RE.test(raw.endTime) ? raw.endTime : null;
  if (startTime && endTime && endTime < startTime) throw new Error("종료 시각이 시작 시각보다 빠릅니다.");
  const location = String(raw.location ?? "").trim() || null;
  const note = String(raw.note ?? "").trim() || null;
  const attendeeIds = strArr(raw.attendeeIds);
  const ex: CalendarEntryExtra = raw.extra && typeof raw.extra === "object" ? raw.extra : {};
  let title = String(raw.title ?? "").trim();
  let extra: CalendarEntryExtra = {};
  if (kind === "meeting") {
    if (!title) throw new Error("회의명을 입력하세요.");
  } else if (kind === "interview") {
    const candidateName = String(ex.candidateName ?? "").trim();
    if (!candidateName) throw new Error("면접자 성명을 입력하세요.");
    extra = {
      candidateName,
      postingId: ex.postingId ? String(ex.postingId) : null,
      postingTitle: String(ex.postingTitle ?? "").trim(),
    };
    title = `면접 : ${candidateName}`;
  } else {
    const visitors = String(ex.visitors ?? "").trim();
    if (!visitors) throw new Error("방문자를 입력하세요.");
    extra = {
      visitors,
      contractId: ex.contractId ? String(ex.contractId) : null,
      contractTitle: String(ex.contractTitle ?? "").trim(),
      topic: String(ex.topic ?? "").trim(),
    };
    title = `미팅 : ${visitors}`;
  }
  return { title, date, startTime, endTime, location, note, attendeeIds, extra };
}

export async function createEntry(raw: Partial<CalendarEntryInput>, access: EntryAccess): Promise<CalendarEntry> {
  const kind = String(raw.kind ?? "") as CalendarEntryKind;
  if (!ENTRY_KINDS.includes(kind)) throw new Error("일정 종류가 올바르지 않습니다.");
  assertKindPermission(kind, access);
  const v = normalizeInput(raw, kind);
  const entryId = newId();
  const ts = nowIso();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO calendar_entries
         (entry_id, kind, title, entry_date, start_time, end_time, location, attendee_ids, note, extra,
          rule_id, occurrence_key, is_modified, is_canceled, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, NULL, NULL, 1, 0, $11, $12, $12)`,
      [entryId, kind, v.title, v.date, v.startTime, v.endTime, v.location, JSON.stringify(v.attendeeIds), v.note, JSON.stringify(v.extra), access.userId, ts]
    );
  });
  const entry = (await getEntry(entryId, access))!;
  void notifyAttendees(entry, "created");
  return entry;
}

export async function updateEntry(entryId: string, raw: Partial<CalendarEntryInput>, access: EntryAccess): Promise<CalendarEntry> {
  const prev = await getEntryRow(entryId);
  if (!prev) throw new Error("일정을 찾을 수 없습니다.");
  if (!canEditEntry(prev, access)) throw new Error("이 일정을 편집할 권한이 없습니다.");
  const v = normalizeInput({ ...raw, kind: prev.kind }, prev.kind);
  // 면접 이력서는 별도 라우트에서 관리 — 본문 수정으로 잃지 않게 이어 붙인다.
  const extra: CalendarEntryExtra = prev.kind === "interview" ? { ...v.extra, resume: prev.extra.resume ?? null } : v.extra;
  // 미시행 표시는 정기 occurrence 에만 의미가 있다(수기 건은 삭제로 처리).
  const isCanceled = prev.ruleId && raw.isCanceled != null ? (raw.isCanceled ? 1 : 0) : prev.isCanceled ? 1 : 0;
  const ts = nowIso();
  await withDbWrite(async (w) => {
    await w.run(
      `UPDATE calendar_entries
          SET title = $2, entry_date = $3, start_time = $4, end_time = $5, location = $6, attendee_ids = $7::jsonb,
              note = $8, extra = $9::jsonb, is_modified = 1, is_canceled = $10, updated_at = $11
        WHERE entry_id = $1`,
      [entryId, v.title, v.date, v.startTime, v.endTime, v.location, JSON.stringify(v.attendeeIds), v.note, JSON.stringify(extra), isCanceled, ts]
    );
  });
  const entry = (await getEntry(entryId, access))!;
  const moved = prev.date !== v.date || prev.startTime !== v.startTime || prev.endTime !== v.endTime || prev.location !== v.location;
  const addedAttendee = v.attendeeIds.some((id) => !prev.attendeeIds.includes(id));
  if (moved || addedAttendee || isCanceled !== (prev.isCanceled ? 1 : 0)) void notifyAttendees(entry, "updated");
  return entry;
}

/**
 * 삭제 — 정기 occurrence 는 행을 지우면 다음 조회에서 재생성되므로 '미시행'으로 남긴다.
 * 수기 등록 건은 실제 삭제(이력서 파일 정리는 라우트에서).
 */
export async function deleteEntry(entryId: string, access: EntryAccess): Promise<{ canceled: boolean; row: CalendarEntryRow }> {
  const prev = await getEntryRow(entryId);
  if (!prev) throw new Error("일정을 찾을 수 없습니다.");
  if (!canEditEntry(prev, access)) throw new Error("이 일정을 삭제할 권한이 없습니다.");
  const ts = nowIso();
  if (prev.ruleId) {
    await withDbWrite(async (w) => {
      await w.run(`UPDATE calendar_entries SET is_canceled = 1, is_modified = 1, updated_at = $2 WHERE entry_id = $1`, [entryId, ts]);
    });
    const entry = await getEntry(entryId, access);
    if (entry) void notifyAttendees(entry, "updated");
    return { canceled: true, row: prev };
  }
  await withDbWrite(async (w) => {
    await w.run(`DELETE FROM calendar_entries WHERE entry_id = $1`, [entryId]);
  });
  return { canceled: false, row: prev };
}

/** 이력서 메타 갱신(업로드·삭제 라우트 전용). */
export async function setEntryResume(entryId: string, resume: CalendarEntryExtra["resume"]): Promise<void> {
  const ts = nowIso();
  await withDbWrite(async (w) => {
    await w.run(
      `UPDATE calendar_entries
          SET extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{resume}', $2::jsonb, true), updated_at = $3
        WHERE entry_id = $1`,
      [entryId, JSON.stringify(resume ?? null), ts]
    );
  });
}

// ── 알림(모바일 푸시) — 참석자에게. 실패해도 호출부를 막지 않는다. ──

async function notifyAttendees(entry: CalendarEntry, mode: "created" | "updated"): Promise<void> {
  try {
    if (!entry.attendees.length) return;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT user_id FROM employee_profiles WHERE employee_id = ANY($1::text[]) AND user_id IS NOT NULL`, [
        entry.attendees.map((a) => a.employeeId),
      ])
    );
    const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
    if (!userIds.length) return;
    const time = entry.startTime ? ` ${entry.startTime}${entry.endTime ? `~${entry.endTime}` : ""}` : "";
    const kindLabel = entry.kind === "meeting" ? "회의" : entry.kind === "interview" ? "면접" : "미팅";
    const title = entry.isCanceled ? `${kindLabel} 일정 미시행` : mode === "created" ? `${kindLabel} 일정 등록` : `${kindLabel} 일정 변경`;
    const body = `${entry.title} · ${entry.date}${time}${entry.location ? ` · ${entry.location}` : ""}`;
    await sendPush(userIds, {
      event: "calendar.schedule",
      title,
      body,
      link: `/schedule?date=${entry.date}`,
      targetRef: entry.entryId,
      dedupKey: `cal:${entry.entryId}:${entry.updatedAt}`,
    });
  } catch {
    /* 알림 실패는 무시 */
  }
}
