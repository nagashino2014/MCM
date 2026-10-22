/** 회사소개서 고객사(로고 월) 공용 상수·타입 — 클라이언트 안전(DB 접근은 clients.ts). */
export const CLIENT_CATEGORIES = ["공공", "민간", "협회"] as const;
export type ClientCategory = (typeof CLIENT_CATEGORIES)[number];

export interface CatalogClient {
  clientId: string;
  facilityId: string | null;
  name: string;
  category: ClientCategory;
  logoAssetId: string | null;
  orderNo: number;
  isPublic: boolean;
  /** 연결된 거래처의 누적 계약 수(정렬·후보 판단용) */
  contractCount: number;
}

export interface ClientCandidate {
  facilityId: string;
  name: string;
  contractCount: number;
  lastContractDate: string;
}
