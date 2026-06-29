// 영업·마케팅 P1 도메인 타입. 047_sales_projects.sql 스키마 대응.

export type SalesStage = "lead" | "contact" | "proposal" | "bidding" | "won" | "lost" | "hold";
export type SalesActivityType =
  | "telemarketing" | "call" | "visit" | "meeting" | "email" | "quote" | "bid" | "contract_signed" | "other";
export type SalesActivityStatus = "planned" | "done" | "canceled";
export type SalesProjectStatus = "open" | "closed";
export type SalesProjectPriority = "low" | "normal" | "high";

export const SALES_STAGE_LABELS: Record<SalesStage, string> = {
  lead: "리드",
  contact: "컨택",
  proposal: "제안",
  bidding: "입찰",
  won: "수주",
  lost: "실주",
  hold: "보류",
};

// 칸반 컬럼 순서(진행 중 → 종결).
export const SALES_STAGE_ORDER: SalesStage[] = ["lead", "contact", "proposal", "bidding", "won", "lost", "hold"];

export const SALES_ACTIVITY_TYPE_LABELS: Record<SalesActivityType, string> = {
  telemarketing: "텔레마케팅",
  call: "유선",
  visit: "방문",
  meeting: "미팅",
  email: "이메일",
  quote: "견적",
  bid: "입찰",
  contract_signed: "계약 체결",
  other: "기타",
};

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
  occurredAt: string | null;
  place: string | null;
  summary: string | null;
  quoteAmount: number | null;
  bidAmount: number | null;
  authorEmployeeId: string | null;
  authorName: string | null;
  contacts?: SalesActivityContact[];
  attachments?: SalesActivityAttachment[];
  createdAt: string;
  updatedAt: string;
}

/** 프로젝트 상세 하단 KPI 스트립 — sales_activities/projects 에서 파생 집계. */
export interface SalesProjectKpi {
  activityCounts: Record<SalesActivityType, number>; // done 활동 유형별 횟수
  contactCount: number;        // 이 영업건에서 접촉한 distinct 담당자 수
  isWon: boolean;              // stage = won
  contractCount: number;       // 연결된 계약 수(0/1)
  hasInvestmentPlan: boolean;  // 투자계획 유무 — P4(DART/뉴스 발굴) 연동 전까지 false
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

export interface SalesEmployeeOption {
  employeeId: string;
  name: string;
  deptId: string | null;
  deptName: string | null;
  positionName: string | null;
}

export interface SalesActivityInput {
  activityType: SalesActivityType;
  status?: SalesActivityStatus;
  scheduledAt?: string | null;
  occurredAt?: string | null;
  place?: string | null;
  summary?: string | null;
  quoteAmount?: number | null;
  bidAmount?: number | null;
  authorEmployeeId?: string | null;
  contactPersonIds?: number[];
}
