/**
 * 성과급 산정 — 클라이언트/서버 공용 상수·타입 (docs/bonus-calculation-blueprint.md)
 * DB 접근 코드는 targets.ts(서버 전용)에 둔다.
 */

export const GRADE_WEIGHTS: Record<string, number> = {
  A: 1.125,
  B: 1.0625,
  C: 1,
  D: 0.9375,
  E: 0.8875,
};

export type BonusCategoryKey = "integrated" | "chemical" | "haps" | "lab";

export const BONUS_CATEGORIES: Array<{ key: BonusCategoryKey; label: string }> = [
  { key: "integrated", label: "통합허가" },
  { key: "chemical", label: "화관법" },
  { key: "haps", label: "HAPs" },
  { key: "lab", label: "연구소" },
];

/** service_type 이 명확한 경우의 분류 매핑 */
export const SERVICE_TYPE_CATEGORY: Record<string, BonusCategoryKey> = {
  통합허가: "integrated",
  "장외&화관법": "chemical",
  HAPs: "haps",
};

/** 기타·ESG 등 service_type 으로 못 가르는 계약은 수행부서로 귀속(사용자 확정) */
export const DEPT_CATEGORY_FALLBACK: Record<string, BonusCategoryKey> = {
  "integrated-env-1": "integrated",
  "integrated-env-2": "integrated",
  "ulsan-branch": "integrated",
  "chemical-safety": "chemical",
  "carbon-neutral-lab": "lab",
};

/** 성과급 상세 산정 대상 본부(본부장 비율 입력 대상과 동일) */
export const BONUS_TARGET_DEPT_IDS = Object.keys(DEPT_CATEGORY_FALLBACK);

/** 본부장 비율 기본 활성 부서 — 연구소는 현재 본부장 비율 미운영(2026-08-13 사용자 확정, 체크박스로 토글) */
export const DEFAULT_DEPT_HEAD_ENABLED = Object.entries(DEPT_CATEGORY_FALLBACK)
  .filter(([, category]) => category !== "lab")
  .map(([deptId]) => deptId);

/** 용역별 참여도 산정에서 애초에 제외되는 부서(총괄·영업관리본부 — 유관부서/임원 명세로만 취급, 사용자 확정) */
export const BONUS_EXCLUDED_DEPT_IDS = ["exec", "sales-management"];

/** 임원 컷오프 — rank_order 82(연구소장) 이상은 참여인력 상세 산정 대상 제외(울산지사장 80은 포함) */
export const EXEC_RANK_CUTOFF = 82;

/** 참여자 신규 지정 시 기본 역할(기존 수행인력 관례) */
export const DEFAULT_PARTICIPANT_ROLE = "실무(정)";

export const GRADE_OPTIONS = ["A", "B", "C", "D", "E"] as const;

/** 인력 변동 종류(서비스 참여 변경 이력) 라벨 */
export const CHANGE_KIND_LABELS: Record<string, string> = {
  join: "합류",
  leave: "이탈",
  role_change: "역할 변경",
  replace: "교체",
};

export function resolveBonusCategory(
  serviceType: string | null,
  owningDeptId: string | null,
  deptKind: string | null
): BonusCategoryKey {
  if (deptKind === "lab") return "lab";
  if (serviceType && SERVICE_TYPE_CATEGORY[serviceType]) return SERVICE_TYPE_CATEGORY[serviceType];
  if (owningDeptId && DEPT_CATEGORY_FALLBACK[owningDeptId]) return DEPT_CATEGORY_FALLBACK[owningDeptId];
  // 수행부서 미지정 ESG탄소중립은 연구소 소관으로 본다(지정되면 위 부서 귀속이 우선).
  if (serviceType === "ESG탄소중립") return "lab";
  // 총괄·영업관리본부 등 매핑 외 부서가 수행부서인 예외 건은 통합허가 쪽에 노출해 누락을 막는다.
  return "integrated";
}

export interface BonusTargetStage {
  stageOrder: number;
  stageLabel: string;
  amount: number;
  invoiceAmount: number | null;
  invoiceIssued: boolean;
  issuedAt: string | null;
  /** 제비용 비례 반영액(전 단계 표시용) */
  netAmount: number;
  /** 이 반기 내 발행 여부 */
  inPeriod: boolean;
}

export interface BonusTargetRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string | null;
  contractDate: string | null;
  serviceType: string | null;
  owningDeptId: string | null;
  owningDeptName: string | null;
  category: BonusCategoryKey;
  contractAmount: number;
  outsourcingAmount: number;
  salesCostAmount: number;
  stages: BonusTargetStage[];
  /** 반기 적용금액 = Σ 반기 내 발행 단계의 제비용 반영액(발행액 우선) */
  appliedInPeriod: number;
}

export interface BonusEvalEntry {
  participationId: string;
  employeeId: string;
  employeeName: string;
  positionName: string | null;
  deptId: string | null;
  roleLabel: string;
  participationPct: number;
  grade: string | null;
}

export interface BonusEvalRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string | null;
  contractDate: string | null;
  category: BonusCategoryKey;
  owningDeptId: string | null;
  owningDeptName: string | null;
  /** 적용대상액 = 반기 발행액 − 제비용(비례) */
  appliedInPeriod: number;
  manager: BonusEvalEntry | null;
  participants: BonusEvalEntry[];
  /** 이 반기에 발생한 인력 변동 종류(join/leave/role_change/replace) */
  changeKinds: string[];
  finalized: boolean;
}

export interface BonusSettings {
  periodYear: number;
  periodHalf: "H1" | "H2";
  applyRate: number;
  contribSupportPct: number;
  contribExecPct: number;
  deptHeadRates: Record<string, number>;
  calcMethod: "base" | "salary" | "profit";
  /** 인건비 반영 산정 시 매출액 중 적용 비율(%) — null 이면 applyRate 사용 */
  salaryApplyRate: number | null;
  /** 인건비 반영 산정 시 반기 인건비 차감 배수(엑셀 성과산정액2=1.0 / 3=1.5) */
  salaryMultiplier: number;
  profitApplyRate: number | null;
  operatingProfit: number | null;
  absoluteGrading: boolean;
  gradeCaps: Record<string, number>;
  status: "draft" | "finalized";
  exists: boolean;
}
