import { getDb, rowsToObjects } from "@/lib/db";
import { DASHBOARD_SERVICE_CATEGORIES } from "@/lib/ieps/contract-categories";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit";
import { CATALOG_CATEGORIES, SOFTWARE_PRODUCTS } from "./areas";
import {
  CHANGE_PERMIT_SUBTYPES,
  INITIAL_PERMIT_SUBTYPES,
  buildDisplayIndustry,
  formatPermitNo,
  isCompleted,
  isInitialPermit,
  projectPartyName,
  projectSiteCount,
  type CatalogProjectRow,
} from "./appendix";
import { listCatalogPeople, listExtraPeople } from "./people";
import { listCatalogProjects } from "./projects";
import { PERMIT_COHORTS, permitCohortId } from "./regions";

/*
 * 회사소개서 지표 사전(블루프린트 §6-5) — 소개서의 모든 숫자는 여기서만 계산한다.
 * 텍스트·인포그래픽은 숫자를 직접 쓰지 않고 지표 id({{metric:permit.initial.completed}})로 바인딩한다(LLM 이 숫자를 지어내지 못하게).
 * 각 지표는 쪽에 그대로 찍히는 정의 각주(footnote)를 갖는다.
 *
 * permit.initial.completed — 사용자 확정(2026-10-21): 현행 소개서의 '통합허가 최초허가 99건'이 정답, 총괄표 괄호 109건은 오집계.
 *   기준 목록 = 영업부 「통합허가(최초허가) 완료현황(2026.05.15. 기준)」(사업장 1줄, 시범사업 2개소 포함 99개소).
 *   분류 = 계약 관리 categoryCaseSql(통합환경허가), 세분류 = 최초허가(구 표기 '통합허가'·2017 시범사업 포함),
 *   완료 = 허가일 또는 최종 대금 단계 계산서 발행일(completions-status 규칙),
 *   셈 = 사업장 수 — 실적 노출 관리에서 지정한 사업장 수가 우선, 없으면 허가 결정번호 수, 번호도 없으면 1.
 *     (묶음 용역: 2017 시범사업 엔아이티·진주산업 2, 지역난방 중앙지사 3, 세진메탈 1·3공장 2, 동남 울산·서산 2 — 사용자 확인 10-22)
 *   계약 없는 실적(catalog_manual_projects)도 같은 규칙으로 센다 — 석문에너지(한국종합기술 위임, 정식 계약 없이 대금만 수령).
 */

export type MetricId =
  | "permit.initial.completed"
  | "permit.change.completed"
  | "permit.contracts.total"
  | "permit.industries"
  | `projects.area.${1 | 2 | 3 | 4 | 5 | 6}`
  | "software.products"
  | "projects.total"
  | "clients.total"
  | "staff.total"
  | "staff.exec"
  | "staff.employee"
  | "staff.technical"
  | "advisors.total"
  | "company.years"
  | "market.permit.share";

export interface MetricDef {
  id: MetricId;
  label: string;
  unit: string;
  /** 쪽에 자동 표기하는 정의 각주 */
  footnote: string;
}

export interface MetricValue extends MetricDef {
  value: number | null;
  /** 값 계산 기준일(YYYY-MM-DD) */
  asOf: string;
  /** 계산 불가 사유(외부 수치 없음 등) */
  missing?: string;
}

