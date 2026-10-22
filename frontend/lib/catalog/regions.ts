/*
 * 회사소개서 권역·업종군 상수(클라이언트 안전 — DB 접근 없음).
 * 권역 열은 현행 회사소개서(2026.06판) 수행실적 총괄표와 같다: 영남권을 대구·경북 / 부산·울산·경남 두 열로 나눈다.
 */

export interface RegionGroup {
  id: string;
  label: string;
  /** 표 머리 아래 작은 글씨(포함 시도) */
  note: string;
  sido: string[];
}

export const REGION_GROUPS: RegionGroup[] = [
  { id: "capital", label: "수도권", note: "서울·인천·경기", sido: ["서울", "인천", "경기"] },
  { id: "central", label: "중부권", note: "대전·세종·충북·충남", sido: ["대전", "세종", "충북", "충남"] },
  { id: "yeongnam-n", label: "영남권(대구·경북)", note: "대구·경북", sido: ["대구", "경북"] },
  { id: "yeongnam-s", label: "영남권(부산·울산·경남)", note: "부산·울산·경남", sido: ["부산", "울산", "경남"] },
  { id: "honam", label: "호남권", note: "광주·전북·전남·제주", sido: ["광주", "전북", "전남", "제주"] },
  { id: "gangwon", label: "강원권", note: "강원", sido: ["강원"] },
];

export const REGION_UNKNOWN = { id: "unknown", label: "미상" } as const;

// 시도 원문(서울특별시·충청북도·전북특별자치도·경기 등) → 두 글자 약칭
const SIDO_PATTERNS: Array<[RegExp, string]> = [
  [/^서울/, "서울"],
  [/^인천/, "인천"],
  [/^경기/, "경기"],
  [/^대전/, "대전"],
  [/^세종/, "세종"],
  [/^(충북|충청북)/, "충북"],
  [/^(충남|충청남)/, "충남"],
  [/^대구/, "대구"],
  [/^(경북|경상북)/, "경북"],
  [/^부산/, "부산"],
  [/^울산/, "울산"],
  [/^(경남|경상남)/, "경남"],
  [/^광주/, "광주"],
  [/^(전북|전라북)/, "전북"],
  [/^(전남|전라남)/, "전남"],
  [/^제주/, "제주"],
  [/^강원/, "강원"],
];

export function shortSido(value: string | null | undefined): string {
  const v = String(value ?? "").replace(/\s+/g, "");
  if (!v) return "";
  for (const [re, short] of SIDO_PATTERNS) if (re.test(v)) return short;
  return "";
}

/** 시도 원문 → 권역 id(모르면 unknown). */
export function regionGroupId(sido: string | null | undefined): string {
  const short = shortSido(sido);
  if (!short) return REGION_UNKNOWN.id;
  return REGION_GROUPS.find((g) => g.sido.includes(short))?.id ?? REGION_UNKNOWN.id;
}

export function regionGroupLabel(id: string): string {
  return REGION_GROUPS.find((g) => g.id === id)?.label ?? REGION_UNKNOWN.label;
}

/**
 * 통합허가 적용 차년도(업종군) — 현행 회사소개서 8장의 '1차년도 발전·폐기물 … 5차년도 반도체 등' 묶음.
 * 키는 lib/ieps/integrated-permit.ts INTEGRATED_PERMIT_INDUSTRIES 의 업종 라벨.
 * 근거: 영업부 「통합허가(최초허가) 완료현황(2026.05.15. 기준)」 99개소를 업종별로 묶으면 소개서 8장의 31·22·9·8·29 와
 *   일치하는 묶음 — 화학 계열(무기화학·기타화학·화장품)은 3차, 반도체는 전자와 함께 4차, 섬유·알코올·자동차부품·플라스틱·
 *   육가공·이차전지는 5차. 20개 업종 밖(케이블 등)은 '업종 미판정'으로 따로 센다(소개서는 5차에 넣었다).
 */
export const PERMIT_COHORTS: Array<{ id: string; label: string; industries: string[] }> = [
  { id: "cohort1", label: "1차년도 발전·폐기물", industries: ["발전", "증기열공급", "폐기물처리"] },
  { id: "cohort2", label: "2차년도 철강·비철", industries: ["철강", "비철"] },
  { id: "cohort3", label: "3차년도 석유화학", industries: ["유기화학", "석유정제", "무기화학", "비료", "기타화학"] },
  { id: "cohort4", label: "4차년도 제지·전자", industries: ["종이·펄프", "전자부품", "반도체"] },
  { id: "cohort5", label: "5차년도 반도체 등", industries: ["섬유·염색", "육류가공", "알콜음료", "플라스틱", "자동차부품", "시멘트", "이차전지"] },
];

export function permitCohortId(industryLabel: string): string | null {
  if (!industryLabel) return null;
  return PERMIT_COHORTS.find((c) => c.industries.includes(industryLabel))?.id ?? null;
}
