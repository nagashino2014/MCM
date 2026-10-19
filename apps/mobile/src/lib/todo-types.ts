/*
 * 원본 frontend/lib/todo/types.ts — 동기화 유지(응답 타입·상수, DB·Next 의존 없음).
 * ⚠ 여기만 고치지 말 것 — 원본을 고친 뒤 이 파일로 다시 복제한다.
 */
/*
 * To-do · Kanban 공용 타입·상수 — 클라이언트 안전 모듈(DB·Next 의존 없음).
 * 서버(lib/todo/store.ts)·웹 화면·모바일 앱이 공유한다. 설계: docs/todo-kanban-blueprint.md §6.
 */

// ── 상태(전사 공통 고정 5종, §13-2) ──
export const TODO_STATUSES = ["todo", "doing", "review", "done", "hold"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  todo: "할 일",
  doing: "진행 중",
  review: "검토",
  done: "완료",
  hold: "보류",
};

// ── 우선순위(3단계+없음, §13-5) ──
export type TodoPriority = 0 | 1 | 2 | 3;
export const TODO_PRIORITY_LABELS: Record<TodoPriority, string> = {
  0: "없음",
  1: "낮음",
  2: "보통",
  3: "높음",
};

// ── 보드·멤버·공유·연결 ──
export const TODO_BOARD_KINDS = ["personal", "project", "dept", "shared"] as const;
export type TodoBoardKind = (typeof TODO_BOARD_KINDS)[number];
export const TODO_BOARD_KIND_LABELS: Record<TodoBoardKind, string> = {
  personal: "개인",
  project: "프로젝트",
  dept: "부서",
  shared: "공유",
};

export const TODO_BOARD_LAYOUTS = ["list", "board"] as const;
export type TodoBoardLayout = (typeof TODO_BOARD_LAYOUTS)[number];

/** 프로젝트 보드 생성 방식(§19-11) — 계약관리 용역 선택 · 프로젝트명/업체 직접 입력 · 자체 수행(발주처 없음). */
export const TODO_BOARD_MODES = ["contract", "manual", "internal"] as const;
export type TodoBoardMode = (typeof TODO_BOARD_MODES)[number];
export const TODO_BOARD_MODE_LABELS: Record<TodoBoardMode, string> = {
  contract: "계약관리 용역 선택",
  manual: "프로젝트명·업체 직접 입력",
  internal: "자체 수행 프로젝트",
};

// ── 보드 파스텔 색(§19-1) — 행·카드 좌측 4px 띠 + 맥락 줄 앞 점 ──
export const TODO_BOARD_COLORS = {
  lavender: "#CDACE6",
  mint: "#B9E4DC",
  rose: "#F9C9D9",
  lemon: "#F8F0CF",
  sky: "#D9E8F8",
  peach: "#FBE4D6",
  sage: "#DDF0D3",
  gray: "#e9ebf0", // 개인·내부(자체 수행) 기본
} as const;
export type TodoBoardColorKey = keyof typeof TODO_BOARD_COLORS;
export const TODO_BOARD_COLOR_KEYS = Object.keys(TODO_BOARD_COLORS) as TodoBoardColorKey[];
/** 자동 배정 대상(gray 제외) — 팔레트 순서. */
export const TODO_BOARD_AUTO_COLOR_KEYS: TodoBoardColorKey[] = ["lavender", "mint", "rose", "lemon", "sky", "peach", "sage"];
export const TODO_BOARD_COLOR_LABELS: Record<TodoBoardColorKey, string> = {
  lavender: "라벤더",
  mint: "민트",
  rose: "로즈",
  lemon: "레몬",
  sky: "하늘",
  peach: "피치",
  sage: "세이지",
  gray: "회색",
};

export const isTodoBoardColorKey = (v: unknown): v is TodoBoardColorKey =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(TODO_BOARD_COLORS, v);

