/**
 * 통합허가 대상 업종 — 공용 형식·판정 함수(클라이언트·서버 공용, DB import 금지).
 *
 * 단일 원천은 DB 표 permit_industries(325)이고, 관리자 설정 '통합허가 업종'(/admin/permit-industries)에서 편집한다.
 *   - 서버: lib/ieps/permit-industries-server.ts loadPermitIndustries()
 *   - 화면: lib/ieps/use-permit-industries.ts usePermitIndustries()
 * 아래 DEFAULT_PERMIT_INDUSTRIES 는 표 적용 전·조회 실패 시의 기본값(=325 시드)이다. 업종을 고칠 때 여기를 고치지 말고
 * 관리 화면을 쓴다. 판정 함수는 모두 목록을 인자로 받는다 — 정적 목록을 직접 쓰면 관리 화면 변경이 반영되지 않는다.
 *
 * 저장 데이터 키: id 로 저장(intel_signals.industry·intel_projects.industry·브리핑 filters.industries·공식 정보원 industries),
 * 이름으로 저장(contracts.industry_category '이름(통합허가)'·bid perfFilter·catalog_manual_projects.industry 등).
 * 이름 저장 데이터는 permitIndustryFromLabel()로 이름·옛 이름(aliases) → 업종을 찾는다.
 */
export interface IntegratedPermitIndustry {
  /** 고정 slug — 이름을 바꿔도 유지 */
  id: string;
  label: string;
  /** 5자리 KSIC 정확 일치 코드 */
  exactCodes: string[];
  /** KSIC prefix 일치 코드 (예: "241" → 241xx 전체) */
  prefixCodes: string[];
  /** 계약 업종 텍스트·사업장 업종명 대조 키워드(신·구 명칭, KSIC 업종명) */
  keywords: string[];
  /** 옛 이름·다른 표기 */
  aliases: string[];
  /** AI 업종 태깅 프롬프트 힌트(선택) */
  note?: string | null;
  sortOrder: number;
  /** false = 사용 중지(선택 목록·분류에서 빠지고 저장 데이터 이름표에만 쓰인다) */
  active: boolean;
}

/** 계약 업종 옵션 접미 — 화관법·HAPs 등 다른 업종 옵션과 구분한다(contracts.industry_category 저장값). */
export const INTEGRATED_PERMIT_OPTION_SUFFIX = "(통합허가)";

// KSIC 코드는 11차(2024) 기준 — 코드표(public/ksic11.json)·연간보고서 파서와 같다(2026-11-01 사용자 결정, 10차 코드 혼재 정리).
//   11차 재배치: 202 = 합성고무·플라스틱 물질(유기화학), 2031 = 비료, 2032 = 농약(기타화학), 2629 = 기타 전자부품.
type Seed = [id: string, label: string, exactCodes: string[], prefixCodes: string[], keywords: string[], aliases?: string[]];

