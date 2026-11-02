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
 * 플래그 활성 규칙 — 단가 계약은 외주 계약, 추가 지출은 정기 구독, 종량제는 임대 계약 중 복합기 렌트와
 * 관리 계약에서만 켤 수 있다. 비활성 플래그는 서버 저장 시 0 으로 강제한다(세부 설정은 후속).
 */
export interface PurchaseFlagAvailability {
  unitPrice: boolean;
  extraSpend: boolean;
  metered: boolean;
}

export function flagAvailability(type: string | null | undefined, category: string | null | undefined): PurchaseFlagAvailability {
  return {
    unitPrice: type === "outsourcing",
    extraSpend: type === "subscription",
    metered: (type === "lease" && category === "복합기 렌트") || type === "management",
  };
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
