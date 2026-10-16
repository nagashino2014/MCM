// 지출 목적 목록·연관 용역/사업장 규칙(2026-10-16) — 웹 frontend/lib/approval/expense-purpose.ts 와 같은 목록.
// ⚠ 한쪽을 바꾸면 다른 쪽도 함께 바꾼다(서버는 목록 밖 값을 버린다).
// 영수증 촬영은 8종 모두 고를 수 있다 — 출장 영수증은 출장보고서, 나머지는 지출결의서에 실린다.

export const TRIP_PURPOSES = ['출장 식대(일용비)', '출장 교통비', '출장 숙박비', '기타 출장 경비'] as const;
export const GENERAL_PURPOSES = ['초과근무 식대', '사무용품/비품 구입', '인쇄/제본비', '기타 수수료'] as const;
export const ALL_PURPOSES: readonly string[] = [...TRIP_PURPOSES, ...GENERAL_PURPOSES];

export const PURPOSE_HINTS: Record<string, string> = {
  '기타 출장 경비': '식대·교통비·숙박비 외 출장 중 쓴 경비 — 예: 주차료, 통행료, 현장 소모품 구입, 출장지 복사·출력비',
  '기타 수수료': '예: 택배 발송료, 우편 반송 수수료, 시설 수선료, 증명서 발급 수수료, 송금 수수료',
};

export const RELATED_REQUIRED_PURPOSES: readonly string[] = [...TRIP_PURPOSES, '초과근무 식대', '인쇄/제본비'];

export function purposeNeedsRelated(purpose: unknown): boolean {
  return RELATED_REQUIRED_PURPOSES.includes(String(purpose ?? '').trim());
}

export interface RelatedRef {
  label: string;
  contractId: string | null;
  facilityId: string | null;
}
