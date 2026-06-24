// 업무보고 공통 상수.

/** 회의 종류(보고작성·감독 공통 select 옵션). */
export const MEETING_LABELS = ["주간회의", "간부간담회"] as const;

/** 용역 대분류(감독 필터 체크박스) ↔ contracts.service_type 값 매핑. */
export const SERVICE_CATEGORIES: { label: string; value: string }[] = [
  { label: "통합허가", value: "통합허가" },
  { label: "화관법", value: "장외&화관법" },
  { label: "HAPs", value: "HAPs" },
  { label: "ESG/탄소중립", value: "ESG탄소중립" },
  { label: "기타", value: "기타" },
];

/** 부서장 의견 분류. supplement·correction 은 반려 대상. */
export const REVIEW_COMMENT_KINDS: { value: string; label: string }[] = [
  { value: "amend", label: "의견 첨삭" },
  { value: "supplement", label: "보완 요구" },
  { value: "correction", label: "오기 정정 요청" },
];

/** 반려 가능한 의견 분류(이 분류 선택 시 '반려' 버튼 노출). */
export const REJECTABLE_KINDS = ["supplement", "correction"];

/** 임원 검토 지시 분류. */
export const EXEC_DIRECTIVE_KINDS: { value: string; label: string }[] = [
  { value: "supplement_request", label: "보완 요구" },
  { value: "expedite", label: "진행 촉구" },
  { value: "additional_report", label: "추가보고 지시" },
  { value: "opinion", label: "의견" },
];

/** 지시하달이 활성화되는 분류(‘의견’은 기록만, 하달 비활성). */
export const EXEC_DIRECTIVE_ACTIONABLE = ["supplement_request", "expedite", "additional_report"];
