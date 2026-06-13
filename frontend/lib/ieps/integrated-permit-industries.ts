/**
 * 통합허가 대상 20개 업종 ↔ KSIC 업종코드 매핑.
 *
 * 분류 기준 출처:
 * - backend/app/ieps/integrated_permit_industries.py 의 TARGET_INDUSTRIES (KSIC 코드 매핑)
 * - frontend/app/(app)/contracts/downloads/page.tsx 의 INTEGRATED_PERMIT_INDUSTRIES (20개 카테고리)
 * 두 정의를 결합해 사업장 검색 필터의 "통합허가 기준" 카테고리로 사용한다.
 */
export interface IntegratedPermitIndustry {
  id: string;
  label: string;
  /** 5자리 KSIC 정확 일치 코드 */
  exactCodes: string[];
  /** KSIC prefix 일치 코드 (예: "241" → 241xx 전체) */
  prefixCodes: string[];
}

export const INTEGRATED_PERMIT_INDUSTRIES: IntegratedPermitIndustry[] = [
  { id: "power", label: "발전", exactCodes: [], prefixCodes: ["3511"] },
  { id: "steam-heat", label: "증기열공급", exactCodes: ["35300"], prefixCodes: [] },
  { id: "waste-incineration", label: "폐기물소각", exactCodes: ["38210", "38220"], prefixCodes: [] },
  { id: "steel", label: "철강", exactCodes: [], prefixCodes: ["241"] },
  { id: "nonferrous", label: "비철", exactCodes: [], prefixCodes: ["242"] },
  { id: "organic-chem", label: "유기", exactCodes: [], prefixCodes: ["2011", "203"] },
  { id: "oil-refining", label: "석유정제", exactCodes: [], prefixCodes: ["192"] },
  { id: "inorganic-chem", label: "무기화학", exactCodes: ["20131"], prefixCodes: ["2012"] },
  { id: "fine-chem", label: "정밀화학", exactCodes: ["20132"], prefixCodes: ["204"] },
  { id: "fertilizer", label: "비료", exactCodes: [], prefixCodes: ["202"] },
  { id: "pulp-paper", label: "종이·펄프", exactCodes: [], prefixCodes: ["171", "179"] },
  {
    id: "electronics",
    label: "전자부품",
    exactCodes: ["26221", "26929"],
    prefixCodes: ["2621", "2692"],
  },
  { id: "semiconductor", label: "반도체", exactCodes: [], prefixCodes: ["261"] },
  { id: "textile-dyeing", label: "섬유·염색", exactCodes: [], prefixCodes: ["134"] },
  { id: "slaughter-meat", label: "육류가공", exactCodes: [], prefixCodes: ["101"] },
  { id: "alcohol", label: "알콜음료", exactCodes: [], prefixCodes: ["111"] },
  { id: "plastics", label: "플라스틱", exactCodes: [], prefixCodes: ["222"] },
  { id: "auto-parts", label: "자동차부품", exactCodes: [], prefixCodes: ["303"] },
  { id: "cement", label: "시멘트", exactCodes: ["23311"], prefixCodes: [] },
  { id: "secondary-battery", label: "이차전지", exactCodes: ["28202", "28209"], prefixCodes: [] },
];

export function findIntegratedPermitIndustry(id: string): IntegratedPermitIndustry | null {
  return INTEGRATED_PERMIT_INDUSTRIES.find((entry) => entry.id === id) ?? null;
}

/** 단일 KSIC 코드가 카테고리에 속하는지 판단 */
export function industryCodeMatchesCategory(
  code: string,
  category: IntegratedPermitIndustry
): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  if (category.exactCodes.includes(trimmed)) return true;
  return category.prefixCodes.some((prefix) => trimmed.startsWith(prefix));
}
