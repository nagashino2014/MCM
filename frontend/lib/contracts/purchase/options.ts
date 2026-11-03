import type { ServiceTypeStyle } from "@/lib/ieps/contract-tree-style";

/**
 * 매입 계약 유형·분류 옵션(2026-11-02 사용자 요청) — 신규 입력 모달·서버 검증·트리 그룹이 공유하는 단일 원천.
 * 매출 계약의 CONTRACT_SERVICE_OPTIONS(lib/contracts/service-options.ts)와 같은 역할이며, 매출과 달리
 * 유형(contract_type)은 고정 4종이고 분류(contract_category)는 유형별 목록에서만 고른다.
 */
export type PurchaseContractType = "outsourcing" | "subscription" | "lease" | "management";

export interface PurchaseContractTypeOption {
  key: PurchaseContractType;
  label: string;
  categories: readonly string[];
}

export const PURCHASE_CONTRACT_TYPES: readonly PurchaseContractTypeOption[] = [
  {
    key: "outsourcing",
    label: "외주 계약",
    categories: ["도면 작성", "산업안전 관련", "측정·분석", "디자인", "광고", "컨설팅·자문", "사무실 개·보수"],
  },
  { key: "subscription", label: "정기 구독", categories: ["SW구독", "서적 구독"] },
  { key: "lease", label: "임대 계약", categories: ["부동산 임대", "차량 렌트", "복합기 렌트", "비데·정수기 렌트"] },
  { key: "management", label: "관리 계약", categories: ["사무실 관리비"] },
];

export const PURCHASE_TYPE_ORDER: readonly PurchaseContractType[] = PURCHASE_CONTRACT_TYPES.map((t) => t.key);

export function purchaseTypeLabel(type: string | null | undefined): string {
  return PURCHASE_CONTRACT_TYPES.find((t) => t.key === type)?.label ?? String(type ?? "");
}

export function isPurchaseContractType(value: unknown): value is PurchaseContractType {
  return typeof value === "string" && (PURCHASE_TYPE_ORDER as readonly string[]).includes(value);
}

export function purchaseCategoriesOf(type: string | null | undefined): readonly string[] {
  return PURCHASE_CONTRACT_TYPES.find((t) => t.key === type)?.categories ?? [];
}

export function isPurchaseCategory(type: string | null | undefined, category: unknown): boolean {
  return typeof category === "string" && purchaseCategoriesOf(type).includes(category);
}

/**
 * 관련 매출 계약 입력 규칙 — 외주 계약 중 도면 작성·산업안전 관련·측정·분석은 필수, 디자인은 선택,
 * 그 외 유형·분류는 입력란 자체를 숨긴다.
 */
export type RelatedContractMode = "required" | "optional" | "hidden";

const RELATED_REQUIRED = new Set(["도면 작성", "산업안전 관련", "측정·분석"]);
const RELATED_OPTIONAL = new Set(["디자인"]);

export function relatedContractMode(type: string | null | undefined, category: string | null | undefined): RelatedContractMode {
  if (type !== "outsourcing" || !category) return "hidden";
  if (RELATED_REQUIRED.has(category)) return "required";
  if (RELATED_OPTIONAL.has(category)) return "optional";
  return "hidden";
}

/**
 * 플래그 활성 규칙(2026-11-03 2차) — 단가 계약은 외주 계약, 추가 지출은 정기 구독, 종량제는 임대 계약 중
 * 복합기 렌트·비데·정수기 렌트와 관리 계약에서만 켤 수 있다. 관리 계약은 종량제가 항상 켜진다(flagForced).
 * 비활성 플래그는 서버 저장 시 0 으로, 강제 플래그는 1 로 맞춘다.
 */
export interface PurchaseFlagAvailability {
  unitPrice: boolean;
  extraSpend: boolean;
  metered: boolean;
}

const METERED_LEASE_CATEGORIES = new Set(["복합기 렌트", "비데·정수기 렌트"]);

export function flagAvailability(type: string | null | undefined, category: string | null | undefined): PurchaseFlagAvailability {
  return {
    unitPrice: type === "outsourcing",
    extraSpend: type === "subscription",
    metered: (type === "lease" && !!category && METERED_LEASE_CATEGORIES.has(category)) || type === "management",
  };
}

/** 항상 켜져 있어야 하는 플래그 — 관리 계약(사무실 관리비)은 매월 청구액이 달라지므로 종량제 고정. */
export function flagForced(type: string | null | undefined): Partial<PurchaseFlagAvailability> {
  return type === "management" ? { metered: true } : {};
}

