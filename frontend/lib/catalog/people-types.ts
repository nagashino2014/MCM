/** 회사소개서 인물 공용 상수·타입 — 클라이언트 안전(DB 접근은 people.ts). */

/** 직접 입력 임원의 계약 구분 — 고문 등 근로계약 없이 자문(촉탁) 계약을 맺은 인물 */
export const EXTRA_EMPLOYMENT_TYPES = ["촉탁", "자문", "기타"] as const;

export interface CatalogExtraPerson {
  personId: string;
  name: string;
  roleLabel: string;
  employmentType: (typeof EXTRA_EMPLOYMENT_TYPES)[number];
  bioShort: string;
  career: string;
  photoAssetId: string | null;
  orderNo: number | null;
  isPublic: boolean;
  /** 임직원·임원 인원 수에 넣는지 */
  countInTotal: boolean;
}
