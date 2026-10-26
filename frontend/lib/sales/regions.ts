/*
 * 영업 지역권(클라이언트 안전 — DB 접근 없음).
 * Salesboard 목록의 지역권 태그 필터용. 권역 구분·명칭은 공공입찰 화면(lib/bid/bid-queries.ts REGION_GROUPS)의 7권과 같다.
 * 사업장 소재지 시도(facilities.region_sido)를 약칭으로 정규화(lib/catalog/regions.ts shortSido)한 뒤 권역으로 묶는다.
 */

import { shortSido } from "@/lib/catalog/regions";

export interface SalesRegionGroup {
  id: string;
  label: string;
  sido: string[];
}

export const SALES_REGION_GROUPS: SalesRegionGroup[] = [
  { id: "capital", label: "수도권", sido: ["서울", "경기", "인천"] },
  { id: "gangwon", label: "강원권", sido: ["강원"] },
  { id: "chungcheong", label: "충청권", sido: ["충남", "충북", "대전", "세종"] },
  { id: "gyeongbuk", label: "경북권", sido: ["경북", "대구"] },
  { id: "gyeongnam", label: "경남권", sido: ["경남", "부산", "울산"] },
  { id: "jeolla", label: "전라권", sido: ["전북", "전남", "광주"] },
  { id: "jeju", label: "제주권", sido: ["제주"] },
];

/** 시도를 알 수 없는 사업장(소재지 미입력 등). */
export const SALES_REGION_UNKNOWN = { id: "unknown", label: "미상" } as const;

/** 시도 원문(서울특별시·충청북도·경기 등) → 영업 지역권 id. 모르면 unknown. */
export function salesRegionGroupId(sido: string | null | undefined): string {
  const short = shortSido(sido);
  if (!short) return SALES_REGION_UNKNOWN.id;
  return SALES_REGION_GROUPS.find((g) => g.sido.includes(short))?.id ?? SALES_REGION_UNKNOWN.id;
}