/* ─── 유형별 라벨·입력 모드(2026-11-03 사용자 요청) ─── */

/** 계약금액 입력 방식 — 외주는 단계 합계(읽기 전용), 정기 구독은 월 구독료 직접 입력, 임대·관리는 비해당. */
export type PurchaseAmountMode = "milestone_sum" | "manual" | "disabled";

export function amountMode(type: string | null | undefined): PurchaseAmountMode {
  if (type === "outsourcing") return "milestone_sum";
  if (type === "subscription") return "manual";
  return "disabled";
}

export function amountLabel(type: string | null | undefined): string {
  return type === "subscription" ? "정기 구독료" : "계약금액";
}

export function amountHint(type: string | null | undefined): string {
  const mode = amountMode(type);
  if (mode === "manual") return "1개월 기준 구독료";
  if (mode === "disabled") return "비해당 유형";
  return "청구·수금 단계 합계";
}

/** 계약일 라벨 — 관리 계약은 납부시작일. */
export function startDateLabel(type: string | null | undefined): string {
  return type === "management" ? "납부시작일" : "계약일";
}

/** 준공일 라벨 — 정기 구독 '계약 종료일', 임대 '계약만료일', 관리 '납부종료일'. */
export function endDateLabel(type: string | null | undefined): string {
  if (type === "subscription") return "계약 종료일";
  if (type === "lease") return "계약만료일";
  if (type === "management") return "납부종료일";
  return "준공일";
}

/* ─── 모달 탭 구성 ─── */

export type PurchaseTabKey = "basic" | "ratecard" | "milestones" | "extra" | "leaseDetail" | "metered" | "feeStatus" | "document";

export interface PurchaseTabState {
  contractType: string;
  contractCategory: string;
  isUnitPrice: boolean;
  hasExtraSpend: boolean;
  isMetered: boolean;
}

/**
 * 유형·분류·계약 조건에 따른 탭 목록(순서 고정).
 *   외주: 상세 → [단가 계약] → 청구·수금 단계 → 계약서 PDF
 *   정기 구독: 상세 → [추가 지출] → 계약서 PDF
 *   임대: 상세 → 분류 탭(부동산 임대/차량 렌트/복합기 렌트/비데·정수기 렌트) → [종량제 요금 추이] → 계약서 PDF
 *   관리: 상세 → 납부 현황 (계약서 없음 — 매월 관리비 명세서를 납부 현황에서 올린다)
 */
export function purchaseTabsFor(state: PurchaseTabState): Array<{ key: PurchaseTabKey; label: string }> {
  const tabs: Array<{ key: PurchaseTabKey; label: string }> = [{ key: "basic", label: "계약 상세정보" }];
  const type = state.contractType;
  if (type === "outsourcing") {
    if (state.isUnitPrice) tabs.push({ key: "ratecard", label: "단가 계약" });
    tabs.push({ key: "milestones", label: "청구·수금 단계" });
    tabs.push({ key: "document", label: "계약서 PDF" });
  } else if (type === "subscription") {
    if (state.hasExtraSpend) tabs.push({ key: "extra", label: "추가 지출" });
    tabs.push({ key: "document", label: "계약서 PDF" });
  } else if (type === "lease") {
    tabs.push({ key: "leaseDetail", label: state.contractCategory || "임대 상세" });
    if (state.isMetered && flagAvailability(type, state.contractCategory).metered) tabs.push({ key: "metered", label: "종량제 요금 추이" });
    tabs.push({ key: "document", label: "계약서 PDF" });
  } else if (type === "management") {
    tabs.push({ key: "feeStatus", label: "납부 현황" });
  }
  return tabs;
}

/* ─── 월별 금액 종류 ─── */

export type PurchaseMonthlyKind = "extra_spend" | "metered" | "management_fee";

export const PURCHASE_MONTHLY_KINDS: readonly PurchaseMonthlyKind[] = ["extra_spend", "metered", "management_fee"];

export function isPurchaseMonthlyKind(v: unknown): v is PurchaseMonthlyKind {
  return typeof v === "string" && (PURCHASE_MONTHLY_KINDS as readonly string[]).includes(v);
}

/** 유형별로 쓸 수 있는 월별 종류 — 정기 구독=추가 지출, 임대(종량제)=종량제 요금, 관리=관리비. */
export function monthlyKindFor(type: string | null | undefined): PurchaseMonthlyKind | null {
  if (type === "subscription") return "extra_spend";
  if (type === "lease") return "metered";
  if (type === "management") return "management_fee";
  return null;
}

