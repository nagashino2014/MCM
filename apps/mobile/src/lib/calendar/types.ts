/**
 * 일정(그룹웨어 캘린더) 공용 타입·상수 — 웹 `frontend/lib/calendar/types.ts` 의 사본.
 * ⚠ 태그 키·색이 갈라지면 같은 일정이 두 화면에서 다른 색으로 보인다. 웹이 바뀌면 함께 바꾼다.
 */

export const CALENDAR_TAG_KEYS = ['self', 'dept', 'sales', 'refs', 'vehicle'] as const;
export type CalendarTagKey = (typeof CALENDAR_TAG_KEYS)[number];

export const CALENDAR_TAG_LABELS: Record<CalendarTagKey, string> = {
  self: '본인',
  dept: '부서',
  sales: '영업',
  refs: '선택',
  vehicle: '차량',
};

/** 태그별 파스텔 배경 — 홈 위젯·일정·자산 캘린더 공용(단일 소스). */
export const TAG_COLOR: Record<CalendarTagKey, string> = {
  self: '#BDD7EE',
  dept: '#C5E0B4',
  sales: '#F8CBAD',
  refs: '#CDACE6',
  vehicle: '#FFE699',
};

/** 파스텔 배경 위 글자색. */
export const TAG_INK = '#1f2937';

/** 칩 테두리·도트용 진한 대응색(파스텔은 배경에 쓰면 테두리가 묻힌다). */
export const TAG_COLOR_STRONG: Record<CalendarTagKey, string> = {
  self: '#5B9BD5',
  dept: '#70AD47',
  sales: '#ED7D31',
  refs: '#9966CC',
  vehicle: '#D4A017',
};

export type CalendarKind = 'leave' | 'trip' | 'education' | 'sales' | 'vehicle';

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  leave: '휴가',
  trip: '출장',
  education: '교육',
  sales: '영업',
  vehicle: '차량',
};

export interface CalendarPerson {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
}

export interface CalendarEvent {
  id: string;
  tag: CalendarTagKey;
  kind: CalendarKind;
  /** 스케줄명은 서버가 규칙대로 조립해 내려준다. */
  title: string;
  startDate: string;
  endDate: string;
  /** HH:mm (영업만) */
  startTime: string | null;
  people: CalendarPerson[];
  summary: string | null;
  docId: string | null;
  salesProjectId?: string | null;
  status: 'in_progress' | 'approved' | null;
}

export interface CalendarRefs {
  employeeIds: string[];
  deptIds: string[];
  all: boolean;
}

export interface CalendarPrefs {
  tags: CalendarTagKey[];
  refs: CalendarRefs;
}

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  tags: ['self', 'dept'],
  refs: { employeeIds: [], deptIds: [], all: false },
};

/** 기안으로 만드는 일정 — 날짜를 눌러 새 일정을 만들 때의 선택지. */
export const SCHEDULE_FORMS: { formId: string; label: string }[] = [
  { formId: 'frm-biz-trip-request', label: '출장 신청' },
  { formId: 'frm-education-request', label: '교육 신청' },
  { formId: 'frm-leave-request', label: '휴가 신청' },
];
