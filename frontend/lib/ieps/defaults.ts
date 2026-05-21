import { BUILTIN_RULES } from "@scraper/lib/ieps/builtin-rules";
import type { CollectionConfig } from "./types";

export { BUILTIN_RULES };

export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  collectionRange: { mode: "preset", preset: "1y", startDate: null, endDate: null },
  filters: ["integratedFirst"],
  // 검토결과서(통합·변경허가). 갑지·허가결정 페이지가 보통 1~15p 안에 위치.
  extractionRange: { mode: "partial", startPage: 1, endPage: 15 },
  // 연간보고서. 사업장 개요(1p) + 주요 생산품·생산량(2p) 두 페이지면 사업장 데이터 추출에 충분.
  annualReportExtractionRange: { mode: "partial", startPage: 1, endPage: 2 },
  extractionRules: BUILTIN_RULES.map((r) => ({ ...r })),
  activeRuleIds: BUILTIN_RULES.map((r) => r.id),
};

/** 신규 필드(annualReportExtractionRange) 가 없는 과거 저장본을 디폴트로 보강한다. */
export function withDefaultsApplied(config: CollectionConfig): CollectionConfig {
  if (config.annualReportExtractionRange) return config;
  return {
    ...config,
    annualReportExtractionRange: { ...DEFAULT_COLLECTION_CONFIG.annualReportExtractionRange! },
  };
}

/**
 * 9개 빌트인 룰을 보존한 채 사용자 룰을 병합한다.
 * - 동일 id가 들어오면 사용자 정의가 빌트인을 덮어쓴다 (수정 가능).
 * - 빌트인에 없는 사용자 정의 룰은 뒤에 추가한다.
 */
export function mergeRulesWithBuiltin(
  userRules: CollectionConfig["extractionRules"]
): CollectionConfig["extractionRules"] {
  const byId = new Map<string, (typeof BUILTIN_RULES)[number]>();
  for (const rule of BUILTIN_RULES) byId.set(rule.id, { ...rule });
  for (const rule of userRules) byId.set(rule.id, { ...rule });
  return Array.from(byId.values());
}
