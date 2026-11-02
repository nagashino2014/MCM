import { checkDateFields, dateFieldValue } from "@/lib/contracts/date-field";
import { flagAvailability, isPurchaseCategory, isPurchaseContractType, relatedContractMode } from "./options";

/**
 * 매입 계약 등록·수정 본문 검증(331) — 신규 모달과 상세 수정이 같은 규칙을 쓴다.
 *   · 유형은 4종, 분류는 유형별 목록에서만
 *   · 관련 매출 계약은 relatedContractMode 가 required 면 필수, hidden 이면 버린다
 *   · 비활성 플래그(flagAvailability)는 0 으로 강제한다(세부 설정은 후속)
 *   · 채우다 만 날짜는 date-field 규칙으로 거절
 */
export interface PurchaseContractInput {
  contractTitle: string;
  counterpartyFacilityId: string;
  contractType: string;
  contractCategory: string;
  relatedContractId: string | null;
  contractDate: string | null;
  completedAt: string | null;
  isUnitPrice: 0 | 1;
  hasExtraSpend: 0 | 1;
  isMetered: 0 | 1;
  accountCode: string | null;
  memo: string | null;
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

  const dateError = checkDateFields({ 계약일: body.contractDate, 준공일: body.completedAt });
  if (dateError) return { ok: false, error: dateError };

  const avail = flagAvailability(contractType, contractCategory);
  const flag = (v: unknown, enabled: boolean): 0 | 1 => (enabled && (v === true || v === 1 || v === "1") ? 1 : 0);

  return {
    ok: true,
    value: {
      contractTitle,
      counterpartyFacilityId,
      contractType,
      contractCategory,
      relatedContractId,
      contractDate: dateFieldValue(body.contractDate),
      completedAt: dateFieldValue(body.completedAt),
      isUnitPrice: flag(body.isUnitPrice, avail.unitPrice),
      hasExtraSpend: flag(body.hasExtraSpend, avail.extraSpend),
      isMetered: flag(body.isMetered, avail.metered),
      accountCode: String(body.accountCode ?? "").trim() || null,
      memo: String(body.memo ?? "").trim() || null,
    },
  };
}
