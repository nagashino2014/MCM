/*
 * 회사소개서 사업 분야 — 클라이언트 안전 상수.
 * 1~5 = 계약 관리 5분류(categoryCaseSql) 그대로(D11), 6 = 응용소프트웨어(사용자 지시 10-22, 소개서 전용 분야).
 * 응용소프트웨어는 계약 관리 분류에 넣지 않았다 — 계약 Dashboard·수주/수금 화면이 5분류를 전제로 하므로,
 * 소개서에서만 서비스 유형으로 공급 계약을 골라 6번째 분야로 센다(그 계약은 계약 관리에서는 '기타 용역' 등 원래 분류).
 * 제품: 그룹웨어 & ERP · 통합허가 계획서 플랫폼 · ESG 통합관리 플랫폼(309 catalog_business_areas.products).
 */
import { DASHBOARD_SERVICE_CATEGORIES } from "@/lib/ieps/contract-categories";

export const SOFTWARE_CATEGORY = "응용소프트웨어";

export const CATALOG_CATEGORIES = [...DASHBOARD_SERVICE_CATEGORIES, SOFTWARE_CATEGORY] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/** 분야 번호(1~6) — 디자인 시스템 분야 색 area-1..6, 지표 projects.area.N 과 같은 번호 */
export function areaIndex(category: string): number {
  const i = (CATALOG_CATEGORIES as readonly string[]).indexOf(category);
  return i < 0 ? 0 : i + 1;
}

/** 응용소프트웨어 제품(현재 공급 계약 없음 — 소개서는 제품 수를 보여 준다) */
export const SOFTWARE_PRODUCTS = ["그룹웨어 & ERP", "통합허가 계획서 플랫폼", "ESG 통합관리 플랫폼"] as const;

/** 응용소프트웨어 공급 계약 판정 — 계약의 서비스 유형(service_type)에 소프트웨어·SW·그룹웨어·ERP 가 들어가면. */
export function isSoftwareServiceType(serviceType: string | null | undefined): boolean {
  const v = String(serviceType ?? "");
  return /소프트웨어|그룹웨어|(^|[^A-Za-z])(SW|ERP)([^A-Za-z]|$)/i.test(v);
}
