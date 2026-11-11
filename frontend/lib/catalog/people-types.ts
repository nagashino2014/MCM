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
  /** 임원진 카드 학력·자격(사용자관리에 없는 인물이라 직접 적는다, 354) */
  edu: string;
  cert: string;
  photoAssetId: string | null;
  /** 사진 게재 동의(355) — null 미확인 · true 동의 · false 거부. 임원이라 거부가 아니면 싣는다 */
  photoConsent: boolean | null;
  orderNo: number | null;
  isPublic: boolean;
  /** 임직원·임원 인원 수에 넣는지 */
  countInTotal: boolean;
}
