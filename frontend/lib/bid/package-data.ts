import { getDb, rowsToObjects } from "@/lib/db";
import { getBid } from "@/lib/bid/bid-queries";
import type { BidType } from "@/lib/scraper/types";
import {
  getCompanyProfile,
  getStaffComposition,
  listCredentials,
  listHistory,
  type CompanyProfile,
  type CompanyCredential,
  type CompanyHistoryItem,
  type StaffComposition,
} from "@/lib/company/profile";
import { getEmployeeDetail, type EmployeeDetail } from "@/lib/admin/employee-records";
import { INTEGRATED_PERMIT_INDUSTRIES, canonicalServiceSubtype, matchesIndustryText } from "@/lib/ieps/integrated-permit";
import type { StaffConfig } from "@/lib/bid/package-store";

/*
 * 입찰 증빙서류 패키지 P3 — 문서 생성용 데이터 어셈블리.
 * 선택한 실적 계약·수행인력·회사 프로필을 모아 form_profile 필드 키에 대응하는 값을 만든다.
 * (docs/bid-package-blueprint.md §4-2 수퍼셋. 미해석 필드는 빈칸 유지 — 발주처 평가란 등)
 */

export interface PackageContractRow {
  contractId: string;
  year: string;
  category: string; // 동등실적(세분류)
  serviceName: string;
  overview: string; // 시설유형+취득종류 — 1차는 빈칸(수기 보정 전제)
  amountMillion: string; // 백만원 단위(반올림)
  periodText: string; // YY.MM.~YY.MM. (N개월)
  staffCountText: string; // 고급:N 일반:N
  clientName: string;
  clientPhone: string;
}

export interface PackagePersonProject {
  contractId: string;
  client: string;
  projectName: string;
  task: string;
  amountEok: string; // 억원
  periodText: string;
  thenCompany: string;
  thenPosition: string;
}

export interface PackagePerson {
  employeeId: string;
  name: string;
  /** 참여직위(PM/팀장/팀원 — 수행인력 확정에서 지정)·파트 배정 목록(겸직 = 복수 배정) */
  role: string;
  assignments: { sitePart: string; workPart: string }[];
  positionName: string;
  engGrade: string;
  envGrade: string;
  birthDate: string;
  tenureText: string; // 소속사 근무기간
  educationText: string; // 학부/대학원 줄바꿈
  degreeTop: string; // 최고학위(박사>석사>학사)
  licensesText: string; // 자격증(취득일) 줄바꿈
  careerMonthsTotal: string;
  careerMonthsCompany: string;
  perfCount: string; // 자사 참여계약 수
  projects: PackagePersonProject[]; // 자사 참여계약(개별 이력 경력표)
  detail: EmployeeDetail;
}

export interface PackageData {
  bid: { title: string; orgName: string };
  company: {
    profile: CompanyProfile;
    staff: StaffComposition;
    history: CompanyHistoryItem[];
    credentials: CompanyCredential[];
  };
  contracts: PackageContractRow[];
  totalAmountMillion: string;
  persons: PackagePerson[];
  /** 수행인력 설정 원본 — 조직도 생성(사업장/업무 파트·배치 옵션)에 사용 */
  staffConfig: StaffConfig | null;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

function ym(value: string): string {
  const m = value.match(/(\d{4})\D?(\d{1,2})/);
  return m ? `${m[1].slice(2)}.${m[2].padStart(2, "0")}.` : "";
}

function monthsBetween(from: string, to: string): number | null {
  const f = from.match(/(\d{4})\D?(\d{1,2})/);
  const t = to.match(/(\d{4})\D?(\d{1,2})/);
  if (!f || !t) return null;
  return (Number(t[1]) - Number(f[1])) * 12 + (Number(t[2]) - Number(f[2]));
}

function periodText(from: string, to: string): string {
  const f = ym(from);
  const t = ym(to);
  if (!f) return "";
  const months = monthsBetween(from, to);
  const range = `${f}~${t || ""}`;
  return months != null && months >= 0 ? `${range} (${months}개월)` : range;
}

// degreeLevel 코드(bachelor/master/doctor) → 한글 학위명
const DEGREE_LABELS: Record<string, string> = { bachelor: "학사", master: "석사", doctor: "박사" };
const degreeLabel = (level: unknown): string => DEGREE_LABELS[String(level ?? "")] ?? String(level ?? "");
const DEGREE_ORDER = ["박사", "석사", "학사"];

// 용역개요의 '○○시설' 로 표기하는 비제조 업종 — 나머지는 '○○제조시설'.
const FACILITY_SUFFIX_INDUSTRIES = new Set(["발전", "증기열공급", "폐기물처리"]);

/** 소재지 축약 — 광역시/특별시는 시명 축약(울산광역시→울산), 도 산하는 시·군명(군위군→군위). */
function shortRegion(sido: string, sigungu: string): string {
  const sd = sido.trim();
  const sg = sigungu.trim().split(/\s+/)[0] ?? ""; // '경산시 압량읍' 같은 복합 표기는 첫 토큰만
  if (sd.endsWith("도") && sg) {
    return sg.replace(/(시|군|구)$/, "");
  }
  return sd.replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, "");
}

