/*
 * To-do 화면 공용 유틸(모바일) — 날짜 판정·표시 문구·의미색·기본 알림 계산.
 * 서버 계약은 lib/todo-types.ts(frontend/lib/todo/types.ts 복제)를 따른다.
 * 날짜는 전부 로컬(KST 기기) 기준 YYYY-MM-DD 문자열로 다룬다.
 */
import type { CdPalette } from '@/theme/tokens';

import {
  TODO_DEFAULT_REMIND_ALL_DAY_TIME,
  TODO_DEFAULT_REMIND_BEFORE_MIN,
  todoApprovalColorHex,
  type TodoApprovalEvent,
  type TodoColumn,
  type TodoItem,
  type TodoPriority,
  type TodoStatus,
} from './todo-types';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 기기 로컬 오늘 YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYY-MM-DD + n일(달력일). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** 두 날짜의 차이(일) — b - a. */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** "10/13" */
export function fmtMd(ymd: string | null | undefined): string {
  if (!ymd) return '';
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** "월 10/13" — 섹션 헤더용. */
export function fmtWdMd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${WD[new Date(y, m - 1, d).getDay()]} ${m}/${d}`;
}

/** "10/17 (금)" — 마감·예정 날짜 표기(v4). */
export function fmtMdWd(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}/${d} (${WD[new Date(y, m - 1, d).getDay()]})`;
}

/** "10월 13일 월요일" — 날짜 그룹 헤더(v4). */
export function fmtLongDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}월 ${d}일 ${WD[new Date(y, m - 1, d).getDay()]}요일`;
}

/** 기간 "10/13 – 14" · 달이 다르면 "10/30 – 11/2". 하루면 "10/13". */
export function fmtRange(start: string, end: string | null | undefined): string {
  if (!end || end === start) return fmtMd(start);
  return start.slice(0, 7) === end.slice(0, 7) ? `${fmtMd(start)} – ${Number(end.slice(8, 10))}` : `${fmtMd(start)} – ${fmtMd(end)}`;
}

/** 월요일 시작 주의 끝(일요일). */
export function weekEnd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 월=0
  return addDays(ymd, 6 - dow);
}

/** 할 일의 기준일 — Today 뷰 배치는 do_date, 없으면 due_date(§6.1). */
export const keyDate = (it: Pick<TodoItem, 'doDate' | 'dueDate'>): string | null => it.doDate ?? it.dueDate ?? null;

/** 지연 판정 — 기준일이 지났거나 마감이 지났고 미완료. */
export function isOverdue(it: Pick<TodoItem, 'doDate' | 'dueDate' | 'status'>, today: string): boolean {
  if (it.status === 'done') return false;
  const k = keyDate(it);
  return (k != null && k < today) || (it.dueDate != null && it.dueDate < today);
}

export type DueTone = 'over' | 'today' | 'neutral';

/**
 * 마감 라벨(v4 §19-1) — 초과 "10/10 · 3일 지남"(파스텔 빨강) · 오늘 "오늘"(파스텔 주황) · 이후 "10/17 (금)"(글자만).
 * 없으면 null.
 */
export function dueBadge(it: Pick<TodoItem, 'dueDate' | 'status'>, today: string): { label: string; tone: DueTone } | null {
  if (!it.dueDate) return null;
  if (it.status === 'done') return { label: fmtMd(it.dueDate), tone: 'neutral' };
  const diff = diffDays(it.dueDate, today);
  if (diff > 0) return { label: `${fmtMd(it.dueDate)} D+${diff}`, tone: 'over' };
  if (diff === 0) return { label: 'D-Day', tone: 'today' };
  return { label: fmtMdWd(it.dueDate), tone: 'neutral' };
}

/** 우선순위 색 — 높음 error · 보통 warning · 낮음 primary · 없음 faint(§8). */
export function priorityColor(p: TodoPriority, c: CdPalette): string {
  return p === 3 ? c.error : p === 2 ? c.warning : p === 1 ? c.primary : c.faint;
}

/** 상태 색 — 열 이동 시트의 점·세그먼트에 쓴다. */
export function statusColor(s: TodoStatus | null, c: CdPalette): string {
  switch (s) {
    case 'doing':
      return c.primary;
    case 'review':
      return c.warning;
    case 'done':
      return c.success;
    case 'hold':
      return c.muted;
    default:
      return c.faint;
  }
}

/** 한글 이름 이니셜 — 성을 뺀 뒤 두 글자(아바타 규칙과 동일). */
export function initials(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  if (/[가-힣]/.test(n)) return n.length > 2 ? n.slice(-2) : n;
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** 반복 규칙 → 한글 설명(frontend/lib/todo/recurrence.ts describeRecurrence 와 같은 문구). */
export function describeRecurrence(rule: string | null | undefined): string | null {
  const s = String(rule ?? '').trim();
  if (!s) return null;
  if (s === 'daily') return '매일';
  if (s === 'weekdays') return '평일';
  const WEEK = ['월', '화', '수', '목', '금', '토', '일'];
  const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  let m = /^weekly:([A-Z,]+)$/.exec(s);
  if (m) {
    const days = m[1]
      .split(',')
      .map((c) => CODES.indexOf(c))
      .filter((i) => i >= 0)
      .map((i) => WEEK[i]);
    return days.length ? `매주 ${days.join('·')}` : null;
  }
  if (s === 'monthly:last') return '매월 말일';
  m = /^monthly:(\d{1,2})$/.exec(s);
  if (m) return `매월 ${Number(m[1])}일`;
  m = /^yearly:(\d{2})-(\d{2})$/.exec(s);
  if (m) return `매년 ${Number(m[1])}월 ${Number(m[2])}일`;
  m = /^after:(\d{1,3})$/.exec(s);
  if (m) return `완료 후 ${Number(m[1])}일`;
  return null;
}

/**
 * 기본 알림 시각(서버 computeRemindAt 과 같은 규칙, KST 고정) —
 * 시간 있음 → do_time 의 N분 전, 종일 → do_date(없으면 due_date) 의 기본 시각.
 * "기본으로 되돌리기"는 서버에 자동 재계산 입력이 없어 클라이언트가 같은 값을 계산해 보낸다.
 */
export function computeDefaultRemindAt(
  it: Pick<TodoItem, 'doDate' | 'doTime' | 'dueDate'>,
  prefs?: { defaultRemindAllDayTime?: string; defaultRemindBeforeMin?: number }
): string | null {
  const allDay = prefs?.defaultRemindAllDayTime ?? TODO_DEFAULT_REMIND_ALL_DAY_TIME;
  const before = prefs?.defaultRemindBeforeMin ?? TODO_DEFAULT_REMIND_BEFORE_MIN;
  const kst = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);
  if (it.doDate && it.doTime) {
    const at = kst(it.doDate, it.doTime);
    at.setUTCMinutes(at.getUTCMinutes() - before);
    return at.toISOString();
  }
  if (it.doDate) return kst(it.doDate, allDay).toISOString();
  if (it.dueDate) return kst(it.dueDate, allDay).toISOString();
  return null;
}

/** ISO → "10/13 09:00"(기기 로컬). */
export function fmtIsoShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO → 상대 시각("방금"·"5분 전"·"어제"·"10/1"). 댓글·활동 로그용. */
export function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '어제';
  if (day < 7) return `${day}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 결재 일정 종류 색 — 서버 kindColor 가 있으면 그 값, 없으면 TODO_APPROVAL_COLORS 로 푼다. */
