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

/**
 * 모바일 카테고리 틴트 — 핸드오프 3a.
 * 필터 칩(선택 상태)과 캘린더 이벤트 필이 같은 틴트를 쓴다(파스텔 배경 + 컬러 텍스트 + 도트).
 * ⚠ 위의 TAG_COLOR(데스크탑 공용 파스텔)와는 다른 값이다 — 3a 가 모바일 전용으로 지정한 팔레트.
 * '선택(refs)'은 핸드오프에 비선택 상태만 있어, 도트색(#b9a1e8) 계열로 선택 상태를 맞췄다.
 */
export const TAG_TINT: Record<CalendarTagKey, { bg: string; text: string; dot: string; pillBg: string }> = {
  self: { bg: '#e3edfc', text: '#2f6fd8', dot: '#4c86f5', pillBg: '#e3edfc' },
  sales: { bg: '#fdefdd', text: '#c1761a', dot: '#f59e42', pillBg: '#fdefdd' },
  dept: { bg: '#e3f3e8', text: '#2e8f4c', dot: '#3fae5a', pillBg: '#e3f3e8' },
  refs: { bg: '#f0e9fb', text: '#7a5fd0', dot: '#b9a1e8', pillBg: '#f0e9fb' },
  vehicle: { bg: '#faf0d2', text: '#94721c', dot: '#e5c04b', pillBg: '#f6e8bb' },
};

/** 칩·목록 표시 순서 — 핸드오프 3a(본인·영업·부서·선택·차량). */
export const TAG_ORDER: CalendarTagKey[] = ['self', 'sales', 'dept', 'refs', 'vehicle'];

/** 캘린더 muted 색(핸드오프 3a) — 전/익월·요일 라벨·주말. */
export const CAL_MUTED = {
  outside: '#ced3e2',
  outsideSun: '#e8c2be',
  weekdayLabel: '#a6acc4',
  sun: '#d98d84',
  sat: '#8a9bd6',
  day: '#565e82',
} as const;

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
