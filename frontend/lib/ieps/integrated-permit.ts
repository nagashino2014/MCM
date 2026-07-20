/*
 * 통합허가 업종/세분류 필터 공용 유틸 — 다운로드/증명서 화면과 입찰 서류 생성(실적 계약 선택)이
 * 공유한다. (downloads/page.tsx 에서 추출 — 동작 불변)
 */

// 라벨 = 수집 설정(통합허가 대상 업종)의 20개 태그명과 동일(lib/ieps/integrated-permit-industries.ts).
// keywords 는 구 계약 업종 명칭(정밀화학·펄프종이및판지 등)과 KSIC 업종명도 매칭되도록 신·구 명칭을 함께 담는다.
export const INTEGRATED_PERMIT_INDUSTRIES: { label: string; keywords: string[] }[] = [
  { label: "발전", keywords: ["발전", "화력", "기타 발전"] },
  { label: "증기열공급", keywords: ["증기", "열공급", "냉온수"] },
  { label: "폐기물처리", keywords: ["폐기물처리", "폐기물 처리", "폐기물소각", "소각", "지정 폐기물"] },
  { label: "철강", keywords: ["철강", "1차 철강"] },
  { label: "비철", keywords: ["비철", "비철금속"] },
  { label: "유기화학", keywords: ["유기", "석유화학계", "기초 유기"] },
  { label: "석유정제", keywords: ["석유정제", "석유 정제품"] },
  { label: "무기화학", keywords: ["무기화학", "무기 화학", "무기안료", "금속 산화물"] },
  { label: "기타화학", keywords: ["기타화학", "정밀화학", "합성염료", "농업용 약제", "도료", "계면활성제", "화장품", "접착제", "화약", "세제"] },
  { label: "비료", keywords: ["비료", "질소화합물"] },
  { label: "종이·펄프", keywords: ["펄프", "종이", "판지"] },
  { label: "전자부품", keywords: ["전자부품", "회로기판", "평판"] },
  { label: "반도체", keywords: ["반도체"] },
  { label: "섬유·염색", keywords: ["섬유", "염색", "마무리 가공"] },
  { label: "육류가공", keywords: ["육류가공", "도축", "저장처리"] },
  { label: "알콜음료", keywords: ["알콜", "알코올", "주류", "음료 제조"] },
  { label: "플라스틱", keywords: ["플라스틱"] },
  { label: "자동차부품", keywords: ["자동차부품", "자동차 부품"] },
  { label: "시멘트", keywords: ["시멘트"] },
  { label: "이차전지", keywords: ["이차전지", "2차전지", "축전지", "배터리"] },
];

export function canonicalServiceSubtype(value: string | null): string {
  return value === "통합허가" ? "최초허가" : (value ?? "");
}

export function normalizeFilterText(value: string): string {
  return value.replace(/[\s·•\-‐‑‒–—―−.,:;()\[\]{}（）「」『』〈〉《》/&]+/g, "").toLowerCase();
}

/** 계약의 업종 관련 텍스트(업종분류·사업장 업종명/코드)가 지정 업종 라벨과 매칭되는지. */
export function matchesIndustryText(haystackParts: (string | null | undefined)[], label: string): boolean {
  const target = INTEGRATED_PERMIT_INDUSTRIES.find((item) => item.label === label);
  if (!target) return true;
  const haystack = normalizeFilterText(haystackParts.filter(Boolean).join(" "));
  return target.keywords.some((keyword) => haystack.includes(normalizeFilterText(keyword)));
}