/** 색 키 → hex. 키가 없으면 종류 기본(personal·내부 = gray, 그 외 = sky). */
export function todoBoardColorHex(color: string | null | undefined, kind?: TodoBoardKind | null): string {
  if (isTodoBoardColorKey(color)) return TODO_BOARD_COLORS[color];
  return kind && kind !== "personal" ? TODO_BOARD_COLORS.sky : TODO_BOARD_COLORS.gray;
}

/**
 * 새 보드 색 자동 배정 — 이미 쓰인 색 키 목록을 받아 가장 적게 쓰인 팔레트 색(gray 제외)을 순서대로 고른다.
 * 보드 수만큼 순환하는 것과 같되, 중간 삭제 뒤에도 치우치지 않는다.
 */
export function pickBoardColorKey(usedKeys: readonly (string | null | undefined)[]): TodoBoardColorKey {
  const counts = new Map<TodoBoardColorKey, number>();
  for (const k of TODO_BOARD_AUTO_COLOR_KEYS) counts.set(k, 0);
  for (const k of usedKeys) {
    if (isTodoBoardColorKey(k) && counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: TodoBoardColorKey = TODO_BOARD_AUTO_COLOR_KEYS[0];
  let min = Number.POSITIVE_INFINITY;
  for (const k of TODO_BOARD_AUTO_COLOR_KEYS) {
    const n = counts.get(k) ?? 0;
    if (n < min) {
      min = n;
      best = k;
    }
  }
  return best;
}

/** 결재 일정 종류 색(§19-1 TAG_COLOR) — 출장 살구·휴가 하늘·교육 연두·초과근무 노랑·결재 대기 파스텔 파랑, 그 외 민트. */
export const TODO_APPROVAL_COLORS: Record<string, string> = {
  trip: "#F8CBAD",
  leave: "#BDD7EE",
  education: "#C5E0B4",
  overtime: "#FFE699",
  pending: "#D9E8F8",
};
export const TODO_APPROVAL_DEFAULT_COLOR = "#B9E4DC";
export const todoApprovalColorHex = (kind: string): string => TODO_APPROVAL_COLORS[kind] ?? TODO_APPROVAL_DEFAULT_COLOR;

export const TODO_MEMBER_ROLES = ["admin", "member", "viewer"] as const;
export type TodoMemberRole = (typeof TODO_MEMBER_ROLES)[number];
export const TODO_MEMBER_ROLE_LABELS: Record<TodoMemberRole, string> = {
  admin: "관리자",
  member: "멤버",
  viewer: "열람",
};

export const TODO_SHARE_ROLES = ["assignee", "collaborator", "watcher"] as const;
export type TodoShareRole = (typeof TODO_SHARE_ROLES)[number];
export const TODO_SHARE_ROLE_LABELS: Record<TodoShareRole, string> = {
  assignee: "담당",
  collaborator: "협업(편집)",
  watcher: "참조(열람)",
};

export const TODO_LINK_KINDS = ["contract", "facility", "sales_project", "approval_doc", "work_task", "directive", "url", "mail", "chat"] as const;
export type TodoLinkKind = (typeof TODO_LINK_KINDS)[number];
export const TODO_LINK_KIND_LABELS: Record<TodoLinkKind, string> = {
  contract: "계약",
  facility: "사업장",
  sales_project: "영업",
  approval_doc: "결재 문서",
  work_task: "업무추진계획",
  directive: "지시",
  url: "링크",
  mail: "메일",
  chat: "메신저",
};

// ── 완료 조건(276, 2026-10-14) — 완료(status→done) 전에 검사. 검사 함수는 lib/todo/completion.ts(순수). ──
export interface TodoCompleteRules {
  /** 하위 작업이 모두 완료돼야 한다. */
  subtasks?: boolean;
  /** 선행 작업(288 의존)이 모두 완료돼야 한다. */
  deps?: boolean;
  /** 완료 메모를 입력해야 한다. */
  note?: boolean;
  /** 검토(review) 단계를 거쳐야 한다(reviewed_at 또는 현재 상태 review). */
  review?: boolean;
}
export const TODO_COMPLETE_RULE_KEYS = ["subtasks", "note", "review", "deps"] as const;
export type TodoCompleteRuleKey = (typeof TODO_COMPLETE_RULE_KEYS)[number];
export const TODO_COMPLETE_RULE_LABELS: Record<TodoCompleteRuleKey, string> = {
  subtasks: "하위 작업 모두 완료",
  note: "완료 메모 입력",
  review: "검토 단계 경유",
  deps: "선행 작업 모두 완료",
};
/** 접힘 요약·행 보조용 짧은 라벨. */
export const TODO_COMPLETE_RULE_SHORT_LABELS: Record<TodoCompleteRuleKey, string> = {
  subtasks: "하위 작업",
  note: "메모",
  review: "검토",
  deps: "선행",
};

export const TODO_MILESTONE_KINDS = ["pre_consult", "main_consult", "review_received", "meeting", "kickoff_report", "completion_report", "submit", "other"] as const;
export type TodoMilestoneKind = (typeof TODO_MILESTONE_KINDS)[number];
export const TODO_MILESTONE_LABELS: Record<TodoMilestoneKind, string> = {
  pre_consult: "사전협의 제출",
  main_consult: "본협의 제출",
  review_received: "검토결과서 수령",
  meeting: "미팅",
  kickoff_report: "착수보고",
  completion_report: "준공보고",
  submit: "제출",
  other: "기타",
};

export const TODO_ACTIVITY_ACTIONS = [
  "create", "update", "status", "assign", "due", "move", "share", "comment", "complete", "reopen", "snooze", "archive",
  "progress", "work_report",
] as const;
export type TodoActivityAction = (typeof TODO_ACTIVITY_ACTIONS)[number];

// ── 반복 프리셋(§6.1, 6종 + 연간) ──
export interface TodoRecurrencePreset {
  key: string;
  label: string;
  /** 규칙 문자열. 값이 필요한 프리셋(weekly·monthly·after)은 화면에서 채운다. */
  rule: string;
}
export const TODO_RECURRENCE_PRESETS: TodoRecurrencePreset[] = [
  { key: "daily", label: "매일", rule: "daily" },
  { key: "weekdays", label: "평일(월~금)", rule: "weekdays" },
  { key: "weekly", label: "매주 (요일 선택)", rule: "weekly:MO" },
  { key: "monthly", label: "매월 (일 선택)", rule: "monthly:1" },
  { key: "monthly_last", label: "매월 말일", rule: "monthly:last" },
  { key: "after", label: "완료 후 N일", rule: "after:7" },
];

/** 요일 코드(weekly 규칙) — 월요일부터. */
export const TODO_WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export const TODO_WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

// ── 알림 기본 규칙(§9) ──
export const TODO_DEFAULT_REMIND_ALL_DAY_TIME = "09:00";
export const TODO_DEFAULT_REMIND_BEFORE_MIN = 30;
export const TODO_DEFAULT_DIGEST_TIME = "08:30";
export const TODO_DEFAULT_DURATION_MIN = 30;
/** 완료 후 자동 보관까지의 일수. */
export const TODO_ARCHIVE_AFTER_DAYS = 30;

/** 스누즈 프리셋 — 분 단위. `tomorrow` 는 다음 날 종일 기본 시각(prefs). */
export const TODO_SNOOZE_PRESETS: { key: string; label: string; minutes: number | "tomorrow" }[] = [
  { key: "10m", label: "10분 뒤", minutes: 10 },
  { key: "1h", label: "1시간 뒤", minutes: 60 },
  { key: "3h", label: "3시간 뒤", minutes: 180 },
  { key: "tomorrow", label: "내일 아침", minutes: "tomorrow" },
];

// ── 사용자 설정 ──
export interface TodoPrefs {
  userId: string;
  defaultRemindAllDayTime: string; // HH:mm
  defaultRemindBeforeMin: number;
  digestTime: string | null; // null = 끔
  eveningReviewTime: string | null;
  quickAddParse: boolean;
  weekStart: 0 | 1;
  cardDensity: "comfortable" | "compact";
  showDoneDays: number;
  showApprovalEvents: boolean;
  /** 주간 리포트(295) — 서버 응답에만 있고 모바일은 아직 편집하지 않는다 */
  weeklyDigestDow?: number;
  weeklyDigestTime?: string | null;
  weeklyDigestMail?: boolean;
}

export const DEFAULT_TODO_PREFS: Omit<TodoPrefs, "userId"> = {
  defaultRemindAllDayTime: TODO_DEFAULT_REMIND_ALL_DAY_TIME,
  defaultRemindBeforeMin: TODO_DEFAULT_REMIND_BEFORE_MIN,
  digestTime: TODO_DEFAULT_DIGEST_TIME,
  eveningReviewTime: null,
  quickAddParse: true,
  weekStart: 1,
  cardDensity: "comfortable",
  showDoneDays: 7,
  showApprovalEvents: true,
};

// ── 응답 모델(camelCase) ──
export interface TodoUserRef {
  userId: string;
  name: string;
  /** 증명사진(employee_profiles.photo_public_path = /api/admin/employees/{employeeId}/photo). 없으면 null → 이니셜 아바타. */
  photoUrl: string | null;
}

export interface TodoShare {
  userId: string;
  name: string;
  photoUrl: string | null;
  role: TodoShareRole;
  addedBy: string | null;
  createdAt: string;
}

export interface TodoItem {
  itemId: string;
  boardId: string;
  columnId: string | null;
  parentItemId: string | null;
  title: string;
  note: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  doDate: string | null;
  doTime: string | null;
  durationMin: number | null;
  dueDate: string | null;
  allDay: boolean;
  remindAt: string | null;
  remindSentAt: string | null;
  snoozedUntil: string | null;
  recurrence: string | null;
  recurrenceParentId: string | null;
  position: string;
  linkKind: TodoLinkKind | null;
  linkId: string | null;
  linkLabel: string | null;
  color: string | null;
  ownerUserId: string;
  ownerName: string | null;
  ownerPhotoUrl: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assigneePhotoUrl: string | null;
  /** 보드 파생(§19-11) — 할 일은 보드의 용역·발주처·색을 물려받는다. */
  boardName: string;
  boardKind: TodoBoardKind;
  /** 보드 색 hex(키 → TODO_BOARD_COLORS, 없으면 종류 기본). */
  boardColor: string;
  /** 용역/프로젝트명 — 보드 값, 없고 개인 보드 할 일이 link_kind=contract 면 contracts.contract_title. */
  projectName: string | null;
  /** 발주처명 — 보드 값, 없으면 연결 계약의 계약상대 업체명. */
  clientName: string | null;
  /** 보드 contract_id, 없으면 link_kind=contract 의 link_id. */
  contractId: string | null;
  completedAt: string | null;
  completedBy: string | null;
  /** 완료 조건(276). 빈 객체 = 조건 없음(즉시 완료). */
  completeRules: TodoCompleteRules;
  /** 완료 메모(규칙 note 가 켜져 있으면 완료 시 필수). */
  completionNote: string | null;
  /** 상태가 review 로 바뀐 시각(ISO) — 규칙 review 의 근거. */
  reviewedAt: string | null;
  /** 하위 작업 진척(285, §25-2) — 진행율·진척 내용·공정 단계 매핑. 상위 작업은 쓰지 않는다. */
  progressPct: number | null;
  progressNote: string | null;
  stageOrder: number | null;
  progressUpdatedAt: string | null;
  /** 기간 일정(287) do_date~end_date · 하위 마일스톤 실제 일자·종류 */
  endDate: string | null;
  actualDate: string | null;
  milestoneKind: TodoMilestoneKind | null;
  /** 미완료 선행 작업 수(288 의존) — 0 이면 대기 아님. */
  openDeps: number;
  archivedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  /** 하위 작업 집계(목록 응답). */
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  /** 현재 사용자 기준 편집 가능 여부(서버 판정). */
  canEdit: boolean;
  isOwner: boolean;
}

/** 관련 대상(계약/업무추진계획 Task)의 공정표 단계(§25-2·25-3). */
export interface TodoStageRef {
  stageOrder: number;
  stageName: string;
  status: "pending" | "in_progress" | "done";
  progressPct: number;
  progressUnitPct: number;
}

export interface TodoItemDetail extends TodoItem {
  subtasks: TodoItem[];
  shares: TodoShare[];
  comments: TodoComment[];
  activity: TodoActivity[];
  /** 하위 작업 평균 진행율(하위 없으면 null). */
  progressAvg: number | null;
  stages: TodoStageRef[];
  reportSubject: "contract" | "task" | null;
}

// ── 선행·후행 의존(288, §28-3) — item_id=후행, depends_on_item_id=선행. 응답은 /api/todo/items/:id/deps ──
export interface TodoDepRef {
  itemId: string;
  title: string;
  status: TodoStatus;
  doDate: string | null;
  dueDate: string | null;
  endDate: string | null;
  assigneeName: string | null;
  boardName: string | null;
  parentItemId: string | null;
  /** 현재 사용자가 볼 수 있는지(아니면 제목만 "비공개 할 일") */
  visible: boolean;
}

export interface TodoDeps {
  /** 이 할 일이 기다리는 선행 */
  blockedBy: TodoDepRef[];
  /** 이 할 일을 기다리는 후행 */
  blocks: TodoDepRef[];
  /** 미완료 선행 수 */
  openBlockers: number;
}

export interface TodoColumn {
  columnId: string;
  boardId: string;
  name: string;
  position: string;
  statusMap: TodoStatus | null;
  wipLimit: number | null;
  collapsed: boolean;
}

export interface TodoBoardMember {
  userId: string;
  name: string;
  photoUrl: string | null;
  role: TodoMemberRole;
  addedBy: string | null;
  createdAt: string;
}

export interface TodoBoard {
  boardId: string;
  name: string;
  kind: TodoBoardKind;
  ownerUserId: string;
  /** dept: dept_id. project 는 contractId 를 쓴다(scope_ref 미사용). */
  scopeRef: string | null;
  isDefault: boolean;
  layout: TodoBoardLayout;
  columnStatusMap: boolean;
  /** 프로젝트(용역) 속성(§19-11). personal·dept·shared 는 보통 null. */
  projectName: string | null;
  clientName: string | null;
  contractId: string | null;
  facilityId: string | null;
  /** 파스텔 색 키(TODO_BOARD_COLORS). null = 종류 기본색. */
  color: TodoBoardColorKey | null;
  /** color 를 hex 로 푼 값(화면 편의). */
  colorHex: string;
  /** 보드 기본 완료 조건(276) — 이 보드에서 만든 할 일에 생성 시 복사된다. */
  defaultCompleteRules: TodoCompleteRules;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  columns: TodoColumn[];
  /** 현재 사용자의 보드 역할(owner 는 admin). */
  myRole: TodoMemberRole;
  memberCount: number;
}

/** POST /api/todo/boards 입력(§19-11). kind 기본 shared, mode 는 kind=project 일 때만 의미. */
export interface TodoBoardCreateInput {
  kind?: TodoBoardKind;
  /** project: contract = 계약관리 용역 선택(contractId 필수) · manual = 프로젝트명 필수·업체 선택 · internal = 자체 수행(발주처 없음). */
  mode?: TodoBoardMode;
  contractId?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  facilityId?: string | null;
  color?: TodoBoardColorKey | null;
  /** 보드 이름 — contract 모드는 비우면 용역명, 그 외 project 는 비우면 projectName. dept·shared 는 필수. */
  name?: string | null;
  layout?: TodoBoardLayout;
  columnStatusMap?: boolean;
  /** 초기 멤버(user_id). contract 모드는 수행인력이 자동 추가된다. */
  memberIds?: string[];
  /** dept 전용 — 부서 id(없으면 만든 사람의 부서). */
  scopeRef?: string | null;
  /** 보드 기본 완료 조건(276). */
  defaultCompleteRules?: TodoCompleteRules | null;
}

/** PATCH /api/todo/boards/[id] 입력 — owner·보드 admin(·todo.admin, 개인 보드 제외). */
export interface TodoBoardPatchInput {
  name?: string;
  layout?: TodoBoardLayout;
  columnStatusMap?: boolean;
  archived?: boolean;
  projectName?: string | null;
  clientName?: string | null;
  contractId?: string | null;
  facilityId?: string | null;
  color?: TodoBoardColorKey | null;
  /** 보드 기본 완료 조건(276) — 객체 전체를 바꾼다. */
  defaultCompleteRules?: TodoCompleteRules | null;
}

/** GET /api/todo/boards/contract-candidates?q= 응답 행 — 프로젝트 보드 만들기(계약 선택) 검색용. */
export interface TodoContractCandidate {
  contractId: string;
  contractTitle: string;
  counterpartyFacilityId: string | null;
  counterpartyName: string;
  facilityId: string | null;
  facilityName: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  contractStatus: string;
  contractDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** 현재 사용자가 수행인력(service_participants)인지. */
  isParticipant: boolean;
  /** 이 계약으로 이미 만든(보관 안 된) 프로젝트 보드 id — 중복 생성 안내용. */
  existingBoardId: string | null;
}

export interface TodoComment {
  commentId: string;
  itemId: string;
  userId: string;
  userName: string | null;
  userPhotoUrl: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface TodoActivity {
  activityId: string;
  itemId: string;
  userId: string | null;
  userName: string | null;
  action: TodoActivityAction;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * 결재 일정 읽기 전용 행(§11) — 내 할 일 날짜 섹션에 회색으로 끼워 넣는다.
 * kind "pending" = 내가 결재할 차례인 문서(결재 대기, 2026-10-13 확정) — 일정이 아니라 오늘(KST) 한 건으로 들어오며
 * 결재 일정 토글과 무관하게 항상 보인다. id "pend:<docId>", startDate=endDate=오늘, formName·docNo·submittedAt 이 채워진다.
 */
export interface TodoApprovalEvent {
  id: string;
  kind: "leave" | "trip" | "education" | "overtime" | "sales" | "vehicle" | "meeting" | "interview" | "visit" | "pending";
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  docId: string | null;
  status: "in_progress" | "approved" | null;
  /** 결재 연계(§19-12) — 문서의 계약 필드(contract_select {contractId}) 또는 계약명 텍스트로 식별한 계약. 없으면 null. */
  contractId: string | null;
  projectName: string | null;
  clientName: string | null;
  /** 종류 색 hex(TODO_APPROVAL_COLORS). */
  kindColor: string;
  /** 기안자 — 보드 모드(멤버 전원의 문서)에서 누구 일정인지 표시. 결재 대기 행은 담당 열에 기안자 아바타. */
  drafterUserId: string | null;
  drafterName: string | null;
  /** 기안자 증명사진(결재 대기 행에서만 채움, 없으면 null → 이니셜). */
  drafterPhotoUrl: string | null;
  /** 결재 대기(kind=pending) 전용 — 양식명·문서번호·상신 시각(ISO). 그 외 종류는 null. */
  formName: string | null;
  docNo: string | null;
  submittedAt: string | null;
}

export const TODO_APPROVAL_EVENT_LABELS: Record<TodoApprovalEvent["kind"], string> = {
  leave: "휴가",
  trip: "출장",
  education: "교육",
  overtime: "초과근무",
  sales: "영업",
  vehicle: "차량",
  meeting: "회의",
  interview: "면접",
  visit: "미팅",
  pending: "결재 대기",
};

/** 결재 대기 행인지(일정이 아닌 "내 차례" 문서). */
export const isPendingApproval = (ev: Pick<TodoApprovalEvent, "kind">): boolean => ev.kind === "pending";

/** 상세 링크 — 푸시·메신저 공유 공용. */
export const todoItemLink = (itemId: string): string => `/todo?item=${encodeURIComponent(itemId)}`;