const SEED: Seed[] = [
  ["power", "발전", [], ["3511"], ["발전", "화력", "기타 발전"]],
  ["steam-heat", "증기열공급", ["35300"], [], ["증기", "열공급", "냉온수"]],
  ["waste-incineration", "폐기물처리", ["38210", "38220"], [], ["폐기물처리", "폐기물 처리", "폐기물소각", "소각", "지정 폐기물"], ["폐기물소각", "폐기물처리업"]],
  ["steel", "철강", [], ["241"], ["철강", "1차 철강"]],
  ["nonferrous", "비철", [], ["242"], ["비철", "비철금속"]],
  ["organic-chem", "유기화학", [], ["2011", "202"], ["유기", "석유화학계", "기초 유기"], ["유기"]],
  ["oil-refining", "석유정제", [], ["192"], ["석유정제", "석유 정제품"]],
  ["inorganic-chem", "무기화학", ["20131", "20132"], ["2012"], ["무기화학", "무기 화학", "무기안료", "금속 산화물"]],
  ["fine-chem", "기타화학", [], ["204", "2032"], ["기타화학", "정밀화학", "합성염료", "농업용 약제", "도료", "계면활성제", "화장품", "접착제", "화약", "세제"], ["정밀화학"]],
  ["fertilizer", "비료", [], ["2031"], ["비료", "질소화합물"], ["비료및질소화합물"]],
  ["pulp-paper", "종이·펄프", [], ["171", "179"], ["펄프", "종이", "판지"], ["펄프종이및판지"]],
  ["electronics", "전자부품", ["26221", "26299"], ["2621", "2629"], ["전자부품", "회로기판", "평판"]],
  ["semiconductor", "반도체", [], ["261"], ["반도체"]],
  ["textile-dyeing", "섬유·염색", [], ["134"], ["섬유", "염색", "마무리 가공"], ["섬유염색및가공처리업"]],
  ["slaughter-meat", "육류가공", [], ["101"], ["육류가공", "도축", "저장처리"], ["도축육류가공및저장처리업"]],
  ["alcohol", "알콜음료", [], ["111"], ["알콜", "알코올", "주류", "음료 제조"], ["알콜음료제조업"]],
  ["plastics", "플라스틱", [], ["222"], ["플라스틱"], ["플라스틱제품제조업"]],
  ["auto-parts", "자동차부품", [], ["303"], ["자동차부품", "자동차 부품"], ["자동차부품제조업"]],
  ["cement", "시멘트", ["23311"], [], ["시멘트"], ["시멘트 제조업"]],
  ["secondary-battery", "이차전지", ["28202", "28209"], [], ["이차전지", "2차전지", "축전지", "배터리"], ["이차전지 제조업"]],
];

/** 표 적용 전·조회 실패 시 기본값(325 시드와 동일). 화면·판정은 load/usePermitIndustries 결과를 쓴다. */
export const DEFAULT_PERMIT_INDUSTRIES: IntegratedPermitIndustry[] = SEED.map(
  ([id, label, exactCodes, prefixCodes, keywords, aliases = []], i) => ({
    id, label, exactCodes, prefixCodes, keywords, aliases, note: null, sortOrder: (i + 1) * 10, active: true,
  })
);

let snapshot: IntegratedPermitIndustry[] = DEFAULT_PERMIT_INDUSTRIES;

/**
 * 마지막으로 읽은 업종 목록 — 서버 loadPermitIndustries()·화면 usePermitIndustries() 가 갱신한다.
 * 호출 사슬이 깊어 목록을 넘기기 어려운 곳(회사소개서 업종 표기 buildDisplayIndustry)만 쓴다. 그 밖에는 목록을 인자로 넘긴다.
 */
export function permitIndustriesSnapshot(): IntegratedPermitIndustry[] {
  return snapshot;
}

export function setPermitIndustriesSnapshot(list: IntegratedPermitIndustry[]): void {
  snapshot = list;
}

/** 사용 중인 업종만(선택 목록·KSIC 분류용). */
export function activePermitIndustries(list: IntegratedPermitIndustry[]): IntegratedPermitIndustry[] {
  return list.filter((entry) => entry.active);
}

export function findIntegratedPermitIndustry(
  id: string,
  list: IntegratedPermitIndustry[]
): IntegratedPermitIndustry | null {
  return list.find((entry) => entry.id === id) ?? null;
}

