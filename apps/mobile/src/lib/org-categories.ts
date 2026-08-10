/**
 * 주소록 연락처 구분(기관 유형) 상수 — `frontend/lib/directory-categories.ts` 의 복제본.
 * 값은 사업장(facilities.org_category)에 한글 라벨 **그대로** 저장되므로(코드값 == 라벨)
 * 웹 쪽 상수가 바뀌면 이 파일도 같이 고친다.
 * ⚠ "협회·조합" 의 가운뎃점(·)까지 문자열이 정확히 일치해야 매칭된다.
 */
export const ORG_CATEGORIES = ["공공기관", "공기업", "민간기업", "금융기관", "협력업체", "협회·조합"] as const;
export type OrgCategory = (typeof ORG_CATEGORIES)[number];

/** UI 전용 "미지정" 키 — org_category 가 NULL/빈값인 사업장. 서버로 보내지 않는다. */
export const UNCATEGORIZED = "__none__";
