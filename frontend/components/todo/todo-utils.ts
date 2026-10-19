/*
 * /todo 화면 공용 유틸 — 날짜 묶음·마감 배지·정렬·알림 기본값(클라이언트, 로컬 시각 = KST 가정).
 * 서버 규칙(lib/todo/store.ts computeRemindAt)과 같은 결과를 내도록 맞춘다.
 */
import { Briefcase, Clock, FileText, GraduationCap, Stamp, TreePalm, type LucideIcon } from "lucide-react";
import type { TodoApprovalEvent, TodoColumn, TodoItem, TodoPrefs, TodoStatus } from "@/lib/todo/types";
import { TODO_LINK_KIND_LABELS } from "@/lib/todo/types";
import { comparePosition } from "@/lib/todo/position";

// ── v4 시각 보조(§19) ──
/** 결재 일정 종류 아이콘 — 출장 Briefcase · 휴가 TreePalm · 교육 GraduationCap · 초과근무 Clock · 결재 대기 Stamp · 그 외 FileText. */
export function approvalKindIcon(kind: string): LucideIcon {
  switch (kind) {
    case "trip":
      return Briefcase;
    case "leave":
      return TreePalm;
    case "education":
      return GraduationCap;
    case "overtime":
      return Clock;
    case "pending":
      return Stamp;
    default:
      return FileText;
  }
}

/** 결재 대기 행 — 상신 후 경과일(오늘 기준, 로컬 KST). 상신 시각이 없거나 깨졌으면 null. */
export function pendingAgeDays(submittedAt: string | null | undefined, today: string): number | null {
  if (!submittedAt) return null;
  const d = new Date(submittedAt);
  if (Number.isNaN(d.getTime())) return null;
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return Math.max(0, diffDays(today, ymd));
}

/** 결재 대기 맥락 줄 — "기안자 · 양식명 · 문서번호 · 상신 M/D(HH:mm)" (projectName·clientName 은 호출측이 앞에 붙인다). */
export function pendingContextParts(ev: Pick<TodoApprovalEvent, "drafterName" | "formName" | "docNo" | "submittedAt">): string[] {
  const parts: string[] = [];
  if (ev.drafterName) parts.push(ev.drafterName);
  if (ev.formName) parts.push(ev.formName);
  if (ev.docNo) parts.push(ev.docNo);
  const at = fmtIsoShort(ev.submittedAt);
  if (at) parts.push(`상신 ${at.replace(" ", "(")})`);
  return parts;
}

/** 계약 번호 표시 — contract_id 뒤 8자리. */
export const contractShort = (id: string | null | undefined): string => (id ? id.slice(-8) : "");

/** 열 칩 색 키(todo.css --todo-col-* 변수) — 상태 매핑 → 이름 → 순환 팔레트. */
export type ColumnTone = "todo" | "doing" | "review" | "wait" | "done" | "hold" | "c1" | "c2" | "c3" | "c4" | "c5" | "c6";
const STATUS_TONE: Record<TodoStatus, ColumnTone> = { todo: "todo", doing: "doing", review: "review", done: "done", hold: "hold" };
export function columnTone(col: Pick<TodoColumn, "name" | "statusMap">, index: number): ColumnTone {
  if (col.statusMap) return STATUS_TONE[col.statusMap];
  const n = col.name.replace(/\s+/g, "");
  if (/^할일$/.test(n)) return "todo";
  if (/^진행중$/.test(n)) return "doing";
  if (/^검토$/.test(n)) return "review";
  if (/^확인대기$/.test(n)) return "wait";
  if (/^완료$/.test(n)) return "done";
  if (/^보류$/.test(n)) return "hold";
  return `c${(index % 6) + 1}` as ColumnTone;
}

/** 완료·보류 열 — 보드 아래 가로 접힘 행으로 내려간다(§19-10). */
export const isFoldedColumn = (col: Pick<TodoColumn, "name" | "statusMap">): boolean =>
  col.statusMap === "done" || col.statusMap === "hold" || /^(완료|보류)$/.test(col.name.replace(/\s+/g, ""));

