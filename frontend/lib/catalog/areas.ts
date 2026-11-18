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

/**
 * 소개서에 분야를 늘어놓는 기본 순서(분야 번호) — 2026-11-18 사용자 지시 1-4-5-2-3-6.
 * 3개씩 두 줄로 놓이는 표지에서 통합환경허가-화학물질관리 · ESG·탄소중립-HAPs · 환경 인허가·연구·교육-응용소프트웨어가 위아래 짝이 된다.
 * 분야 번호(index)는 그대로 — 분야 색 area-n·지표 projects.area.n·쪽 키 area-n 은 순서와 무관하다.
 */
export const DEFAULT_AREA_ORDER: readonly number[] = [1, 4, 5, 2, 3, 6];

/** 분야 순서 정리 — 1~6 을 한 번씩 모두 담은 목록만 받는다(아니면 undefined = 기본 순서) */
export function sanitizeAreaOrder(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length !== CATALOG_CATEGORIES.length) return undefined;
  const out = v.map((x) => Number(x));
  const ok = out.every((n) => Number.isInteger(n) && n >= 1 && n <= CATALOG_CATEGORIES.length) && new Set(out).size === out.length;
  return ok ? out : undefined;
}

/** 분야 목록을 소개서 순서로 — order 가 없거나 잘못되면 기본 순서(DEFAULT_AREA_ORDER) */
export function orderAreas<T extends { index: number }>(areas: readonly T[], order?: readonly number[] | null): T[] {
  const seq = sanitizeAreaOrder(order) ?? DEFAULT_AREA_ORDER;
  const rank = (i: number) => {
    const r = seq.indexOf(i);
    return r < 0 ? seq.length + i : r;
  };
  return [...areas].sort((a, b) => rank(a.index) - rank(b.index));
}

/** 문서별 분야 이름 최대 글자 수 */
export const AREA_NAME_MAX = 30;

/**
 * 문서별 분야 이름 정리(사용자 요청 2026-11-18) — { "분야 번호": 이름 }. 빈 이름은 뺀다(= 기본 표기명).
 * 객체면 빈 객체라도 그대로 돌려준다 — 저장이 jsonb 덧붙이기(||)라 모두 지운 것을 {} 로 덮어써야 옛 이름이 남지 않는다.
 */
export function sanitizeAreaNames(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > CATALOG_CATEGORIES.length || typeof raw !== "string") continue;
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, AREA_NAME_MAX);
    if (name) out[String(n)] = name;
  }
  return out;
}

/**
 * 문서별 분야 이름을 렌더 데이터에 입힌다 — 분야 목록과 부록 총괄표 분류 이름. 이름이 없으면 기본 표기명(baseName).
 * 서버(render/data.ts)와 스튜디오(설정을 바꾸는 즉시 미리보기) 둘 다 쓴다.
 */
export function withAreaNames<
  D extends {
    areas: Array<{ index: number; name: string; baseName?: string }>;
    matrix?: Array<{ index: number; name: string }>;
    theme?: { areaNames?: Record<string, string> };
  },
>(data: D): D {
  const names = sanitizeAreaNames(data.theme?.areaNames) ?? {};
  const areas = data.areas.map((a) => ({ ...a, name: names[String(a.index)] ?? a.baseName ?? a.name }));
  const byIndex = new Map(areas.map((a) => [a.index, a.name]));
  return {
    ...data,
    areas,
    ...(data.matrix ? { matrix: data.matrix.map((s) => (byIndex.has(s.index) ? { ...s, name: byIndex.get(s.index)! } : s)) } : {}),
  };
}

/** 응용소프트웨어 제품(현재 공급 계약 없음 — 소개서는 제품 수를 보여 준다) */
// 2026-11-09 사용자 지시로 PDF 문서 레이아웃 복원앱·화관법 통합관리 플랫폼 추가(3 → 5종). render/master-content.ts SOFTWARE_CONTENT.products 와 같은 순서·이름
export const SOFTWARE_PRODUCTS = ["그룹웨어 & ERP", "통합허가 계획서 플랫폼", "ESG 통합관리 플랫폼", "PDF 문서 레이아웃 복원앱", "화관법 통합관리 플랫폼"] as const;

/** 응용소프트웨어 공급 계약 판정 — 계약의 서비스 유형(service_type)에 소프트웨어·SW·그룹웨어·ERP 가 들어가면. */
export function isSoftwareServiceType(serviceType: string | null | undefined): boolean {
  const v = String(serviceType ?? "");
  return /소프트웨어|그룹웨어|(^|[^A-Za-z])(SW|ERP)([^A-Za-z]|$)/i.test(v);
}