/**
 * 용역개요 자동 생성 — "{소재지 축약} {업종명}(제조)시설 통합환경 {세분류} 대행".
 * 예: 울산 발전시설 통합환경 변경허가 대행 / 경산 반도체제조시설 통합환경 변경신고 대행.
 */
function buildOverview(params: {
  sido: string;
  sigungu: string;
  industryCategory: string;
  industryName: string;
  industryCode: string;
  serviceSubtype: string;
}): string {
  const region = shortRegion(params.sido, params.sigungu);
  // 업종 판정 소스: 계약의 업종분류(industry_category) 우선 + 사업장 업종명/코드(트리 필터와 동일)
  const industry = INTEGRATED_PERMIT_INDUSTRIES.find((i) =>
    matchesIndustryText([params.industryCategory, params.industryName, params.industryCode], i.label)
  );
  const subtype = canonicalServiceSubtype(params.serviceSubtype || null);
  if (!region || !industry || !subtype) return "";
  const suffix = FACILITY_SUFFIX_INDUSTRIES.has(industry.label) ? "시설" : "제조시설";
  return `${region} ${industry.label}${suffix} 통합환경 ${subtype} 대행`;
}

function topDegree(detail: EmployeeDetail): string {
  for (const d of DEGREE_ORDER) {
    if (detail.educations.some((e) => degreeLabel(e.degreeLevel) === d)) return d;
  }
  return detail.educations.length ? degreeLabel(detail.educations[0]?.degreeLevel) : "";
}

function monthsToText(months: number | null): string {
  if (months == null || months < 0) return "";
  return String(months);
}