/** "10월 13일 월요일" */
export const longDateKo = (ymd: string): string => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 ${weekdayKoFull(ymd)}`;
const WEEKDAY_KO_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
export const weekdayKoFull = (ymd: string): string => WEEKDAY_KO_FULL[new Date(`${ymd}T12:00:00Z`).getUTCDay()];

/** 맥락 줄 조각 — 용역/프로젝트명(없으면 연결 라벨, 없으면 내부·보드명) · 발주처. */
export function contextParts(it: Pick<TodoItem, "projectName" | "clientName" | "linkKind" | "linkLabel" | "boardKind" | "boardName">): { primary: string; client: string | null } {
  if (it.projectName) return { primary: it.projectName, client: it.clientName };
  if (it.linkKind) {
    const k = TODO_LINK_KIND_LABELS[it.linkKind];
    return { primary: it.linkLabel ? `${k} · ${it.linkLabel}` : k, client: it.clientName };
  }
  return { primary: it.boardKind === "personal" ? "내부" : it.boardName, client: it.clientName };
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 로컬(KST) 오늘 YYYY-MM-DD */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86400000);
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
export const weekdayKo = (ymd: string): string => WEEKDAY_KO[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
/** "10/13" */
export const md = (ymd: string): string => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
/** "월 10/13" */
export const wmd = (ymd: string): string => `${weekdayKo(ymd)} ${md(ymd)}`;

/** 이번 주 마지막 날(주 시작 월=1 → 일요일, 0 → 토요일) */
export function weekEnd(today: string, weekStart: 0 | 1): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=일
  const idx = weekStart === 1 ? (dow + 6) % 7 : dow; // 주 시작 기준 0..6
  return addDays(today, 6 - idx);
}

export type SectionKey = "overdue" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "later" | "none";
export const SECTION_ORDER: SectionKey[] = ["overdue", "today", "tomorrow", "thisWeek", "nextWeek", "later", "none"];
export const SECTION_LABELS: Record<SectionKey, string> = {
  overdue: "지연",
  today: "오늘",
  tomorrow: "내일",
  thisWeek: "이번 주",
  nextWeek: "다음 주",
  later: "이후",
  none: "날짜 없음",
};

/** 섹션 배치 기준일 — 할 날짜 우선, 없으면 마감. */
export const effectiveDate = (it: Pick<TodoItem, "doDate" | "dueDate">): string | null => it.doDate ?? it.dueDate ?? null;

export function sectionOf(date: string | null, today: string, weekStart: 0 | 1): SectionKey {
  if (!date) return "none";
  if (date < today) return "overdue";
  if (date === today) return "today";
  const tomorrow = addDays(today, 1);
  if (date === tomorrow) return "tomorrow";
  const we = weekEnd(today, weekStart);
  if (date <= we) return "thisWeek";
  if (date <= addDays(we, 7)) return "nextWeek";
  return "later";
}

/** 섹션 안 순서: 시각 있음(시각순) → 종일, 그 안에서 우선순위 높은 순 → position. */
export function compareInSection(a: TodoItem, b: TodoItem): number {
  const ad = effectiveDate(a) ?? "";
  const bd = effectiveDate(b) ?? "";
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.doTime && b.doTime && a.doTime !== b.doTime) return a.doTime < b.doTime ? -1 : 1;
  if (!!a.doTime !== !!b.doTime) return a.doTime ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return comparePosition(a.position, b.position);
}

export type SortMode = "manual" | "date" | "priority";
export function sortItems(items: TodoItem[], mode: SortMode): TodoItem[] {
  const out = [...items];
  if (mode === "priority") {
    out.sort((a, b) => (a.priority !== b.priority ? b.priority - a.priority : compareInSection(a, b)));
  } else if (mode === "date") {
    out.sort(compareInSection);
  } else {
    out.sort((a, b) => comparePosition(a.position, b.position));
  }
  return out;
}

export interface DueBadge {
  tone: "over" | "today" | "neutral";
  label: string;
}
/** 마감 배지 — 초과 "M/D D+N", 오늘 "D-Day", 이후 "M/D". 완료 건은 중립.(2026-10-13 사용자: "N일 지남"은 길어 D-day 표기로) */
export function dueBadge(it: Pick<TodoItem, "dueDate" | "status">, today: string, short = false): DueBadge | null {
  if (!it.dueDate) return null;
  if (it.status === "done") return { tone: "neutral", label: `${md(it.dueDate)} 마감` };
  const n = diffDays(today, it.dueDate);
  if (n > 0) return { tone: "over", label: `${md(it.dueDate)} D+${n}` };
  if (n === 0) return { tone: "today", label: "D-Day" };
  return { tone: "neutral", label: short ? md(it.dueDate) : `${md(it.dueDate)} 마감` };
}

/** 결재 일정 색 점(§8) — 기존 TAG_COLOR 계열. */
export const APPROVAL_EVENT_COLORS: Record<TodoApprovalEvent["kind"], string> = {
  leave: "#BDD7EE",
  trip: "#F8CBAD",
  education: "#C5E0B4",
  overtime: "#FFE699",
  sales: "#F8CBAD",
  vehicle: "#FFE699",
  meeting: "#B9E4DC",
  interview: "#F9C9D9",
  visit: "#B9E4DC",
  pending: "#D9E8F8",
};

/** 결재 일정을 날짜 섹션에 배치 — 끝난 일정은 제외, 진행 중(시작 < 오늘 ≤ 끝)은 오늘로. 결재 대기(pending)는 날짜와 무관하게 항상 오늘. */
export function approvalSection(ev: TodoApprovalEvent, today: string, weekStart: 0 | 1): SectionKey | null {
  if (ev.kind === "pending") return "today";
  if (ev.endDate < today) return null;
  const anchor = ev.startDate < today ? today : ev.startDate;
  return sectionOf(anchor, today, weekStart);
}

/** 287 기간 일정(do_date~end_date, 하루 초과)인지. */
export function isPeriodItem(it: Pick<TodoItem, "doDate" | "endDate">): boolean {
  return !!it.doDate && !!it.endDate && it.endDate > it.doDate;
}

/**
 * 기간이 걸치는 날짜 섹션들(§27-2) — 오늘 이전은 오늘부터, 최대 62일. overdue 는 내지 않는다(끝난 기간은 호출측이 제외).
 * nextWeek·later 는 "다음 주 이후" 한 묶음이라 later 로 합친다.
 */
export function periodSections(start: string, end: string, today: string, weekStart: 0 | 1): SectionKey[] {
  if (end < today) return [];
  const out: SectionKey[] = [];
  let d = start < today ? today : start;
  let guard = 0;
  while (d <= end && guard < 62) {
    let k = sectionOf(d, today, weekStart);
    if (k === "nextWeek") k = "later";
    if (k !== "overdue" && k !== "none" && !out.includes(k)) out.push(k);
    d = addDays(d, 1);
    guard += 1;
  }
  return out;
}

/** "10/20 ~ 10/22 · 2일차" / 시작 전 "10/20 ~ 10/22 · 3일" / 끝난 뒤 "10/20 ~ 10/22". */
export function periodBadge(start: string, end: string, today: string): string {
  // diffDays 의 인자 순서에 기대지 않고 직접 센다(날짜 문자열은 YYYY-MM-DD).
  const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const days = span(start, end) + 1;
  const range = `${md(start)} ~ ${md(end)}`;
  if (today < start) return `${range} · ${days}일`;
  if (today > end) return range;
  return `${range} · ${span(start, today) + 1}일차`;
}

/** 서버 computeRemindAt 과 같은 기본 알림 시각(ISO). */
export function defaultRemindAt(
  it: { doDate: string | null; doTime: string | null; dueDate: string | null },
  prefs: Pick<TodoPrefs, "defaultRemindAllDayTime" | "defaultRemindBeforeMin">
): string | null {
  const kst = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+09:00`);
  if (it.doDate && it.doTime) {
    const at = kst(it.doDate, it.doTime);
    at.setMinutes(at.getMinutes() - prefs.defaultRemindBeforeMin);
    return at.toISOString();
  }
  if (it.doDate) return kst(it.doDate, prefs.defaultRemindAllDayTime).toISOString();
  if (it.dueDate) return kst(it.dueDate, prefs.defaultRemindAllDayTime).toISOString();
  return null;
}

/** ISO → "10/13 14:00" (로컬) */
export function fmtIsoShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO → datetime-local 입력값 "YYYY-MM-DDTHH:mm" (로컬) */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 상대 시각 — "방금", "5분 전", "어제 17:20", "10/09" */
export function relativeTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = now - d.getTime();
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const today = localToday();
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (ymd === today) return `오늘 ${hm}`;
  if (ymd === addDays(today, -1)) return `어제 ${hm}`;
  return md(ymd);
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "1400" → "14:00", "9:5" → "09:05" 같은 느슨한 입력 정규화. 실패 시 null. */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (TIME_RE.test(s)) return s;
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 이동 뒤 현재 필터(완료 숨김)로 카드가 사라지는지 */
export const hiddenByDoneFilter = (status: string, showDone: boolean): boolean => !showDone && status === "done";
