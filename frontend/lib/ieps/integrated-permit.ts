/*
 * 통합허가 업종/세분류 필터 공용 유틸 — 다운로드/증명서 화면과 입찰 서류 생성(실적 계약 선택)이
 * 공유한다. (downloads/page.tsx 에서 추출 — 동작 불변)
 *
 * 업종 목록·키워드 대조는 단일 원천(permit_industries, lib/ieps/integrated-permit-industries.ts)으로 합쳤다(325).
 */

export { matchesIndustryText, normalizeFilterText } from "@/lib/ieps/integrated-permit-industries";

export function canonicalServiceSubtype(value: string | null): string {
  return value === "통합허가" ? "최초허가" : (value ?? "");
}
