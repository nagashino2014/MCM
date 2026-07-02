// 영업·마케팅 도메인 타입. 047 + 050 스키마 대응.

export type SalesStage = "lead" | "contact" | "proposal" | "bidding" | "won" | "lost" | "hold";
export type SalesActivityType =
  | "telemarketing" | "email" | "visit" | "site_briefing" | "quote" | "proposal_meeting" | "bid" | "result";
export type SalesActivityStatus = "planned" | "done" | "canceled";
export type SalesProjectStatus = "open" | "closed";
export type SalesProjectPriority = "low" | "normal" | "high";
export type SalesBidResult = "won_bid" | "lost_bid" | "rebid";
/** 활동 담당인력 역할: 정 / 부 / 입찰 / 참석자 */
export type ActivityAssigneeRole = "lead" | "deputy" | "bidding" | "attendee";

export const SALES_STAGE_LABELS: Record<SalesStage, string> = {
  lead: "리드",
  contact: "컨택",
  proposal: "제안",
  bidding: "입찰",
  won: "수주",
  lost: "실주",
  hold: "보류",
};

export const SALES_STAGE_ORDER: SalesStage[] = ["lead", "contact", "proposal", "bidding", "won", "lost", "hold"];

/** 일정명(모달 표시) ↔ 2글자 태그(활동이력 카드) ↔ 색상. SVG(영업스케쥴1.svg) 팔레트. */
export interface ActivityTypeMeta {
  code: SalesActivityType;
  label: string; // 모달 목록박스 표시명
  short: string; // 2글자 태그
  color: string; // 캘린더 바·태그 색
}

export const ACTIVITY_TYPES: ActivityTypeMeta[] = [
  { code: "telemarketing", label: "전화 마케팅", short: "전화", color: "#C9CDD6" },
  { code: "email", label: "홍보 메일 송신", short: "메일", color: "#A9D6D0" },
  { code: "visit", label: "사업장 방문", short: "미팅", color: "#F8CBAD" },
  { code: "site_briefing", label: "현장설명회 참석", short: "현설", color: "#FFE699" },
  { code: "quote", label: "견적서 제출", short: "견적", color: "#BDD7EE" },
  { code: "proposal_meeting", label: "제안발표회 참석", short: "제안", color: "#9DC3E6" },
  { code: "bid", label: "용역 투찰 기간", short: "투찰", color: "#C5E0B4" },
  { code: "result", label: "결과 발표", short: "결과", color: "#8FAADC" },
];

export const ACTIVITY_TYPE_META: Record<SalesActivityType, ActivityTypeMeta> = Object.fromEntries(
  ACTIVITY_TYPES.map((m) => [m.code, m])
) as Record<SalesActivityType, ActivityTypeMeta>;

/** 기존 호출부 호환용 — 모달 표시명 맵. */
export const SALES_ACTIVITY_TYPE_LABELS: Record<SalesActivityType, string> = Object.fromEntries(
  ACTIVITY_TYPES.map((m) => [m.code, m.label])
) as Record<SalesActivityType, string>;

export const SALES_BID_RESULT_LABELS: Record<SalesBidResult, string> = {
  won_bid: "낙찰",
  lost_bid: "탈락",
  rebid: "재투찰",
};

export const ASSIGNEE_ROLE_LABELS: Record<ActivityAssigneeRole, string> = {
  lead: "정",
  deputy: "부",
  bidding: "입찰",
  attendee: "참석자",
};

/** 프로젝트 관계자 역할(정/부/지원). 입찰 담당은 활동 단위에서만 지정. */
export const SALES_MEMBER_ROLES = ["정", "부", "지원"] as const;

export interface SalesProjectMember {
  id: number;
  projectId: string;
  employeeId: string;
  employeeName: string | null;
  roleLabel: string;
  createdAt: string;
}

export interface SalesProject {
  projectId: string;
  facilityId: string;
  facilityName: string | null;
  title: string;
  stage: SalesStage;
  ownerEmployeeId: string | null;
  ownerEmployeeName: string | null;
  ownerDeptId: string | null;
  contractId: string | null;
  expectedAmount: number | null;
  priority: SalesProjectPriority;
  status: SalesProjectStatus;
  openedAt: string | null;
  closedAt: string | null;
  memo: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  members?: SalesProjectMember[];
}

export interface SalesActivityContact {
  personId: number;
  personName: string | null;
  title: string | null;
}

export interface SalesActivityAssignee {
  employeeId: string;
  employeeName: string | null;
  roleKind: ActivityAssigneeRole;
}

/** 다차 견적 항목 */
export interface ActivityQuote {
  seq: number;
  amount: number | null;
  submittedAt: string | null;
}

/** 다차 투찰 항목 */
export interface ActivityBid {
  seq: number;
  amount: number | null;
  biddedAt: string | null;
}

export interface SalesActivityAttachment {
  attachmentId: string;
  activityId: string;
  displayName: string;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  storageProvider: string;
  storageKey: string;
  publicPath: string | null;
  createdAt: string;
}

export interface SalesActivity {
  activityId: string;
  projectId: string;
  activityType: SalesActivityType;
  status: SalesActivityStatus;
  scheduledAt: string | null;
  endedAt: string | null;
  occurredAt: string | null;
  place: string | null;
  summary: string | null;
  progressNote: string | null;
  quoteAmount: number | null;
  bidAmount: number | null;
  quotes: ActivityQuote[];
  bids: ActivityBid[];
  bidResult: SalesBidResult | null;
  color: string | null;
  authorEmployeeId: string | null;
  authorName: string | null;
  contacts?: SalesActivityContact[];
  assignees?: SalesActivityAssignee[];
  attachments?: SalesActivityAttachment[];
  createdAt: string;
  updatedAt: string;
}

/** 프로젝트 상세 하단 KPI 스트립 — sales_activities/projects 에서 파생 집계. */
export interface SalesProjectKpi {
  activityCounts: Record<SalesActivityType, number>;
  contactCount: number;
  isWon: boolean;
  contractCount: number;
  hasInvestmentPlan: boolean;
}

export interface SalesEmployeeOption {
  employeeId: string;
  name: string;
  deptId: string | null;
  deptName: string | null;
  positionName: string | null;
}

export interface SalesProjectFilter {
  facilityId?: string;
  stage?: SalesStage;
  ownerEmployeeId?: string;
  status?: SalesProjectStatus;
  q?: string;
}

export interface SalesProjectInput {
  facilityId: string;
  title: string;
  stage?: SalesStage;
  ownerEmployeeId?: string | null;
  ownerDeptId?: string | null;
  contractId?: string | null;
  expectedAmount?: number | null;
  priority?: SalesProjectPriority;
  status?: SalesProjectStatus;
  openedAt?: string | null;
  closedAt?: string | null;
  memo?: string | null;
}

export interface SalesActivityFilter {
  year?: number;
  activityType?: SalesActivityType;
  authorEmployeeId?: string;
  status?: SalesActivityStatus;
}

export interface SalesActivityInput {
  activityType: SalesActivityType;
  status?: SalesActivityStatus;
  scheduledAt?: string | null;
  endedAt?: string | null;
  occurredAt?: string | null;
  place?: string | null;
  summary?: string | null;
  progressNote?: string | null;
  quoteAmount?: number | null;
  bidAmount?: number | null;
  quotes?: ActivityQuote[];
  bids?: ActivityBid[];
  bidResult?: SalesBidResult | null;
  color?: string | null;
  authorEmployeeId?: string | null;
  contactPersonIds?: number[];
  assignees?: { employeeId: string; roleKind: ActivityAssigneeRole }[];
}
