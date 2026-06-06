/**
 * 발주 주체 구분(계약상대 업체와 통합허가/용역 대상사업장 간의 관계) 옵션과
 * 대상사업장 입력 검증 로직을 신규 계약 입력 모달과 변경계약 모달에서 공유한다.
 */

export const ORDERING_SUBJECT_SITE_DIRECT = "SITE_DIRECT";
export const ORDERING_SUBJECT_PARENT_CORP = "PARENT_CORP";
export const ORDERING_SUBJECT_CONSIGNED_OPERATOR = "CONSIGNED_OPERATOR";

export const ORDERING_SUBJECT_OPTIONS = [
  { value: ORDERING_SUBJECT_SITE_DIRECT, label: "대상사업장 본인" },
  { value: ORDERING_SUBJECT_PARENT_CORP, label: "소속 법인·모회사" },
  { value: ORDERING_SUBJECT_CONSIGNED_OPERATOR, label: "위탁운영사" },
  { value: "THIRD_PARTY_PARTNER", label: "협력사(제3자)" },
  { value: "ETC", label: "기타" },
] as const;

export function getOrderingSubjectLabel(value: unknown): string {
  const key = String(value ?? "");
  return ORDERING_SUBJECT_OPTIONS.find((option) => option.value === key)?.label ?? "-";
}

/** 사업자등록번호에서 숫자만 추출해 포맷 차이를 무시하고 비교할 수 있게 한다. */
export function normalizeBrn(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9]/g, "");
}

interface OrderingValidationFacility {
  groupInfo?: { company?: { businessRegistrationNo?: string | null } | null } | null;
  operatingEntityInfo?: {
    entity?: { businessRegistrationNo?: string | null } | null;
    relation?: { relationType?: string | null } | null;
  } | null;
}

/**
 * 발주 주체 구분에 따라 대상사업장으로 선택하려는 사업장이 유효한지 검증한다.
 * - 소속 법인·모회사: 대상사업장의 그룹 연결 법인 사업자번호가 계약상대 업체와 일치해야 함
 * - 위탁운영사: 대상사업장의 운영 주체(운영 관계)가 계약상대 업체와 일치해야 함
 * - 그 외(협력사/기타/대상사업장 본인): 제약 없음
 */
export function validateOrderingTargetFacility(
  orderingSubjectType: string,
  facility: OrderingValidationFacility,
  counterpartyBrn: string | null | undefined
): { ok: boolean; message?: string } {
  const cp = normalizeBrn(counterpartyBrn);

  if (orderingSubjectType === ORDERING_SUBJECT_PARENT_CORP) {
    if (!cp) {
      return { ok: false, message: "계약상대 업체의 사업자등록번호가 없어 소속 법인·모회사 여부를 검증할 수 없습니다." };
    }
    const groupBrn = normalizeBrn(facility.groupInfo?.company?.businessRegistrationNo);
    if (!groupBrn || groupBrn !== cp) {
      return {
        ok: false,
        message: "계약상대 업체와의 관계 법인이 아닙니다. 대상사업장의 그룹 연결 법인이 계약상대 업체와 일치해야 합니다.",
      };
    }
    return { ok: true };
  }

  if (orderingSubjectType === ORDERING_SUBJECT_CONSIGNED_OPERATOR) {
    if (!cp) {
      return { ok: false, message: "계약상대 업체의 사업자등록번호가 없어 위탁 운영 여부를 검증할 수 없습니다." };
    }
    const opBrn = normalizeBrn(facility.operatingEntityInfo?.entity?.businessRegistrationNo);
    const relationType = facility.operatingEntityInfo?.relation?.relationType ?? "";
    if (!opBrn || opBrn !== cp || relationType !== "operating_entity") {
      return {
        ok: false,
        message: "위탁 운영 설정이 없는 사업장입니다. 대상사업장의 운영 주체가 계약상대 업체와 일치해야 합니다.",
      };
    }
    return { ok: true };
  }

  return { ok: true };
}