/* ─── 임대 상세 선택 목록 ─── */

export const COPIER_MAKERS = ["신도리코", "캐논", "엡손", "삼성"] as const;
export const COPIER_LOCATIONS = ["본사(1208호)", "본사(1207호)", "본사(1026호)", "울산지사"] as const;
export const PURIFIER_MAKERS = ["청호나이스", "코웨이", "쿠쿠"] as const;
export const PURIFIER_LOCATIONS = ["탕비실", "대표이사실", "화장실"] as const;
export const LEASE_SPECIAL_TERMS_MAX = 5;

/* ─── 계정과목(유형별 허용 목록·분류별 기본값) ─── */

/**
 * 매입 계약에 지정할 수 있는 계정과목(2026-11-03 사용자 요청) — 전체 계정과목이 아니라 유형별로 추린 비용 계정만.
 * 자산 계정(240 소프트웨어·962 임차보증금 등)은 뺀다: 매입계산서 인식(lib/finance/transaction-links.ts)이 비용 계정만
 * 받고, 보증금은 부동산 임대 탭의 보증금 항목으로 따로 적는다.
 */
export const PURCHASE_ACCOUNT_CODES: Record<PurchaseContractType, readonly string[]> = {
  outsourcing: ["852", "831", "833", "826", "820"], // 외주용역비·지급수수료·광고선전비·도서인쇄비·수선비
  subscription: ["831", "826", "814"], // 지급수수료·도서인쇄비·통신비
  lease: ["819", "822", "830", "831"], // 임차료(리스포함)·차량유지비·소모품비·지급수수료
  management: ["837", "815", "816", "817"], // 건물관리비·수도광열비·전력비·세금과공과금
};

const DEFAULT_ACCOUNT_BY_CATEGORY: Record<string, string> = {
  "도면 작성": "852",
  "산업안전 관련": "852",
  "측정·분석": "852",
  "컨설팅·자문": "831",
  광고: "833",
  디자인: "826",
  "사무실 개·보수": "820",
  SW구독: "831",
  "서적 구독": "826",
  "부동산 임대": "819",
  "차량 렌트": "822",
  "복합기 렌트": "819",
  "비데·정수기 렌트": "819",
  "사무실 관리비": "837",
};

export function purchaseAccountCodesOf(type: string | null | undefined): readonly string[] {
  return isPurchaseContractType(type) ? PURCHASE_ACCOUNT_CODES[type] : [];
}

export function isPurchaseAccountAllowed(type: string | null | undefined, code: string | null | undefined): boolean {
  return !!code && purchaseAccountCodesOf(type).includes(code);
}

export function defaultPurchaseAccount(type: string | null | undefined, category: string | null | undefined): string {
  const code = category ? DEFAULT_ACCOUNT_BY_CATEGORY[category] : undefined;
  return code && isPurchaseAccountAllowed(type, code) ? code : (purchaseAccountCodesOf(type)[0] ?? "");
}

/**
 * 트리 아이콘 색 — 매출 원장(lib/ieps/contract-tree-style.ts STYLE_TABLE)의 5색과 겹치지 않는 4색.
 * 부모는 진한 톤, 자식은 같은 계열의 옅은 톤(Office "Accent + Lighter 40%" 짝)으로 매출 트리와 같은 규칙.
 */
// 2026-11-02 사용자 지정 순서: 외주 계약 보라 → 정기 구독 민트 → 임대 계약 노랑 → 관리 계약 오렌지(밝은 톤).
export const PURCHASE_TYPE_STYLE: Record<PurchaseContractType, ServiceTypeStyle> = {
  outsourcing: { parentColor: "#8E7CC3", childColor: "#B4A7D6" },
  subscription: { parentColor: "#2FC58F", childColor: "#9CE8CA" },
  lease: { parentColor: "#F5C518", childColor: "#FBE28A" },
  management: { parentColor: "#FF8C42", childColor: "#FFC49B" },
};

export const PURCHASE_FALLBACK_STYLE: ServiceTypeStyle = { parentColor: "#7F7F7F", childColor: "#BFBFBF" };

export function resolvePurchaseTypeStyle(type: string | null | undefined): ServiceTypeStyle {
  return isPurchaseContractType(type) ? PURCHASE_TYPE_STYLE[type] : PURCHASE_FALLBACK_STYLE;
}

export const PURCHASE_PAYMENT_METHOD_OPTIONS = ["현금", "카드", "자동이체", "어음"] as const;
