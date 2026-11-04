/**
 * 일정(그룹웨어 캘린더) 공용 타입·상수 — 웹 `frontend/lib/calendar/types.ts` 의 사본.
 * ⚠ 태그 키·색이 갈라지면 같은 일정이 두 화면에서 다른 색으로 보인다. 웹이 바뀌면 함께 바꾼다.
 */

// todo(할 일)는 웹 10-14 추가 — 일정 설정(태그)을 웹과 공유하므로 모바일도 키를 알아야 한다(2026-10-20: 웹에서 켠 todo 로 이벤트가 오면
// TAG_TINT[todo] 가 없어 렌더 예외 → 릴리스 앱 종료(일정 메뉴 튕김)).
export const CALENDAR_TAG_KEYS = ['self', 'dept', 'sales', 'refs', 'vehicle', 'meeting', 'interview', 'todo'] as const;
export type CalendarTagKey = (typeof CALENDAR_TAG_KEYS)[number];

export const CALENDAR_TAG_LABELS: Record<CalendarTagKey, string> = {
  self: '본인',
  dept: '부서',
  sales: '영업',
  refs: '선택',
  vehicle: '차량',
  meeting: '회의',
  interview: '면접',
  todo: '할 일',
};

/** 태그별 파스텔 배경 — 홈 위젯·일정·자산 캘린더 공용(단일 소스). */
export const TAG_COLOR: Record<CalendarTagKey, string> = {
  self: '#CFE6FF', // 밝은 파랑(2026-11-03, 하늘 #BDD7EE 보다 밝게 — 웹과 동일)
  dept: '#C5E0B4',
  sales: '#F8CBAD',
  refs: '#C9D2F4', // 남색 계열(2026-11-03, 라일락 #CDACE6 에서 교체 — 할 일 연보라와 구분)
  vehicle: '#FFE699',
  meeting: '#B9E4DC',
  interview: '#F9C9D9',
  todo: '#D9D4F0',
};

/** 파스텔 배경 위 글자색. */
export const TAG_INK = '#1f2937';

/**
 * 모바일 카테고리 틴트 — 핸드오프 3a.
 * 필터 칩(선택 상태)과 캘린더 이벤트 필이 같은 틴트를 쓴다(파스텔 배경 + 컬러 텍스트 + 도트).
 * ⚠ 위의 TAG_COLOR(데스크탑 공용 파스텔)와는 다른 값이다 — 3a 가 모바일 전용으로 지정한 팔레트.
 * 2026-11-03: '선택(refs)' 라일락이 '할 일(todo)' 연보라와 구분되지 않아 refs 를 **남색** 계열로,
 * '본인(self)'을 그보다 **밝은 파란색** 계열로 옮겼다(웹 TAG_COLOR_STRONG self #3B9CF5 · refs #3B4FB8 과 같은 축).
 */
export const TAG_TINT: Record<CalendarTagKey, { bg: string; text: string; dot: string; pillBg: string }> = {
  self: { bg: '#dcecff', text: '#1e6fd9', dot: '#3b9cf5', pillBg: '#dcecff' },
  sales: { bg: '#fdefdd', text: '#c1761a', dot: '#f59e42', pillBg: '#fdefdd' },
  dept: { bg: '#e3f3e8', text: '#2e8f4c', dot: '#3fae5a', pillBg: '#e3f3e8' },
  refs: { bg: '#e3e8f8', text: '#2f41a8', dot: '#3b4fb8', pillBg: '#dfe5f6' },
  vehicle: { bg: '#faf0d2', text: '#94721c', dot: '#e5c04b', pillBg: '#f6e8bb' },
  // 회의·면접(219) — 웹 TAG_COLOR 민트/핑크 계열을 모바일 틴트 규칙(파스텔 배경 + 컬러 텍스트)으로.
  meeting: { bg: '#dff3ef', text: '#1f8a78', dot: '#2e9e8c', pillBg: '#dff3ef' },
  interview: { bg: '#fde6ee', text: '#b5406f', dot: '#d6548a', pillBg: '#fde6ee' },
  todo: { bg: '#ece9f8', text: '#6a5fc0', dot: '#7b6fd0', pillBg: '#e6e2f6' },
};

/** 알 수 없는 태그(서버가 새 태그를 추가했는데 앱이 아직 모를 때)에도 죽지 않도록 — 회색 틴트. */
export const TAG_TINT_FALLBACK = { bg: '#eef0f3', text: '#565e82', dot: '#a6acc4', pillBg: '#eef0f3' };
export const tagTint = (t: string) => (TAG_TINT as Record<string, typeof TAG_TINT_FALLBACK>)[t] ?? TAG_TINT_FALLBACK;