export const METRIC_DEFS: MetricDef[] = [
  {
    id: "permit.initial.completed",
    label: "통합환경허가 최초허가",
    unit: "건",
    footnote: "통합환경허가 최초허가를 완료한 사업장 수. 완료는 허가일 또는 최종 대금 계산서 발행일 기준이며, 한 용역이 여러 사업장을 맡은 경우 그 사업장 수만큼 셉니다.",
  },
  {
    id: "permit.change.completed",
    label: "통합환경 변경허가·변경신고",
    unit: "건",
    footnote: "통합환경 변경허가·변경신고 용역 중 완료한 계약 수(허가일 또는 최종 대금 계산서 발행일 기준).",
  },
  {
    id: "permit.contracts.total",
    label: "통합환경허가 분야 수행",
    unit: "건",
    footnote: "통합환경허가 분야(최초·변경·사후관리·재검토 등) 누적 계약 수(수행 중 포함).",
  },
  {
    id: "permit.industries",
    label: "통합허가 수행 업종",
    unit: "개",
    footnote: `통합환경허가 용역을 수행한 통합허가 대상 업종 수(대상 ${INTEGRATED_PERMIT_INDUSTRIES.length}개 업종 중, 사업장 업종 기준).`,
  },
  // 사업 분야별 누적 계약 수 — 분야 번호는 디자인 시스템 분야 색 area-1..6 과 같다(lib/catalog/areas.ts)
  ...CATALOG_CATEGORIES.map((category, i) => ({
    id: `projects.area.${i + 1}` as MetricId,
    label: `${category} 수행 실적`,
    unit: "건",
    footnote:
      i < 5
        ? `계약 관리 분류 '${category}'의 누적 계약 수(수행 중 포함, 계약 없는 실적 포함).`
        : "응용소프트웨어 공급 계약 수(계약의 서비스 유형이 소프트웨어·SW·그룹웨어·ERP 인 계약, 공급 계약부터 집계).",
  })),
  {
    id: "software.products",
    label: "응용소프트웨어 제품",
    unit: "종",
    footnote: "자체 개발·공급하는 응용소프트웨어 제품 수(그룹웨어 & ERP · 통합허가 계획서 플랫폼 · ESG 통합관리 플랫폼).",
  },
  {
    id: "projects.total",
    label: "누적 수행 실적",
    unit: "건",
    footnote: "설립 이후 전 분야 누적 계약 수(수행 중 포함).",
  },
  {
    id: "clients.total",
    label: "고객사",
    unit: "곳",
    footnote: "계약 상대방(발주처) 기준 누적 고객사 수.",
  },
  {
    id: "staff.total",
    label: "임직원",
    unit: "명",
    footnote: "사용자관리에 등록된 재직자 수(인원 수에 넣기로 한 촉탁 임원 포함).",
  },
  {
    id: "staff.exec",
    label: "임원",
    unit: "명",
    footnote: "직급이 부장보다 높은 재직자와 인원 수에 넣기로 한 촉탁 임원(고문 등).",
  },
  {
    id: "staff.employee",
    label: "직원",
    unit: "명",
    footnote: "직급이 부장 이하인 재직자.",
  },
  {
    id: "staff.technical",
    label: "기술인력",
    unit: "명",
    footnote: "재직자 중 통합허가 대행업 기술인력 등급(고급·일반)이 있는 인원.",
  },
  {
    id: "advisors.total",
    label: "자문위원",
    unit: "명",
    footnote: "회사소개서에 공개하는 자문위원 수.",
  },
  {
    id: "company.years",
    label: "업력",
    unit: "년",
    footnote: "회사 프로필의 설립년월부터 기준일까지 만 연수.",
  },
  {
    id: "market.permit.share",
    label: "통합허가 최초허가 수행 비율",
    unit: "%",
    footnote: "환경부 통합허가 완료 사업장 수(외부 수치, 출처·기준일 별도 표기) 대비 당사 최초허가 완료 사업장 수.",
  },
];

const today = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────── 최초허가 상세(대조용) ───────────────────────────────

export interface InitialPermitRow {
  contractId: string;
  /** contract = 계약, manual = 계약 없는 실적 */
  source: "contract" | "manual";
  contractTitle: string;
  party: string;
  subtype: string;
  year: string;
  industry: string;
  cohortId: string | null;
  permitIssuedAt: string;
  permitNo: string;
  completedAt: string;
  completed: boolean;
  /** 이 계약이 세는 사업장 수(지정값 → 결정번호 수 → 1) — 미완료·집계 제외(지정 0)면 0 */
  sites: number;
  /** 사업장 수를 직접 지정했는지 */
  siteCountSet: boolean;
}