export const approvalEventColor = (ev: Pick<TodoApprovalEvent, 'kind' | 'kindColor'>): string =>
  ev.kindColor || todoApprovalColorHex(ev.kind);

/** 결재 일정이 어떤 날짜 섹션에 걸리는지 — 기간 안에 그 날짜가 있으면 포함. 결재 대기(pending)는 오늘 전용(호출측이 today 로 묻는다). */
export function eventCovers(ev: TodoApprovalEvent, ymd: string): boolean {
  return ev.startDate <= ymd && ymd <= (ev.endDate || ev.startDate);
}

/** 결재 대기 행 — 상신 후 경과일(기기 로컬 today 기준). 상신 시각이 없거나 깨졌으면 null. */
export function pendingAgeDays(submittedAt: string | null | undefined, today: string): number | null {
  if (!submittedAt) return null;
  const d = new Date(submittedAt);
  if (Number.isNaN(d.getTime())) return null;
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return Math.max(0, diffDays(ymd, today));
}

/** 결재 대기 맥락 조각 — "기안자 · 양식명 · 문서번호 · 상신 M/D(HH:mm)"(웹 todo-utils 와 같은 규칙). */
export function pendingContextParts(ev: Pick<TodoApprovalEvent, 'drafterName' | 'formName' | 'docNo' | 'submittedAt'>): string[] {
  const parts: string[] = [];
  if (ev.drafterName) parts.push(ev.drafterName);
  if (ev.formName) parts.push(ev.formName);
  if (ev.docNo) parts.push(ev.docNo);
  const at = fmtIsoShort(ev.submittedAt);
  if (at) parts.push(`상신 ${at.replace(' ', '(')})`);
  return parts;
}

/** 할 일 메타 한 줄 — "14:00 · 하위 2/5 · 댓글 2". 배지는 호출측이 따로 그린다. */
export function itemMetaParts(it: TodoItem): string[] {
  const parts: string[] = [];
  if (it.doTime) parts.push(it.doTime);
  else if (it.doDate) parts.push('종일');
  if (it.subtaskTotal > 0) parts.push(`하위 ${it.subtaskDone}/${it.subtaskTotal}`);
  if (it.commentCount > 0) parts.push(`댓글 ${it.commentCount}`);
  return parts;
}

