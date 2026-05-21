/**
 * IEPS 검토결과서 PDF에서 자동 추출하는 9개 빌트인 규칙.
 *
 * - cli-collect.ts와 frontend(/data/settings, /data/status) 양쪽이 동일한 정의를 사용한다.
 * - 백엔드의 [backend/app/ieps/rule_engine.py](../../../backend/app/ieps/rule_engine.py)
 *   BUILTIN_RULES와 의미적으로 1:1 매칭한다 (id, label, locator, regex 동일).
 */

export type Locator =
  | "rightOfKeyword"
  | "leftOfKeyword"
  | "sameRowNext"
  | "nextLine"
  // 키워드 매칭 라인 다음부터 빈 줄/다음 라벨 직전까지의 모든 라인을 묶어서 반환.
  // 업종/생산품/종 규모처럼 한 라벨 아래 여러 줄이 묶여 있는 경우(다중 항목) 사용.
  | "nextChunk"
  | "regex";

export type ResultType = "string" | "number" | "date" | "codeName";

export interface ExtractionRule {
  id: string;
  label: string;
  keyword?: string | null;
  auxKeyword?: string | null;
  locator?: Locator;
  regex?: string | null;
  pageRange?: [number, number] | null;
  resultType?: ResultType;
  required?: boolean;
  note?: string | null;
  builtin?: boolean;
}

export const BUILTIN_RULES: ExtractionRule[] = [
  {
    id: "decision_no",
    label: "결정번호",
    keyword: "결정번호",
    locator: "regex",
    // 4자리가 표준이지만 일부 PDF 에 '제00321-01호'(5자리) 변형이 있어 3~5자리 허용.
    // 페이지 번호('5/113') 등 짧은 숫자 충돌을 막기 위해 자릿수 폭은 좁게 유지.
    regex: "제\\s*\\d{3,5}\\s*-\\s*\\d+\\s*호",
    pageRange: [1, 25],
    resultType: "string",
    required: true,
    builtin: true,
    note: "제 OOOO-O1호 형식 (01호 → 최초허가). 표지/갑지 상단 또는 1.허가결정 페이지에 등장.",
  },
  {
    // IEPS 검토결과서 갑지의 표가 텍스트로 풀리면 "상호(사업장)" 헤더 다음 줄에 회사명이 떨어진다.
    id: "company_name",
    label: "상호",
    keyword: "상호(사업장)",
    auxKeyword: "상호",
    locator: "nextLine",
    pageRange: [5, 25],
    resultType: "string",
    required: true,
    builtin: true,
    note: "1.허가결정 페이지의 사업장 명칭",
  },
  {
    id: "business_registration_no",
    label: "사업자등록번호",
    keyword: "사업자등록번호",
    locator: "regex",
    // 워드프로세서 변환 PDF에서 dash 가 ASCII hyphen(-)/EN DASH(–)/EM DASH(—)/MINUS(−)
    // 등으로 섞여 추출되는 사례가 있어 모든 변형을 허용한다.
    regex:
      "\\d{3}\\s*[\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]\\s*\\d{2}\\s*[\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]\\s*\\d{5}",
    pageRange: [5, 25],
    resultType: "string",
    required: true,
    builtin: true,
    note: "OOO-OO-OOOOO 형식. 법인등록번호(OOOOOO-OOOOOOO)와 자릿수로 자동 구분. 다중 dash 변형 허용.",
  },
  {
    id: "site_address",
    label: "사업장소재지",
    keyword: "사업장소재지",
    auxKeyword: "소재지",
    locator: "nextLine",
    pageRange: [5, 25],
    resultType: "string",
    required: true,
    builtin: true,
    note: "1.허가결정 페이지의 사업장 주소",
  },
  {
    id: "phone_number",
    label: "전화번호",
    keyword: "전화번호",
    locator: "nextLine",
    pageRange: [5, 25],
    resultType: "string",
    required: false,
    builtin: true,
    note: "지역/대표/휴대 전화 모두 허용",
  },
  {
    // 한 라벨 다음에 1~5개 업종이 줄바꿈으로 나열되는 경우가 잦아 nextChunk 사용.
    id: "industry_code_name",
    label: "업종",
    keyword: "업종",
    locator: "nextChunk",
    pageRange: [5, 25],
    resultType: "codeName",
    required: true,
    builtin: true,
    note: "5자리 업종코드와 업종명. '코드 명칭' / '명칭(코드)' 두 표기 모두 매칭. 다중 업종은 배열로 반환.",
  },
  {
    // "...일부로 허가한다" / "...일\n환경부 장관" 두 형태 모두 매칭.
    id: "permit_date",
    label: "허가일자",
    keyword: "허가",
    auxKeyword: "환경부",
    locator: "regex",
    regex: "(\\d{4})\\s*[\\.년\\-/]\\s*(\\d{1,2})\\s*[\\.월\\-/]\\s*(\\d{1,2})\\s*[\\.일]?\\s*(?:부로|\\n?\\s*환경부)",
    pageRange: [5, 25],
    resultType: "date",
    required: true,
    builtin: true,
    note: "'YYYY년 MM월 DD일부로 ... 허가한다' 또는 페이지 하단 '환경부 장관' 직전 날짜.",
  },
  {
    // 종 규모는 "대기/수질"이 한 줄에 같이 또는 두 줄로 분리되는 경우 모두 발생 → nextChunk로 묶음 수집.
    id: "permit_scale",
    label: "종 규모",
    keyword: "종 규모",
    auxKeyword: "종규모",
    locator: "nextChunk",
    pageRange: [5, 25],
    resultType: "string",
    required: true,
    builtin: true,
    note: "대기 O종 (톤/년), 수질 O종 (m3/일). 두 줄 분리 형태도 처리.",
  },
  {
    id: "product_output",
    label: "생산품",
    keyword: "생산품",
    auxKeyword: "생산량",
    locator: "nextChunk",
    pageRange: [5, 25],
    resultType: "string",
    required: false,
    builtin: true,
    note: "여러 생산품(콤마/줄바꿈 구분)은 배열로 반환.",
  },
];
