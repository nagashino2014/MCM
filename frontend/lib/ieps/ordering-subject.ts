/**
 * 발주 주체 구분(계약상대 업체와 통합허가/용역 대상사업장 간의 관계) 옵션과
 * 대상사업장 입력 검증 로직을 신규 계약 입력 모달과 변경계약 모달에서 공유한다.
 */

export const ORDERING_SUBJECT_SITE_DIRECT = "SITE_DIRECT";
export const ORDERING_SUBJECT_PARENT_CORP = "PARENT_CORP";
export const ORDERING_SUBJECT_CONSIGNED_OPERATOR = "CONSIGNED_OPERATOR";
// EPC사(2026-08-26) — 발전소·폐기물처리시설 공사 일체를 맡은 시공 총괄사가 발주하는 계약.
// 대상사업장과 법인·운영 관계가 없으므로 대상사업장 선택 제약은 두지 않는다.
export const ORDERING_SUBJECT_EPC = "EPC";

export const ORDERING_SUBJECT_OPTIONS = [
  { value: ORDERING_SUBJECT_SITE_DIRECT, label: "대상사업장 본인" },
  { value: ORDERING_SUBJECT_PARENT_CORP, label: "소속 법인·모회사" },
  { value: ORDERING_SUBJECT_CONSIGNED_OPERATOR, label: "위탁운영사" },
  { value: ORDERING_SUBJECT_EPC, label: "EPC사(설계·조달·시공)" },
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

export interface OrderingTargetFacilitySearchItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  integratedPermitTarget?: string | null;
}

/**
 * 계약상대 업체 사업자번호로 사업장 마스터를 찾는다. 검색 API는 문자열 LIKE
 * 기반이므로 `416-13-89078`/`4161389078` 저장 형태 차이를 모두 커버하도록
 * 원문, 숫자만, 3-2-5 포맷을 순차 조회하고 최종 비교는 숫자만으로 수행한다.
 */
export async function findFacilityByBusinessRegistrationNo(
  businessRegistrationNo: string | null | undefined,
  signal?: AbortSignal,
  /**
   * 동일 사업자번호 복수 사업장 대응(2026-08-24, 케이지스틸 실사례 — 인천·당진공장이
   * 법인 번호를 공유해 이름순 첫 일치(당진)가 잡히던 문제). 번호가 일치하는 후보가
   * 여럿이면 계약상대 업체 자신(facilityId) → 상호 정확 일치 순으로 우선 선택한다.
   */
  prefer?: { facilityId?: string | null; companyName?: string | null }
): Promise<OrderingTargetFacilitySearchItem | null> {
  const original = (businessRegistrationNo ?? "").trim();
  const digits = normalizeBrn(original);
  if (!digits) return null;

  const formatted = digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : "";
  const queries = Array.from(new Set([original, formatted, digits].filter(Boolean)));

  const preferName = (prefer?.companyName ?? "").trim();
  for (const q of queries) {
    const params = new URLSearchParams({ q, limit: "20", sort: "name" });
    const res = await fetch(`/api/facilities?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) continue;
    const json = (await res.json()) as { items?: OrderingTargetFacilitySearchItem[] };
    const matches = (json.items ?? []).filter(
      (item) => normalizeBrn(item.businessRegistrationNo) === digits
    );
    if (!matches.length) continue;
    return (
      (prefer?.facilityId ? matches.find((m) => m.facilityId === prefer.facilityId) : undefined) ??
      (preferName ? matches.find((m) => (m.companyName ?? "").trim() === preferName) : undefined) ??
      matches[0]
    );
  }

  return null;
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
 * - 그 외(EPC사/협력사/기타/대상사업장 본인): 제약 없음
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