/** 선택 계약들의 실적 행 + 등급별 참여인원 집계. */
async function loadContractRows(contractIds: string[]): Promise<PackageContractRow[]> {
  if (contractIds.length === 0) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.service_subtype, c.industry_category,
              COALESCE(NULLIF(c.contract_date,''), c.started_at, c.created_at) AS contract_date,
              c.started_at, c.ended_at,
              COALESCE(c.current_amount, c.contract_amount) AS amount,
              cp.company_name AS client_name,
              cp.phone_number AS client_phone,
              sf.region_sido, sf.region_sigungu, sf.industry_name, sf.industry_code,
              (SELECT COUNT(*) FROM service_participants sp
                 JOIN employee_profiles e ON e.employee_id = sp.employee_id
                WHERE sp.contract_id = c.contract_id AND TRIM(COALESCE(e.env_grade,'')) = '고급인력') AS cnt_high,
              (SELECT COUNT(*) FROM service_participants sp
                 JOIN employee_profiles e ON e.employee_id = sp.employee_id
                WHERE sp.contract_id = c.contract_id AND TRIM(COALESCE(e.env_grade,'')) = '일반인력') AS cnt_normal
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities sf ON sf.facility_id = c.facility_id
        WHERE c.contract_id = ANY($1::text[])
        ORDER BY COALESCE(NULLIF(c.contract_date,''), c.started_at, c.created_at) ASC`,
      [contractIds]
    )
  );
  return rows.map((r) => {
    const amount = Number(r.amount ?? 0);
    const started = s(r.started_at) || s(r.contract_date);
    const ended = s(r.ended_at);
    const high = Number(r.cnt_high ?? 0);
    const normal = Number(r.cnt_normal ?? 0);
    return {
      contractId: s(r.contract_id),
      year: s(r.contract_date).slice(0, 4),
      category: s(r.service_subtype) || "동등실적",
      serviceName: s(r.contract_title),
      overview: buildOverview({
        sido: s(r.region_sido),
        sigungu: s(r.region_sigungu),
        industryCategory: s(r.industry_category),
        industryName: s(r.industry_name),
        industryCode: s(r.industry_code),
        serviceSubtype: s(r.service_subtype),
      }),
      amountMillion: amount > 0 ? String(Math.round(amount / 1_000_000)) : "",
      periodText: periodText(started, ended),
      staffCountText: [high > 0 ? `고급:${high}` : "", normal > 0 ? `일반:${normal}` : ""].filter(Boolean).join(" "),
      clientName: s(r.client_name),
      clientPhone: s(r.client_phone),
    };
  });
}

/**
 * 인당 자사 참여계약(개별 이력 경력표) — 참여기간 오름차순.
 * perfFilter(수행실적 설정)로 세분류·업종·연도·금액 범위를 걸러 개별 이력에 넣을 실적만 남기고,
 * excludedContractIds(실적 미리보기에서 제거한 건)는 최종 제외한다.
 * (실적 미리보기 API 에서도 재사용 — export)
 */
export async function loadPersonProjects(
  employeeId: string,
  filter: StaffConfig["perfFilter"] | null,
  excludedContractIds?: string[]
): Promise<PackagePersonProject[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.service_subtype, c.industry_category,
              COALESCE(NULLIF(c.contract_date,''), c.started_at, c.created_at) AS contract_date,
              cp.company_name AS client_name,
              COALESCE(c.current_amount, c.contract_amount) AS amount,
              c.started_at, c.ended_at,
              sf.industry_name, sf.industry_code,
              sp.task_label, sp.participated_from, sp.participated_to
         FROM service_participants sp
         JOIN contracts c ON c.contract_id = sp.contract_id AND c.deleted_at IS NULL
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities sf ON sf.facility_id = c.facility_id
        WHERE sp.employee_id = $1
        ORDER BY COALESCE(NULLIF(sp.participated_from,''), c.started_at) ASC`,
      [employeeId]
    )
  );
  const excluded = new Set(excludedContractIds ?? []);
  const out: PackagePersonProject[] = [];
  for (const r of rows) {
    if (excluded.has(s(r.contract_id))) continue;
    const amount = Number(r.amount ?? 0);
    const from = s(r.participated_from) || s(r.started_at);
    const to = s(r.participated_to) || s(r.ended_at);
    if (filter) {
      // 세분류: 선택 목록이 있으면 그 세분류만('모두 적용' 저장 시 파생 태그 전체가 목록에 담김)
      if (filter.subtypes.length > 0) {
        if (!filter.subtypes.includes(canonicalServiceSubtype(s(r.service_subtype) || null))) continue;
      }
      // 업종: 선택 목록이 있으면 매칭 필수 — 업종 정보(계약 업종분류·사업장 업종)가 없는 계약은 표시하지 않는다
      if (filter.industries.length > 0) {
        const hit = filter.industries.some((label) =>
          matchesIndustryText([s(r.industry_category), s(r.industry_name), s(r.industry_code)], label)
        );
        if (!hit) continue;
      }
      // 연도: 실제 수행 연도(참여 시작→계약 시작→계약일 순) 기준. 빈 배열 = 전체
      if (filter.years.length > 0) {
        const y = (from || s(r.contract_date)).slice(0, 4);
        if (!filter.years.includes(y)) continue;
      }
      // 금액 범위(만원)
      const man = amount / 10_000;
      if (filter.amountMinMan != null && man < filter.amountMinMan) continue;
      if (filter.amountMaxMan != null && man > filter.amountMaxMan) continue;
    }
    out.push({
      contractId: s(r.contract_id),
      client: s(r.client_name),
      projectName: s(r.contract_title),
      task: s(r.task_label),
      amountEok: amount > 0 ? String(Math.round((amount / 100_000_000) * 100) / 100) : "",
      periodText: periodText(from, to),
      thenCompany: "", // 자사 수행 — 생성 시 회사명으로 채움
      thenPosition: "",
    });
  }
  return out;
}

