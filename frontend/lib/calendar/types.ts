/*
 * 일정 메뉴(G6-C, /calendar) 공용 타입·상수 — 클라이언트 안전 모듈(DB 의존 없음).
 * 서버 조회(lib/calendar/queries.ts)와 화면(components/calendar/*)이 공유한다.
 */

/**
 * 캘린더 태그(카테고리) 7종 — 홈 위젯(lib/home/widgets.ts CALENDAR_TAGS)은 앞 5종만 쓴다.
 * meeting(회의)·interview(면접)는 직접 등록 일정(219, lib/calendar/entries.ts).
 * 미팅(visit)은 별도 태그가 없고 참석자가 본인/부서/선택 집합에 있으면 그 태그로 표시된다.
 */
export const CALENDAR_TAG_KEYS = ["self", "dept", "sales", "refs", "vehicle", "meeting", "interview"] as const;
export type CalendarTagKey = (typeof CALENDAR_TAG_KEYS)[number];

export const CALENDAR_TAG_LABELS: Record<CalendarTagKey, string> = {
  self: "본인",
  dept: "부서",
  sales: "영업",
  refs: "선택",
  vehicle: "차량",
  meeting: "회의",
  interview: "면접",
};

/**
 * 태그별 색 — 홈 위젯·일정 메뉴·자산 캘린더 공용(단일 소스).
 * 영업 스케줄 상세 캘린더(SVG 영업스케쥴1 팔레트, lib/sales/types.ts ACTIVITY_TYPES)와
 * 같은 밝은 파스텔 계열 — 시맨틱 토큰(primary 등)은 캘린더에서 칙칙하다는 피드백으로 교체.
 * 파스텔 원색을 배경으로 쓰고 글자는 진한 잉크(#1f2937)로 — color-mix 감쇄 금지(흐려짐).
 */
export const TAG_COLOR: Record<CalendarTagKey, string> = {
  self: "#BDD7EE", // 하늘
  dept: "#C5E0B4", // 연두
  sales: "#F8CBAD", // 살구
  refs: "#CDACE6", // 라일락
  vehicle: "#FFE699", // 노랑
  meeting: "#B9E4DC", // 민트
  interview: "#F9C9D9", // 핑크
};

/** 파스텔 태그 배경 위 글자색(영업 캘린더와 동일한 진한 잉크). */
export const TAG_INK = "#1f2937";

/**
 * 태그별 진한 대응색 — 칩 테두리·도트용. 파스텔(TAG_COLOR)은 배경에 쓰면 테두리·도트가
 * 배경과 같은 색이라 묻힌다는 피드백 → 같은 색상 계열의 채도 높은 버전으로 구분한다.
 */
export const TAG_COLOR_STRONG: Record<CalendarTagKey, string> = {
  self: "#5B9BD5",
  dept: "#70AD47",
  sales: "#ED7D31",
  refs: "#9966CC",
  vehicle: "#D4A017",
  meeting: "#2E9E8C",
  interview: "#D6548A",
};

/** 일정 종류 — 스케줄명 조립 규칙의 단위. */
export type CalendarKind = "leave" | "trip" | "education" | "sales" | "vehicle" | "meeting" | "interview" | "visit";

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  leave: "휴가",
  trip: "출장",
  education: "교육",
  sales: "영업",
  vehicle: "차량",
  meeting: "회의",
  interview: "면접",
  visit: "미팅",
};

export interface CalendarPerson {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
}

/**
 * 통합 일정 이벤트 — 제목(스케줄명)은 서버에서 규칙대로 조립돼 내려온다.
 *   휴가 "[휴가종류]:[휴가자]" / 출장 "[출장지]:[용역분류]" / 교육 "[교육명]"
 *   영업 "[2글자 약어]:[업체명]" / 차량 "[출장지]:[차종명]"
 *   회의 "[회의명]" / 면접 "면접 : [면접자]" / 미팅 "미팅 : [방문자]"
 */