/**
 * 칩·목록 표시 순서 — 핸드오프 3a(본인·영업·부서·선택·차량) + 회의·면접(219) + 할 일(2026-11-03).
 * 칩 줄이 가로 스크롤이 되면서 '할 일'도 칩에 들어갔다(그전에는 375 폭 1행 7개 제한으로 목록에만 보였다).
 */
export const TAG_ORDER: CalendarTagKey[] = ['self', 'sales', 'dept', 'refs', 'vehicle', 'meeting', 'interview', 'todo'];
/** 목록 묶음 순서 — 칩 순서와 같다(호환 이름, 2026-11-03 부터 '할 일'이 TAG_ORDER 에 포함). */
export const TAG_LIST_ORDER: CalendarTagKey[] = [...TAG_ORDER];

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
  self: '#3B9CF5', // 밝은 파랑(2026-11-03, 웹과 동일)
  dept: '#70AD47',
  sales: '#ED7D31',
  refs: '#3B4FB8', // 남색(2026-11-03, 웹과 동일)
  vehicle: '#D4A017',
  meeting: '#2E9E8C',
  interview: '#D6548A',
  todo: '#7B6FD0',
};

export type CalendarKind = 'leave' | 'trip' | 'education' | 'sales' | 'vehicle' | 'meeting' | 'interview' | 'visit' | 'todo';

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  leave: '휴가',
  trip: '출장',
  education: '교육',
  sales: '영업',
  vehicle: '차량',
  meeting: '회의',
  interview: '면접',
  visit: '미팅',
  todo: '할 일',
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
  /** HH:mm (영업·직접 등록 일정) */
  startTime: string | null;
  /** HH:mm — 직접 등록 일정(회의·면접·미팅)만 */
  endTime?: string | null;
  /** 장소 — 직접 등록 일정(회의·면접·미팅)만 */
  location?: string | null;
  people: CalendarPerson[];
  summary: string | null;
  docId: string | null;
  salesProjectId?: string | null;
  /** 직접 등록 일정 id — 상세/편집 화면(/calendar-entry)으로 간다. */
  entryId?: string | null;
  canEdit?: boolean;
  /** 정기 회의 미시행 건 */
  canceled?: boolean;
  status: 'in_progress' | 'approved' | null;
}

/** 현재 사용자의 직접 등록 권한(서버 판정, /api/calendar 응답 access). */
export interface CalendarAccess {
  meeting: boolean;
  interview: boolean;
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

// ── 직접 등록 일정(회의·면접·미팅, 219) — 웹 lib/calendar/types.ts 사본 ──

export type CalendarEntryKind = 'meeting' | 'interview' | 'visit';

export const CALENDAR_ENTRY_KIND_LABELS: Record<CalendarEntryKind, string> = {
  meeting: '회의',
  interview: '면접',
  visit: '미팅',
};

/** 날짜 탭 시트의 직접 등록 선택지 — needs 는 access 의 키(없으면 누구나). */
export const ENTRY_ACTIONS: { kind: CalendarEntryKind; label: string; needs: keyof CalendarAccess | null; hint: string }[] = [
  { kind: 'meeting', label: '회의 일정 등록', needs: 'meeting', hint: '관리자·임원만 등록할 수 있습니다.' },
  { kind: 'interview', label: '면접 일정 등록', needs: 'interview', hint: '면접 관리자만 등록할 수 있습니다.' },
  { kind: 'visit', label: '미팅 일정 등록', needs: null, hint: '외부 손님·발주처 방문 미팅' },
];

export interface CalendarEntryResume {
  storageKey: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface CalendarEntryExtra {
  candidateName?: string;
  postingId?: string | null;
  postingTitle?: string;
  resume?: CalendarEntryResume | null;
  visitors?: string;
  contractId?: string | null;
  contractTitle?: string;
  topic?: string;
}

export interface CalendarEntry {
  entryId: string;
  kind: CalendarEntryKind;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  attendees: CalendarPerson[];
  note: string | null;
  extra: CalendarEntryExtra;
  ruleId: string | null;
  isModified: boolean;
  isCanceled: boolean;
  canEdit: boolean;
}

export interface CalendarEntryInput {
  kind: CalendarEntryKind;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  attendeeIds: string[];
  note: string | null;
  extra: CalendarEntryExtra;
  isCanceled?: boolean;
}