export interface InitialPermitDetail {
  /** 지표값 = 완료 사업장 수 */
  sites: number;
  /** 사업장으로 센 완료 계약 수(집계 제외 제외) */
  completedContracts: number;
  /** 사업장 수를 0으로 지정해 집계에서 뺀 완료 계약 수 */
  excludedContracts: number;
  ongoingContracts: number;
  /** 사업장 수 지정도 결정번호도 없어 1로 센 완료 계약 수(대조 시 확인 대상) */
  completedWithoutPermitNo: number;
  byCohort: Array<{ id: string; label: string; sites: number }>;
  rows: InitialPermitRow[];
}

export function initialPermitDetailFrom(projects: CatalogProjectRow[]): InitialPermitDetail {
  const rows: InitialPermitRow[] = projects.filter(isInitialPermit).map((p) => {
    const industry = buildDisplayIndustry(p);
    const completed = isCompleted(p);
    return {
      contractId: p.contractId,
      source: p.source,
      contractTitle: p.contractTitle,
      // 계약 없는 실적은 발주·위임처가 고객이 아니므로 사업장명 우선(buildDisplayTitle 과 같은 규칙)
      party: p.source === "manual" && p.siteName.trim() ? p.siteName.trim() : projectPartyName(p.counterpartyName, p.siteName),
      subtype: p.subtype,
      year: p.year,
      industry,
      cohortId: permitCohortId(industry),
      permitIssuedAt: p.permitIssuedAt,
      permitNo: formatPermitNo(p.permitNo),
      completedAt: p.completedAt,
      completed,
      sites: completed ? projectSiteCount(p) : 0,
      siteCountSet: p.meta?.siteCount != null,
    };
  });
  const done = rows.filter((r) => r.completed);
  const excluded = done.filter((r) => r.siteCountSet && r.sites === 0).length;
  const byCohort = [
    ...PERMIT_COHORTS.map((c) => ({ id: c.id, label: c.label, sites: done.filter((r) => r.cohortId === c.id).reduce((a, r) => a + r.sites, 0) })),
    { id: "unknown", label: "업종 미판정", sites: done.filter((r) => !r.cohortId).reduce((a, r) => a + r.sites, 0) },
  ];
  return {
    sites: done.reduce((a, r) => a + r.sites, 0),
    completedContracts: done.length - excluded,
    excludedContracts: excluded,
    ongoingContracts: rows.length - done.length,
    completedWithoutPermitNo: done.filter((r) => !r.siteCountSet && !/\d{3,4}-\d{2}/.test(r.permitNo)).length,
    byCohort,
    rows,
  };
}

// ─────────────────────────────── 전체 지표 ───────────────────────────────

export interface MetricsBundle {
  asOf: string;
  metrics: MetricValue[];
  initialPermit: InitialPermitDetail;
  /** 분류별 누적 계약 수(수행 중 포함) */
  projectsByCategory: Array<{ category: string; count: number; completed: number }>;
}