export interface CalendarEvent {
  /** "doc:{docId}:trip" | "doc:{docId}:vehicle" | "act:{activityId}" | "ledg:{entryId}" | "ent:{entryId}" */
  id: string;
  tag: CalendarTagKey;
  kind: CalendarKind;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (당일이면 start 와 동일)
  startTime: string | null; // HH:mm (영업·직접 등록 일정)
  /** HH:mm — 직접 등록 일정(회의·면접·미팅)만. */
  endTime?: string | null;
  /** 대상 인원 — 휴가는 제목에 이미 이름이 있어 빈 배열. */
  people: CalendarPerson[];
  summary: string | null;
  /** 연관 전자결재 문서 — 본인(self) 카드의 문서 진입 링크에 쓴다. */
  docId: string | null;
  /** 영업 활동의 프로젝트 — 영업 카드에서 스케줄 상세 관리 화면(/sales/[projectId]) 링크에 쓴다. */
  salesProjectId?: string | null;
  /** 직접 등록 일정(회의·면접·미팅)의 id — 카드에서 상세/편집 모달을 연다. */
  entryId?: string | null;
  /** 직접 등록 일정을 현재 사용자가 편집·삭제할 수 있는지(서버 판정). */
  canEdit?: boolean;
  /** 정기 회의 미시행 건(캘린더 바에는 안 그리고 목록에만 흐리게). */
  canceled?: boolean;
  status: "in_progress" | "approved" | null;
}

/** '선택' 태그 대상 조건 — 저장은 조건, 조회 시 인원으로 확장(인사이동 자동 반영). */
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
  tags: ["self", "dept"],
  refs: { employeeIds: [], deptIds: [], all: false },
};

// ── 직접 등록 일정(회의·면접·미팅, 마이그 219) ──

export type CalendarEntryKind = "meeting" | "interview" | "visit";

export const CALENDAR_ENTRY_KIND_LABELS: Record<CalendarEntryKind, string> = {
  meeting: "회의",
  interview: "면접",
  visit: "미팅",
};

/** 면접 이력서 첨부(PDF) — 참석자·면접 관리자만 열람. */
export interface CalendarEntryResume {
  storageKey: string;
  fileName: string;
  contentType: string;
  size: number;
}

/** 종류별 부가 정보(calendar_entries.extra). */
export interface CalendarEntryExtra {
  // 면접
  candidateName?: string;
  postingId?: string | null;
  postingTitle?: string;
  resume?: CalendarEntryResume | null;
  // 미팅
  visitors?: string;
  contractId?: string | null;
  contractTitle?: string;
  /** 관련 업무(용역이 없을 때 자유 입력) */
  topic?: string;
}

export interface CalendarEntry {
  entryId: string;
  kind: CalendarEntryKind;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm
  endTime: string | null;
  location: string | null;
  attendees: CalendarPerson[];
  note: string | null;
  extra: CalendarEntryExtra;
  /** 정기 회의 규칙에서 생성된 건이면 규칙 id */
  ruleId: string | null;
  occurrenceKey: string | null;
  isModified: boolean;
  isCanceled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

/** 등록·수정 입력(클라이언트 → 서버). 참석자는 employee_id 목록. */
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
  /** 정기 회의 occurrence 를 "미시행"으로 표시(회의만). */
  isCanceled?: boolean;
}

/** 정기 회의 규칙 — "매월 n번째 요일" 방식. weeks=[1,3] 이면 첫째·셋째 해당 요일. */
export interface CalendarMeetingRule {
  ruleId: string;
  name: string;
  weekday: number; // 0=일 … 6=토
  weeks: number[]; // 1~5
  startTime: string;
  endTime: string;
  location: string | null;
  attendeeIds: string[];
  attendees: CalendarPerson[];
  isActive: boolean;
  sortOrder: number;
}

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;
export const WEEK_ORDINAL_LABELS = ["첫째", "둘째", "셋째", "넷째", "다섯째"] as const;

/** 현재 사용자의 직접 등록 권한(서버 판정, /api/calendar 응답에 동봉). */
export interface CalendarAccess {
  /** 회의 등록·편집·정기 규칙 설정(관리자·임원) */
  meeting: boolean;
  /** 면접 등록·편집(면접 관리자) */
  interview: boolean;
}