/**
 * 맥락 줄(v4 §19-4) — "용역명 · 발주처". 보드 값이 없으면 연결 라벨("계약 · ○○"), 그것도 없으면
 * 개인 보드가 아닌 보드 이름. 개인 보드의 연결 없는 할 일은 null(둘째 줄 생략).
 */
export function itemContext(it: Pick<TodoItem, 'projectName' | 'clientName' | 'linkKind' | 'linkLabel' | 'boardName' | 'boardKind'>): string | null {
  if (it.projectName) return it.clientName && it.clientName !== it.projectName ? `${it.projectName} · ${it.clientName}` : it.projectName;
  if (it.linkLabel) return it.linkLabel;
  if (it.boardKind && it.boardKind !== 'personal') return it.boardName;
  return null;
}

/** "#RRGGBB" + 알파(0~1) → "#RRGGBBAA". RN 은 8자리 hex 를 받는다. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}

// ── v4 파스텔 팔레트(§19-1·2, 시안 Main/Board/Detail/Mobile) — 라이트 고정값. 다크는 labelColors() 가 알파·밝은 글자로 바꾼다. ──
export const TODO_UI = {
  /** 지연·높음 라벨 */
  over: { bg: '#FBE3E3', fg: '#9b2222', darkFg: '#f5a3a3' },
  /** 오늘 마감 라벨 */
  today: { bg: '#FDEBD3', fg: '#8a4b06', darkFg: '#f2c27a' },
  /** 오늘 그룹 pill · 진행 중 칩 */
  sky: { bg: '#D9E8F8', fg: '#1a47a8', darkFg: '#a9b8ff' },
  /** 검토 칩 */
  lavender: { bg: '#E4DDF7', fg: '#4d5260', darkFg: '#d2d6e0' },
  /** 확인 대기·완료 칩 */
  sage: { bg: '#DDF0D3', fg: '#1c7850', darkFg: '#8fd8b4' },
  /** 할 일·보류 칩, 낮음 라벨 */
  gray: { bg: '#eef0f3', fg: '#646a76', darkFg: '#a1a8b5' },
  /** 하위 작업 분절 — 완료·진행 중 */
  segDone: '#9FD9BA',
  segDoing: '#B9CFEE',
  /** 상단 태그 버튼(연한 배경 + 같은 계열 진한 테두리) */
  tags: {
    today: { bg: '#EEF4FC', border: '#B9CFEE', fg: null as string | null },
    over: { bg: '#FDF1F1', border: '#EFBFBF', fg: '#9b2222' },
    week: { bg: '#F1F8EC', border: '#BFDDAE', fg: null as string | null },
    shared: { bg: '#F4F0FB', border: '#CFC2EE', fg: null as string | null },
    /** 완료 N(276) — 회색 */
    done: { bg: '#F3F4F6', border: '#D7DAE0', fg: null as string | null },
  },
} as const;

export type LabelTone = 'over' | 'today' | 'sky' | 'lavender' | 'sage' | 'gray';

/** 파스텔 라벨 색 — 라이트는 고정값, 다크는 같은 색을 22% 알파로 깔고 글자를 밝게. */
export function labelColors(tone: LabelTone, dark: boolean): { bg: string; fg: string } {
  const t = TODO_UI[tone];
  return dark ? { bg: withAlpha(t.bg, 0.22), fg: t.darkFg } : { bg: t.bg, fg: t.fg };
}

/** 상태 → 파스텔 칩 톤(§19-3 열 이름 칩과 같은 규칙). */
export function statusTone(s: TodoStatus | null | undefined): LabelTone {
  switch (s) {
    case 'doing':
      return 'sky';
    case 'review':
      return 'lavender';
    case 'done':
      return 'sage';
    default:
      return 'gray';
  }
}

const COLUMN_CYCLE: LabelTone[] = ['sky', 'lavender', 'sage', 'over', 'today'];

/**
 * 열 이름 칩 톤 — 할 일 회색 · 진행 중 sky · 검토 lavender · 확인 대기 sage(상태 매핑 또는 이름), 나머지는 순환.
 * 완료·보류는 보드 아래 접힘 행(sage·회색).
 */
export function columnTone(col: Pick<TodoColumn, 'name' | 'statusMap'>, index: number): LabelTone {
  if (col.statusMap === 'todo' || col.statusMap === 'hold') return 'gray';
  if (col.statusMap === 'doing') return 'sky';
  if (col.statusMap === 'review') return 'lavender';
  if (col.statusMap === 'done') return 'sage';
  const n = col.name.replace(/\s/g, '');
  if (n === '할일') return 'gray';
  if (n === '진행중') return 'sky';
  if (n === '검토') return 'lavender';
  if (n === '확인대기') return 'sage';
  return COLUMN_CYCLE[index % COLUMN_CYCLE.length];
}
