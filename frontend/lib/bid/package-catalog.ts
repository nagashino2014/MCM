/*
 * 입찰 증빙서류 패키지 — 표준 문서 타입 8종 × 필드 수퍼셋 카탈로그.
 * 샘플 5벌 분석으로 확정(docs/bid-package-blueprint.md §4-2). 발주처 양식의 LLM 셀 매핑이
 * 이 카탈로그의 필드 키에 대응하고, 미매핑 셀은 custom 필드로 노출해 추가/삭제 조정한다.
 */

export interface CatalogField {
  key: string;
  label: string;
  /** LLM 매핑 힌트(양식 라벨 변형 예). */
  hint?: string;
}

export interface CatalogDoc {
  type: string;
  label: string;
  /** 단일 값 필드(라벨 셀 옆/아래 값 셀). */
  fields: CatalogField[];
  /** 반복 행(실적·인력 목록 등) 열 필드. 없으면 반복 없음. */
  repeatFields?: CatalogField[];
}

export const PACKAGE_DOC_CATALOG: CatalogDoc[] = [
  {
    type: "company_profile",
    label: "일반현황 및 연혁",
    fields: [
      { key: "companyName", label: "업체명", hint: "회사명/제안 업체명/신청기관" },
      { key: "ceoName", label: "대표자" },
      { key: "bizRegNo", label: "사업자번호" },
      { key: "bizField", label: "사업분야(업종)" },
      { key: "address", label: "주소" },
      { key: "phone", label: "전화번호" },
      { key: "fax", label: "팩스" },
      { key: "foundedYm", label: "회사설립년도(년월)" },
      { key: "industryYears", label: "해당부문 종사기간" },
      { key: "licenseList", label: "면허/허가/등록증 보유현황" },
      { key: "staffComposition", label: "인적구성", hint: "고급/일반·특급~초급·직군별 인원표" },
      { key: "financeSummary", label: "재정상황", hint: "자본금·매출액 연도 표기" },
      { key: "historyList", label: "주요연혁", hint: "연월+내용 목록" },
      { key: "mainBusiness", label: "주요 사업내용" },
    ],
  },
  {
    type: "credit_rating",
    label: "신용평가 등급",
    fields: [
      { key: "agency", label: "신용평가회사" },
      { key: "ratingType", label: "평가 종류" },
      { key: "creditGrade", label: "신용등급", hint: "등급 체크표면 해당 등급 셀" },
      { key: "ratedAt", label: "평가일" },
    ],
  },
  {
    type: "performance_summary",
    label: "용역 수행 실적 총괄표",
    fields: [
      { key: "companyName", label: "제안 업체명" },
      { key: "totalAmount", label: "합계(계약금액)" },
    ],
    repeatFields: [
      { key: "no", label: "번호(NO)" },
      { key: "year", label: "연도" },
      { key: "category", label: "구분", hint: "동등실적(최초허가/변경허가/변경신고)" },
      { key: "serviceName", label: "용역명(사업명)" },
      { key: "overview", label: "용역개요", hint: "시설유형+취득종류" },
      { key: "amount", label: "계약금액", hint: "백만원/억원 단위 병기" },
      { key: "period", label: "용역기간" },
      { key: "staffCount", label: "참여인원", hint: "고급:N 일반:N" },
      { key: "clientName", label: "발주처" },
      { key: "clientPhone", label: "발주처 연락처" },
      { key: "score", label: "득점", hint: "발주처 평가란 — 빈칸 유지" },
    ],
  },
  {
    type: "staff_summary",
    label: "용역 투입인력 집계표",
    fields: [],
    repeatFields: [
      { key: "role", label: "참여직위", hint: "PM/팀장/팀원/총괄책임자/용역참여자" },
      { key: "name", label: "성명" },
      { key: "grade", label: "등급(기술자/기술인력 구분)" },
      { key: "degree", label: "소지학위", hint: "학위(자격증) 병기형 포함" },
      { key: "careerMonthsTotal", label: "관련분야 근무경력(개월)" },
      { key: "careerMonthsCompany", label: "소속업체 근무경력(개월)" },
      { key: "perfCount", label: "유사(동등)용역 수행실적 건수" },
      { key: "participateMonths", label: "참여기간(개월)" },
      { key: "score", label: "득점결과", hint: "발주처 평가란 — 빈칸 유지" },
    ],
  },
  {
    type: "staff_career",
    label: "투입인력 개별 경력사항 및 수행실적",
    fields: [
      { key: "name", label: "성명" },
      { key: "company", label: "소속" },
      { key: "engGrade", label: "기술등급" },
      { key: "position", label: "직위(직책)" },
      { key: "birthDate", label: "생년월일" },
      { key: "age", label: "연령" },
      { key: "tenure", label: "소속사 근무기간" },
      { key: "education", label: "최종학력", hint: "학부/대학원 학교+전공+연도" },
      { key: "licenses", label: "자격증(취득일)" },
      { key: "assignedRole", label: "본 사업 참여임무" },
      { key: "careerTotal", label: "총 경력" },
    ],
    repeatFields: [
      { key: "client", label: "발주기관" },
      { key: "projectName", label: "참여 사업명" },
      { key: "task", label: "담당업무" },
      { key: "amount", label: "사업비(억원)" },
      { key: "period", label: "용역기간(참여기간)" },
      { key: "thenCompany", label: "참여당시 소속회사" },
      { key: "thenPosition", label: "참여당시 직위" },
    ],
  },
  {
    type: "privacy_consent",
    label: "개인정보 수집 및 이용 동의서",
    fields: [
      { key: "serviceName", label: "용역명(본문 치환)", hint: "본문 중 『용역명』 위치" },
      { key: "signerName", label: "성명(서명자)" },
    ],
  },
  {
    type: "security_pledge",
    label: "보안 서약서",
    fields: [
      { key: "pledgeDate", label: "서약일" },
      { key: "serviceName", label: "용역명(본문 치환)" },
      { key: "companyName", label: "업체명" },
      { key: "position", label: "직위" },
      { key: "name", label: "성명" },
      { key: "birthDate", label: "생년월일" },
      { key: "issuerOrg", label: "서약집행자 소속(발주처)" },
    ],
  },
  {
    type: "org_chart",
    label: "사업수행 조직도",
    fields: [],
  },
];

export const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PACKAGE_DOC_CATALOG.map((d) => [d.type, d.label])
);

/** 미세조정 UI 의 필드 후보(문서 타입별 단일+반복 필드). */
export function catalogFieldsOf(docType: string): { fields: CatalogField[]; repeatFields: CatalogField[] } {
  const doc = PACKAGE_DOC_CATALOG.find((d) => d.type === docType);
  return { fields: doc?.fields ?? [], repeatFields: doc?.repeatFields ?? [] };
}