export async function computeCatalogMetrics(): Promise<MetricsBundle> {
  const db = await getDb();
  const projects = await listCatalogProjects();
  const [staffRow, people, extraPeople, advisorRow, profileRow, figureRow] = await Promise.all([
    db.exec(
      `SELECT COUNT(*) FILTER (WHERE TRIM(COALESCE(env_grade, '')) IN ('고급인력', '일반인력')) AS technical
         FROM employee_profiles WHERE COALESCE(status, 'active') <> 'inactive'`
    ),
    listCatalogPeople(),
    listExtraPeople(),
    db.exec("SELECT COUNT(*) AS n FROM catalog_advisors WHERE is_public = 1"),
    db.exec("SELECT founded_ym FROM company_profile WHERE profile_id = 'default'"),
    db.exec("SELECT value, as_of, source FROM catalog_external_figures WHERE figure_key = 'permit.sites.total'"),
  ]);
  const staff = rowsToObjects(staffRow)[0] ?? {};
  const advisors = Number(rowsToObjects(advisorRow)[0]?.n ?? 0);
  const foundedYm = String(rowsToObjects(profileRow)[0]?.founded_ym ?? "");
  const figure = rowsToObjects(figureRow)[0];

  const initialPermit = initialPermitDetailFrom(projects);
  const permitRows = projects.filter((p) => p.category === DASHBOARD_SERVICE_CATEGORIES[0]);
  const changeCompleted = permitRows.filter((p) => CHANGE_PERMIT_SUBTYPES.includes(p.subtype.trim()) && isCompleted(p)).length;
  const clients = new Set(projects.map((p) => p.counterpartyName.trim()).filter(Boolean)).size;
  // 통합허가 수행 업종 — 20개 대상 업종 라벨로 판정된 것만 센다
  const permitLabels = new Set(INTEGRATED_PERMIT_INDUSTRIES.map((i) => i.label));
  const permitIndustries = new Set(permitRows.map((p) => buildDisplayIndustry(p)).filter((l) => permitLabels.has(l))).size;
  const areaCounts = Object.fromEntries(
    CATALOG_CATEGORIES.map((c, i) => [`projects.area.${i + 1}`, { value: projects.filter((p) => p.category === c).length }])
  ) as Record<`projects.area.${1 | 2 | 3 | 4 | 5 | 6}`, { value: number }>;

  const asOf = today();
  let years: number | null = null;
  const fm = foundedYm.match(/(\d{4})\D?(\d{1,2})?/);
  if (fm) {
    const now = new Date();
    const fy = Number(fm[1]);
    const fmon = Number(fm[2] ?? 1);
    years = now.getFullYear() - fy - (now.getMonth() + 1 < fmon ? 1 : 0);
  }
  const denom = figure?.value != null ? Number(figure.value) : null;
  const share = denom && denom > 0 ? Math.round((initialPermit.sites / denom) * 1000) / 10 : null;

  const values: Record<MetricId, { value: number | null; missing?: string }> = {
    "permit.initial.completed": { value: initialPermit.sites },
    "permit.change.completed": { value: changeCompleted },
    "permit.contracts.total": { value: permitRows.length },
    "permit.industries": { value: permitIndustries },
    ...areaCounts,
    "software.products": { value: SOFTWARE_PRODUCTS.length },
    "projects.total": { value: projects.length },
    "clients.total": { value: clients },
    // 인원 집계 = 사용자관리 재직자(구획: 부장 초과 임원·이하 직원, 수동 지정 반영) + 인원 수에 넣는 촉탁 임원
    "staff.total": { value: people.length + extraPeople.filter((x) => x.countInTotal).length },
    "staff.exec": { value: people.filter((p) => p.section === "exec").length + extraPeople.filter((x) => x.countInTotal).length },
    "staff.employee": { value: people.filter((p) => p.section === "staff").length },
    "staff.technical": { value: Number(staff.technical ?? 0) },
    "advisors.total": { value: advisors },
    "company.years": years == null ? { value: null, missing: "회사 프로필에 설립년월이 없습니다." } : { value: years },
    "market.permit.share":
      share == null ? { value: null, missing: "외부 수치 '통합허가 완료 사업장 수'가 없습니다." } : { value: share },
  };

  return {
    asOf,
    metrics: METRIC_DEFS.map((d) => ({ ...d, asOf, ...values[d.id] })),
    initialPermit,
    projectsByCategory: CATALOG_CATEGORIES.map((category) => {
      const list = projects.filter((p) => p.category === category);
      return { category, count: list.length, completed: list.filter(isCompleted).length };
    }),
  };
}

export { INITIAL_PERMIT_SUBTYPES, CHANGE_PERMIT_SUBTYPES };
