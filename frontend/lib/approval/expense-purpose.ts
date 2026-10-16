// 지출 목적 목록·연관 용역/사업장 규칙(2026-10-16 사용자 확정).
// 지출 목적은 자유 기입에서 정해진 목록으로 바뀌었다. 표에는 문자열 그대로 저장한다(경비정산이 detail 문자열을 대조한다).
//   · 출장보고서 지출내역 = 출장 4종만 / 지출결의서(법인카드·개인카드) = 나머지 4종만
//   · 모바일 영수증 등록은 8종 모두 — 출장 영수증이 출장보고서에 첨부될 수 있다.
//   · 출장 4종·초과근무 식대·인쇄/제본비는 연관 용역/사업장 필수, 사무용품/비품 구입·기타 수수료는 불필요.
// ⚠ 모바일(apps/mobile/src/lib/expense-purpose.ts)에 같은 목록이 있다 — 바꾸면 함께 바꾼다.

export const TRIP_PURPOSES = ["출장 식대(일용비)", "출장 교통비", "출장 숙박비", "기타 출장 경비"] as const;
export const GENERAL_PURPOSES = ["초과근무 식대", "사무용품/비품 구입", "인쇄/제본비", "기타 수수료"] as const;
export const ALL_PURPOSES: readonly string[] = [...TRIP_PURPOSES, ...GENERAL_PURPOSES];

/** 고르면 (?) 로 예시를 보여 주는 목적 */
export const PURPOSE_HINTS: Record<string, string> = {
  "기타 출장 경비": "식대·교통비·숙박비 외 출장 중 쓴 경비 — 예: 주차료, 통행료, 현장 소모품 구입, 출장지 복사·출력비",
  "기타 수수료": "예: 택배 발송료, 우편 반송 수수료, 시설 수선료, 증명서 발급 수수료, 송금 수수료",
};

/** 연관 용역/사업장을 반드시 적어야 하는 목적 */
export const RELATED_REQUIRED_PURPOSES: readonly string[] = [...TRIP_PURPOSES, "초과근무 식대", "인쇄/제본비"];

export function purposeNeedsRelated(purpose: unknown): boolean {
  return RELATED_REQUIRED_PURPOSES.includes(String(purpose ?? "").trim());
}

/** 양식 표 key 별 허용 목적 — 출장보고서 지출내역(trip_expenses)은 출장 4종, 그 외 지출 표는 일반 4종 */
export function purposesForTable(tableKey: string): readonly string[] {
  return tableKey === "trip_expenses" ? TRIP_PURPOSES : GENERAL_PURPOSES;
}

/** 표 행의 연관 용역/사업장 숨김 키 — 표시 문자열은 related 열에, ID 는 이 메타 키에 둔다 */
export const RELATED_CONTRACT_KEY = "_relatedContractId";
export const RELATED_FACILITY_KEY = "_relatedFacilityId";

export interface RelatedRef {
  /** 표시 문자열 — 용역이면 계약명, 사업장이면 사업장명 */
  label: string;
  contractId: string | null;
  facilityId: string | null;
}

/**
 * 영수증·카드 건의 연관 용역/사업장이 출장보고서의 용역/사업장과 다른지(2026-10-16 사용자 요청 — 불러올 때 경고).
 * 둘 다 용역이 있으면 용역끼리, 아니면 둘 다 사업장이 있을 때 사업장끼리 비교한다. 비교할 근거가 없으면 다르다고 보지 않는다.
 */
export function relatedMismatch(item: RelatedRef | null | undefined, trip: RelatedRef | null | undefined): boolean {
  if (!item || !trip) return false;
  if (item.contractId && trip.contractId) return item.contractId !== trip.contractId;
  if (item.facilityId && trip.facilityId) return item.facilityId !== trip.facilityId;
  return false;
}
