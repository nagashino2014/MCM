"use client";

import {
  FACILITY_SERVICE_COLORS,
  FACILITY_SERVICE_LABELS,
  FACILITY_SERVICE_ORDER,
  type FacilityServiceCategory,
} from "@/lib/ieps/facility-service";
import {
  PURCHASE_CONTRACT_TYPES,
  PURCHASE_TYPE_ORDER,
  PURCHASE_TYPE_STYLE,
  type PurchaseContractType,
} from "@/lib/contracts/purchase/options";

// 태그 바탕이 테마와 무관한 고정색이라 글자도 고정 진한색으로 둔다(다크에서 cd-text-muted 가 밝아져 읽히지 않던 문제).
const TAG_TEXT_COLOR = "#1f2430";

/**
 * 사업장 '계약 유형'(2026-11-03 사용자 요청) — 사업장 수동 등록·편집 양식이 공유한다.
 *   매출 계약: 기존 대상 용역 카테고리 5종(facility_service_categories), 태그 색 FACILITY_SERVICE_COLORS.
 *   매입 계약: 매입 계약 유형 4종(facilities.purchase_contract_types, 334), 태그 색은 PURCHASE_TYPE_STYLE.childColor
 *     (매출 통합허가·화관법·HAPs·ESG 태그 색과 같다).
 * 매출·매입 두 묶음을 한 줄에 나란히 두고(매입은 오른쪽), 폭이 모자라면 묶음 단위로 줄바꿈한다.
 */
export function FacilityContractTypeFields({
  serviceCategories,
  onServiceCategoriesChange,
  purchaseContractTypes,
  onPurchaseContractTypesChange,
}: {
  serviceCategories: FacilityServiceCategory[];
  onServiceCategoriesChange: (next: FacilityServiceCategory[]) => void;
  purchaseContractTypes: PurchaseContractType[];
  onPurchaseContractTypesChange: (next: PurchaseContractType[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-14 shrink-0 text-[11px] font-medium cd-text-faint">매출 계약</span>
        <div className="flex flex-wrap gap-2">
          {FACILITY_SERVICE_ORDER.map((category) => (
            <label key={category} className="flex items-center gap-1.5 text-xs font-semibold cd-text-muted">
              <input
                type="checkbox"
                checked={serviceCategories.includes(category)}
                onChange={(e) =>
                  onServiceCategoriesChange(
                    e.target.checked
                      ? [...serviceCategories, category]
                      : serviceCategories.filter((item) => item !== category)
                  )
                }
              />
              <span className="rounded-full px-2 py-0.5" style={{ background: FACILITY_SERVICE_COLORS[category], color: TAG_TEXT_COLOR }}>
                {FACILITY_SERVICE_LABELS[category]}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-14 shrink-0 text-[11px] font-medium cd-text-faint">매입 계약</span>
        <div className="flex flex-wrap gap-2">
          {PURCHASE_CONTRACT_TYPES.map((type) => (
            <label key={type.key} className="flex items-center gap-1.5 text-xs font-semibold cd-text-muted">
              <input
                type="checkbox"
                checked={purchaseContractTypes.includes(type.key)}
                onChange={(e) =>
                  onPurchaseContractTypesChange(
                    e.target.checked
                      ? PURCHASE_TYPE_ORDER.filter((t) => t === type.key || purchaseContractTypes.includes(t))
                      : purchaseContractTypes.filter((t) => t !== type.key)
                  )
                }
              />
              <span className="rounded-full px-2 py-0.5" style={{ background: PURCHASE_TYPE_STYLE[type.key].childColor, color: TAG_TEXT_COLOR }}>
                {type.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
