/**
 * 계약 관리 5대 분류 — 클라이언트 안전 상수(DB 접근 없음).
 * 판정 SQL 은 contracts.ts categoryCaseSql. 회사소개서 부록·사업 분야(lib/catalog)도 이 목록을 그대로 쓴다.
 */
export const DASHBOARD_SERVICE_CATEGORIES = [
  "통합환경허가",
  "장외·화관법",
  "HAPs 용역",
  "ESG·탄소중립",
  "기타 용역",
] as const;
