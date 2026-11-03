import { checkDateFields, dateFieldValue } from "@/lib/contracts/date-field";
import {
  amountMode,
  endDateLabel,
  flagAvailability,
  flagForced,
  isPurchaseAccountAllowed,
  isPurchaseCategory,
  isPurchaseContractType,
  relatedContractMode,
  startDateLabel,
} from "./options";
import { normalizeTypeDetails, type PurchaseTypeDetails } from "./type-details";

/**
 * 매입 계약 등록·수정 본문 검증(331·333) — 신규 모달과 변경계약 입력이 같은 규칙을 쓴다.
 *   · 유형은 4종, 분류는 유형별 목록에서만
 *   · 관련 매출 계약은 relatedContractMode 가 required 면 필수, hidden 이면 버린다
 *   · 비활성 플래그(flagAvailability)는 0 으로, 강제 플래그(flagForced: 관리 계약 종량제)는 1 로
 *   · 계약금액은 정기 구독(월 구독료)만 본문에서 받는다. 외주는 단계 합계, 임대·관리는 비해당(null)
 *   · 계정과목은 유형별 허용 목록(PURCHASE_ACCOUNT_CODES) 안에서만
 *   · 유형별 상세(typeDetails)는 분류에 맞는 키 하나로 정규화(차량 렌트는 차종 필수)
 *   · 채우다 만 날짜는 date-field 규칙으로 거절
 */
export interface PurchaseContractInput {
  contractTitle: string;
  counterpartyFacilityId: string;
  contractType: string;
  contractCategory: string;
  relatedContractId: string | null;
  contractAmount: number | null;
  contractDate: string | null;
  completedAt: string | null;
  isUnitPrice: 0 | 1;
  hasExtraSpend: 0 | 1;
  isMetered: 0 | 1;
  accountCode: string | null;
  memo: string | null;
  typeDetails: PurchaseTypeDetails;
}

export type PurchaseInputResult = { ok: true; value: PurchaseContractInput } | { ok: false; error: string };

export function parsePurchaseContractInput(body: Record<string, unknown>): PurchaseInputResult {
  const contractTitle = String(body.contractTitle ?? "").trim();
  const counterpartyFacilityId = String(body.counterpartyFacilityId ?? "").trim();
  const contractType = String(body.contractType ?? "").trim();
  const contractCategory = String(body.contractCategory ?? "").trim();
  if (!contractTitle) return { ok: false, error: "계약명은 필수입니다." };
  if (!counterpartyFacilityId) return { ok: false, error: "계약상대 업체는 필수입니다." };
  if (!isPurchaseContractType(contractType)) return { ok: false, error: "계약 유형을 선택해 주세요." };
  if (!isPurchaseCategory(contractType, contractCategory)) return { ok: false, error: "계약 분류가 선택한 계약 유형의 목록에 없습니다." };

  const mode = relatedContractMode(contractType, contractCategory);
  const relatedRaw = String(body.relatedContractId ?? "").trim();
  if (mode === "required" && !relatedRaw) {
    return { ok: false, error: `${contractCategory} 외주 계약은 관련 매출 계약을 입력해야 합니다.` };
  }
  const relatedContractId = mode === "hidden" ? null : relatedRaw || null;

  const dateError = checkDateFields({ [startDateLabel(contractType)]: body.contractDate, [endDateLabel(contractType)]: body.completedAt });
  if (dateError) return { ok: false, error: dateError };

  const avail = flagAvailability(contractType, contractCategory);
  const forced = flagForced(contractType);
  const flag = (v: unknown, enabled: boolean, force?: boolean): 0 | 1 =>
    force ? 1 : enabled && (v === true || v === 1 || v === "1") ? 1 : 0;

  let contractAmount: number | null = null;
  if (amountMode(contractType) === "manual") {
    const raw = body.contractAmount;
    if (raw != null && raw !== "") {
      const num = Number(String(raw).replace(/,/g, ""));
      if (!Number.isFinite(num) || num < 0) return { ok: false, error: "정기 구독료는 0 이상의 숫자여야 합니다." };
      contractAmount = num;
    }
  }

  const accountCode = String(body.accountCode ?? "").trim() || null;
  if (accountCode && !isPurchaseAccountAllowed(contractType, accountCode)) {
    return { ok: false, error: "선택한 계정과목은 이 계약 유형에서 쓸 수 없습니다." };
  }

  const typeDetails = normalizeTypeDetails(contractType, contractCategory, body.typeDetails);
  if (typeDetails.vehicle && !typeDetails.vehicle.name) {
    return { ok: false, error: "차량 렌트 계약은 차종을 입력해야 합니다(자산관리 차량으로 등록됩니다)." };
  }

  return {
    ok: true,
    value: {
      contractTitle,
      counterpartyFacilityId,
      contractType,
      contractCategory,
      relatedContractId,
      contractAmount,
      contractDate: dateFieldValue(body.contractDate),
      completedAt: dateFieldValue(body.completedAt),
      isUnitPrice: flag(body.isUnitPrice, avail.unitPrice),
      hasExtraSpend: flag(body.hasExtraSpend, avail.extraSpend),
      isMetered: flag(body.isMetered, avail.metered, forced.metered),
      accountCode,
      memo: String(body.memo ?? "").trim() || null,
      typeDetails,
    },
  };
}
