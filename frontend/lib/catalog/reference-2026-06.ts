/*
 * 현행 회사 카탈로그(2026.06판, 46장, `(주)한국환경안전연구원_회사 카탈로그(20260602).pdf`) 수치 — P4 대조 기준값(블루프린트 §13).
 * 소개서 자동 집계(지표 사전)와 나란히 보여 차이를 정의 결정으로 정리하는 데 쓴다. 클라이언트 안전(상수만).
 * 같은 판 안에서도 수치가 엇갈리는 항목(인원 31/33명 등)은 쪽별로 따로 적는다.
 */
import type { MetricId } from "./metrics";

export interface ReferenceFigure {
  key: string;
  label: string;
  /** 현행 카탈로그 값(표기 그대로) */
  value: string;
  /** 숫자 비교용 값 — 판 안에서 엇갈리면 대표값(마지막 쪽 기준) */
  number: number | null;
  page: string;
  /** 비교할 지표(없으면 cohort/category 로 비교하거나 비교 안 함) */
  metric?: MetricId;
  /** 최초허가 업종군(lib/catalog/regions.ts PERMIT_COHORTS id) */
  cohort?: string;
  note?: string;
}

export const REFERENCE_EDITION_LABEL = "현행 카탈로그 2026.06판(46장)";

export const REFERENCE_2026_06: ReferenceFigure[] = [
  { key: "initial", label: "통합허가 최초허가", value: "99건", number: 99, page: "7·8쪽", metric: "permit.initial.completed", note: "사용자 확정 정의. 스테이징 대조(10-22) 후 군산 별개 최초허가를 더해 기대값 100" },
  { key: "initial-matrix", label: "총괄표 괄호(최초허가)", value: "109건", number: 109, page: "26쪽", metric: "permit.initial.completed", note: "오집계(사용자 확인 10-21) — 개편본은 지표 하나로만 센다" },
  { key: "cohort1", label: "최초허가 1차 발전·폐기물", value: "31", number: 31, page: "8쪽", cohort: "cohort1" },
  { key: "cohort2", label: "최초허가 2차 철강·비철", value: "22", number: 22, page: "8쪽", cohort: "cohort2" },
  { key: "cohort3", label: "최초허가 3차 석유화학", value: "9", number: 9, page: "8쪽", cohort: "cohort3" },
  { key: "cohort4", label: "최초허가 4차 제지·전자", value: "8", number: 8, page: "8쪽", cohort: "cohort4" },
  { key: "cohort5", label: "최초허가 5차 반도체 등", value: "29", number: 29, page: "8쪽", cohort: "cohort5" },
  { key: "share", label: "허가 사업장 대비 비율", value: "7.6%", number: 7.6, page: "8쪽", metric: "market.permit.share", note: "분모 1,307(외부 수치)" },
  { key: "change", label: "변경허가·변경신고 완료", value: "175건(변경허가 54 · 변경신고 121)", number: 175, page: "9쪽", metric: "permit.change.completed", note: "진행 중 20건 별도" },
  { key: "permit-total", label: "통합환경허가 분야 누적", value: "416건", number: 416, page: "26쪽", metric: "permit.contracts.total" },
  { key: "haps", label: "HAPs 신고·점검보고", value: "586건(카탈로그 11쪽은 350건)", number: 586, page: "26쪽", metric: "projects.area.3" },
  { key: "chem", label: "장외·화관법", value: "216건(11쪽 예방관리계획서 120건)", number: 216, page: "26쪽", metric: "projects.area.2" },
  { key: "esg", label: "ESG·탄소중립", value: "6건(ESG 보고서 4 + 탄소중립 2)", number: 6, page: "26쪽", metric: "projects.area.4" },
  { key: "other", label: "기타 용역(환경 인허가·연구·교육)", value: "집계 없음(대기총량 20건 등 문장만)", number: null, page: "11쪽", metric: "projects.area.5" },
  { key: "industries", label: "통합허가 수행 업종", value: "20개 업종", number: 20, page: "8쪽", metric: "permit.industries", note: "자동 집계는 통합허가 20업종 라벨로 판정된 업종만 센다" },
  { key: "staff", label: "임직원(종업원)", value: "31명(3쪽) / 33명(17쪽)", number: 33, page: "3·17쪽", metric: "staff.total" },
  { key: "technical", label: "기술인력", value: "28명(3쪽) / 32명(17쪽)", number: 32, page: "3·17쪽", metric: "staff.technical" },
  { key: "exec", label: "임원", value: "6명(고문 포함)", number: 6, page: "18쪽", metric: "staff.exec" },
  { key: "employee", label: "직원", value: "27명(23쪽) / 28명(24쪽)", number: 27, page: "23·24쪽", metric: "staff.employee" },
  { key: "advisors", label: "자문위원", value: "17명", number: 17, page: "25쪽", metric: "advisors.total" },
];