async function loadPerson(
  employeeId: string,
  companyName: string,
  staffConfig: StaffConfig | null
): Promise<PackagePerson | null> {
  const detail = await getEmployeeDetail(employeeId);
  if (!detail) return null;
  // 업종 필터 해제 인력은 선택업종을 무시(용역분류·연도·금액만 적용)
  let perfFilter = staffConfig?.perfFilter ?? null;
  if (perfFilter && staffConfig?.industryBypass?.includes(employeeId)) {
    perfFilter = { ...perfFilter, industries: [] };
  }
  const projects = await loadPersonProjects(employeeId, perfFilter, staffConfig?.excluded?.[employeeId]);
  for (const p of projects) p.thenCompany = companyName;

  const joined = s(detail.hiredAt);
  const now = new Date().toISOString().slice(0, 10);
  const tenureMonths = joined ? monthsBetween(joined, now) : null;
  const tenureText =
    tenureMonths != null && tenureMonths >= 0
      ? `${Math.floor(tenureMonths / 12)}년 ${tenureMonths % 12}개월`
      : "";

  // 관련분야 총 경력 = 타사 경력(careers) + 자사 재직 개월
  let careerMonths = tenureMonths ?? 0;
  for (const c of detail.careers) {
    const m = monthsBetween(s(c.workedFrom), s(c.workedTo) || now);
    if (m != null && m > 0) careerMonths += m;
  }

  const educationText = detail.educations
    .map((e) => {
      const year = s(e.graduationDate).slice(0, 4);
      return [s(e.schoolName), s(e.major), degreeLabel(e.degreeLevel), year ? `(${year})` : ""].filter(Boolean).join(" ");
    })
    .join("\n");
  const licensesText = detail.certifications
    .map((c) => {
      const d = s(c.passedAt) || s(c.issuedAt);
      return `${s(c.certificationName)}${d ? `(${d.slice(2).replace(/-/g, ".")})` : ""}`;
    })
    .join("\n");

  const roleConf = staffConfig?.roles?.[employeeId];
  return {
    employeeId,
    name: s(detail.name),
    role: s(roleConf?.role),
    assignments: roleConf?.assignments ?? [],
    positionName: s(detail.positionName),
    engGrade: s(detail.engGrade),
    envGrade: s(detail.envGrade),
    birthDate: s(detail.birthDate),
    tenureText,
    educationText,
    degreeTop: topDegree(detail),
    licensesText,
    careerMonthsTotal: monthsToText(careerMonths),
    careerMonthsCompany: monthsToText(tenureMonths),
    perfCount: String(projects.length),
    projects,
    detail,
  };
}

/** 패키지 생성 데이터 어셈블리 — 공고·회사·실적 계약·수행인력. */
export async function assemblePackageData(params: {
  bidType: BidType;
  bidId: string;
  contractIds: string[];
  employeeIds: string[];
  staffConfig?: StaffConfig | null;
}): Promise<PackageData> {
  const bid = await getBid(params.bidType, params.bidId);
  if (!bid) throw new Error("공고를 찾을 수 없습니다.");
  const [profile, staff, history, credentials] = await Promise.all([
    getCompanyProfile(),
    getStaffComposition(),
    listHistory(),
    listCredentials(),
  ]);
  const contracts = await loadContractRows(params.contractIds);
  const persons: PackagePerson[] = [];
  for (const id of params.employeeIds) {
    const p = await loadPerson(id, profile.companyName, params.staffConfig ?? null);
    if (p) persons.push(p);
  }
  const totalRaw = contracts.reduce((acc, c) => acc + (Number(c.amountMillion) || 0), 0);
  return {
    bid: { title: s(bid.title), orgName: s(bid.orgName) },
    company: { profile, staff, history, credentials },
    contracts,
    totalAmountMillion: totalRaw > 0 ? String(totalRaw) : "",
    persons,
    staffConfig: params.staffConfig ?? null,
  };
}
