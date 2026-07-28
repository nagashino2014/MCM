/**
 * 주소록 연락처 구분(기관 유형) 상수 — 서버(lib/directory.ts)·클라이언트 화면이 함께 쓴다.
 * 담당자 개인이 아니라 소속 사업장(facilities.org_category)의 속성이다.
 */
export const ORG_CATEGORIES = ["공공기관", "공기업", "민간기업", "금융기관", "협력업체", "협회·조합"] as const;
export type OrgCategory = (typeof ORG_CATEGORIES)[number];

export function isOrgCategory(v: unknown): v is OrgCategory {
  return typeof v === "string" && (ORG_CATEGORIES as readonly string[]).includes(v);
}