/** id → 이름(사용 중지 포함). 모르는 id 는 그대로. */
export function permitIndustryLabel(id: string, list: IntegratedPermitIndustry[]): string {
  return findIntegratedPermitIndustry(id, list)?.label ?? id;
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

/** 단일 KSIC 코드 → 대상 업종 카테고리(사용 중 첫 매치). 대상 아니면 null. */
export function industryCategoryForCode(
  code: string,
  list: IntegratedPermitIndustry[]
): IntegratedPermitIndustry | null {
  for (const category of activePermitIndustries(list)) {
    if (industryCodeMatchesCategory(code, category)) return category;
  }
  return null;
}

/** facilities.industry_code(줄바꿈/쉼표/슬래시 연결 복수 KSIC) → 코드 목록. */
export function splitKsicCodes(industryCode: string | null | undefined): string[] {
  if (!industryCode) return [];
  return String(industryCode).split(/[\n,/]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * facilities.industry_code → 대상 업종 id 첫 매치(사용 중 업종만).
 * intel 규칙층(industry-rules.ts)·계약 모달의 업종 프리필이 쓴다.
 */
export function industryIdFromKsic(
  industryCode: string | null | undefined,
  list: IntegratedPermitIndustry[]
): string | null {
  const codes = splitKsicCodes(industryCode);
  for (const cat of activePermitIndustries(list)) {
    for (const code of codes) {
      if (industryCodeMatchesCategory(code, cat)) return cat.id;
    }
  }
  return null;
}

/**
 * 이름 저장값('발전'·'발전(통합허가)'·옛 이름 '정밀화학' 등) → 업종(사용 중지 포함). 없으면 null.
 * id 를 넘겨도 찾는다(id·이름이 섞인 저장 데이터 대응).
 */
export function permitIndustryFromLabel(
  value: string | null | undefined,
  list: IntegratedPermitIndustry[]
): IntegratedPermitIndustry | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const text = raw.endsWith(INTEGRATED_PERMIT_OPTION_SUFFIX)
    ? raw.slice(0, -INTEGRATED_PERMIT_OPTION_SUFFIX.length).trim()
    : raw;
  const key = normalizeFilterText(text);
  return (
    list.find((entry) => entry.id === text || entry.label === text) ??
    list.find((entry) => normalizeFilterText(entry.label) === key) ??
    list.find((entry) => entry.aliases.some((alias) => normalizeFilterText(alias) === key)) ??
    null
  );
}

export function normalizeFilterText(value: string): string {
  return value.replace(/[\s·•\-‐‑‒–—―−.,:;()\[\]{}（）「」『』〈〉《》/&]+/g, "").toLowerCase();
}

/**
 * 계약의 업종 관련 텍스트(업종분류·사업장 업종명/코드)가 지정 업종 이름과 매칭되는지(키워드·이름·옛 이름 대조).
 * 목록에 없는 이름이면 필터를 걸지 않는다(true).
 */
export function matchesIndustryText(
  haystackParts: (string | null | undefined)[],
  label: string,
  list: IntegratedPermitIndustry[]
): boolean {
  const target = permitIndustryFromLabel(label, list);
  if (!target) return true;
  const haystack = normalizeFilterText(haystackParts.filter(Boolean).join(" "));
  const needles = [target.label, ...target.keywords, ...target.aliases].map(normalizeFilterText).filter(Boolean);
  return needles.some((keyword) => haystack.includes(keyword));
}

/** 계약 업종 텍스트 등에서 첫 매칭 업종(사용 중만). */
export function permitIndustryFromText(
  haystackParts: (string | null | undefined)[],
  list: IntegratedPermitIndustry[]
): IntegratedPermitIndustry | null {
  return activePermitIndustries(list).find((entry) => matchesIndustryText(haystackParts, entry.label, list)) ?? null;
}

/** 입력값 정리 — KSIC 코드는 숫자만, 키워드·별칭은 공백 정리·중복 제거. 관리 API·화면 공용. */
export function cleanPermitCodeList(values: unknown): string[] {
  const arr = Array.isArray(values) ? values : typeof values === "string" ? values.split(/[\s,]+/) : [];
  return Array.from(new Set(arr.map((v) => String(v ?? "").replace(/\D/g, "")).filter((v) => v.length >= 2 && v.length <= 5)));
}

export function cleanPermitTextList(values: unknown): string[] {
  const arr = Array.isArray(values) ? values : typeof values === "string" ? values.split(/[,\n]+/) : [];
  return Array.from(new Set(arr.map((v) => String(v ?? "").trim()).filter(Boolean)));
}
