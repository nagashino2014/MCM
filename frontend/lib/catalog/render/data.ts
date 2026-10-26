import { getDb, rowsToObjects } from "@/lib/db";
import {
  applyAppendixRules,
  buildDisplayIndustry,
  buildDisplayTitle,
  formatPermitNo,
  isCompleted,
  type CatalogProjectRow,
} from "@/lib/catalog/appendix";
import { CATALOG_CATEGORIES, SOFTWARE_CATEGORY, areaIndex } from "@/lib/catalog/areas";
import { getPublishedContent } from "@/lib/catalog/contents";
import { listCustomAreas } from "@/lib/catalog/custom-areas";
import type { OrgChartDoc, OrgNode } from "@/lib/catalog/content-types";
import { listClients } from "@/lib/catalog/clients";
import { computeCatalogMetrics, type MetricId, type MetricValue } from "@/lib/catalog/metrics";
import { buildOrgChartFromMaster } from "@/lib/catalog/org-chart";
import { listAdvisors, listCatalogPeople, listExtraPeople, type CatalogPerson } from "@/lib/catalog/people";
import { MASTER_DOC_ID, getAppendixRules, getDocumentTheme, listCatalogProjects } from "@/lib/catalog/projects";
import { REGION_GROUPS, REGION_UNKNOWN } from "@/lib/catalog/regions";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit";
import { getCompanyProfile, listCredentials, listHistory } from "@/lib/company/profile";
import { AREA_DISPLAY_NAME, CLIENT_GROUP_LABEL, MATRIX_DESC, OFFICE_CONTENT, VISION_CONTENT } from "./master-content";
import { initialOf, maskNamesIn, nameMasker } from "./masking";
import type {
  AreaInfo,
  CustomAreaInfo,
  CatalogRenderData,
  ClientGroup,
  CredentialCard,
  HistoryYear,
  LeaderCard,
  MatrixSection,
  Office,
  PersonCv,
  RenderOptions,
  StaffRow,
  StaffStats,
} from "./types";

/*
 * 회사소개서 렌더 데이터(서버) — 한 번의 생성에 쓰는 원천을 한 시점에 모두 읽어 CatalogRenderData 로 만든다.
 * 숫자는 지표 사전(computeCatalogMetrics)과 부록 규칙(applyAppendixRules)에서 나온 값만 쓴다.
 * 마스킹판이면 사람 이름을 여기서 가린다(쪽 컴포넌트는 받은 글자를 그대로 그린다).
 */

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

function kstToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY.MM' → 연 단위 실수(월 중간값) */
function ymToYears(v: string): number | null {
  const m = v.match(/(\d{4})\D?(\d{1,2})?/);
  if (!m) return null;
  return Number(m[1]) + (Number(m[2] ?? 6) - 0.5) / 12;
}

const DEGREE_RANK: Record<string, number> = { doctor: 3, master: 2, bachelor: 1 };
const DEGREE_LABEL: Record<string, string> = { doctor: "박사", master: "석사", bachelor: "학사" };

interface HrDetail {
  edu: Array<{ level: string; school: string; major: string }>;
  certs: string[];
  careers: Array<{ from: string; to: string; company: string; position: string }>;
}

async function loadHrDetails(employeeIds: string[]): Promise<Map<string, HrDetail>> {
  const out = new Map<string, HrDetail>();
  for (const id of employeeIds) out.set(id, { edu: [], certs: [], careers: [] });
  if (employeeIds.length === 0) return out;
  const db = await getDb();
  const [edu, cert, career] = await Promise.all([
    db.exec(
      `SELECT employee_id, degree_level, school_name, COALESCE(major, '') AS major FROM employee_educations
        WHERE employee_id = ANY($1) ORDER BY employee_id, display_order, graduation_date DESC NULLS LAST`,
      [employeeIds]
    ),
    db.exec(
      `SELECT employee_id, certification_name FROM employee_certifications
        WHERE employee_id = ANY($1) ORDER BY employee_id, display_order, certification_name`,
      [employeeIds]
    ),
    db.exec(
      `SELECT employee_id, COALESCE(worked_from, '') AS worked_from, COALESCE(worked_to, '') AS worked_to,
              COALESCE(company_name, '') AS company_name, COALESCE(final_position, '') AS final_position
         FROM employee_careers WHERE employee_id = ANY($1) ORDER BY employee_id, display_order, worked_from`,
      [employeeIds]
    ),
  ]);
  for (const r of rowsToObjects(edu)) out.get(s(r.employee_id))?.edu.push({ level: s(r.degree_level), school: s(r.school_name), major: s(r.major) });
  for (const r of rowsToObjects(cert)) out.get(s(r.employee_id))?.certs.push(s(r.certification_name));
  for (const r of rowsToObjects(career)) {
    out.get(s(r.employee_id))?.careers.push({ from: s(r.worked_from), to: s(r.worked_to), company: s(r.company_name), position: s(r.final_position) });
  }
  return out;
}

function highestEdu(d: HrDetail | undefined): { level: string; text: string } {
  const best = [...(d?.edu ?? [])].sort((a, b) => (DEGREE_RANK[b.level] ?? 0) - (DEGREE_RANK[a.level] ?? 0))[0];
  if (!best) return { level: "", text: "" };
  const school = best.school.replace(/학교$/, "");
  return { level: best.level, text: [school, best.major, DEGREE_LABEL[best.level] ?? ""].filter(Boolean).join(" ") };
}

/** 총 경력 = 이전 직장 경력 합 + 입사 이후(현재까지) */
function careerYears(p: CatalogPerson, d: HrDetail | undefined, nowYears: number): number | null {
  let total = 0;
  let known = false;
  for (const c of d?.careers ?? []) {
    const f = ymToYears(c.from);
    const t = c.to ? ymToYears(c.to) : null;
    if (f != null && t != null && t > f) {
      total += t - f;
      known = true;
    }
  }
  const h = ymToYears(p.hiredAt);
  if (h != null && nowYears > h) {
    total += nowYears - h;
    known = true;
  }
  return known ? Math.max(0, Math.floor(total)) : null;
}

function careerSummary(years: number | null, bio: string, d: HrDetail | undefined): string {
  const prev = (d?.careers ?? [])
    .filter((c) => c.company)
    .slice(-3)
    .map((c) => `${c.company}${c.position ? " " + c.position : ""}`)
    .join(", ");
  const text = bio || (prev ? `前 ${prev}` : "");
  return [years != null ? `${years}년` : "", text].filter(Boolean).join(" · ");
}

function periodShort(row: Pick<CatalogProjectRow, "startedAt" | "endedAt" | "contractDate" | "completedAt">): string {
  const ym = (v: string) => {
    const m = v.match(/(\d{4})\D?(\d{1,2})/);
    return m ? `${m[1]}.${m[2].padStart(2, "0")}` : "";
  };
  const from = ym(row.startedAt) || ym(row.contractDate);
  const to = ym(row.endedAt) || ym(row.completedAt);
  if (!from) return "";
  return to ? `${from}–${to}` : `${from}–`;
}

/** 대표 실적 줄 표기 — 대외 표기명에서 '준공(허가일, 결정번호)'·'수행 중' 꼬리를 뗀다(그 정보는 오른쪽 칸에 따로 쓴다). */
function caseTitle(row: CatalogProjectRow): string {
  const t = row.meta?.displayTitle.trim() || buildDisplayTitle(row);
  return t.replace(/\s*준공\s*(\([^)]*\))?\s*$/, "").replace(/\s*수행 중\s*$/, "").trim();
}

/** 대표 실적 한 줄(연도·표기·허가일 또는 기간) — 분야 쪽(C09)·새 분야 쪽 공용 */
export function caseRow(p: CatalogProjectRow): { year: string; title: string; meta: string } {
  return {
    year: p.year,
    title: caseTitle(p),
    meta:
      p.category === CATALOG_CATEGORIES[0] && p.permitIssuedAt
        ? [p.permitIssuedAt.slice(0, 10), formatPermitNo(p.permitNo) ? `제${formatPermitNo(p.permitNo)}호` : ""].filter(Boolean).join(" · ")
        : periodShort(p),
  };
}

const MAP_REGION: Record<string, string> = { "yeongnam-n": "tk", "yeongnam-s": "bug" };
export const mapRegionId = (id: string) => MAP_REGION[id] ?? id;

function buildMatrix(rows: CatalogProjectRow[], names: Record<string, string>): MatrixSection[] {
  const regionIds = REGION_GROUPS.map((g) => g.id);
  const out: MatrixSection[] = [];
  for (const category of CATALOG_CATEGORIES) {
    const list = rows.filter((r) => r.category === category);
    const idx = areaIndex(category);
    const tally = (subset: CatalogProjectRow[]) => {
      const byRegion: Record<string, number> = Object.fromEntries([...regionIds, REGION_UNKNOWN.id].map((id) => [id, 0]));
      for (const r of subset) byRegion[r.regionGroup && regionIds.includes(r.regionGroup) ? r.regionGroup : REGION_UNKNOWN.id] += 1;
      return { total: subset.length, byRegion };
    };
    const years = [...new Set(list.map((r) => Number(r.year)).filter((y) => y > 0))].sort((a, b) => a - b);
    const first = years[0];
    const last = years[years.length - 1];
    const span = (a?: number, b?: number) => (a == null ? "-" : a === b ? String(a) : `${a}–${b ?? ""}`);
    const sec: MatrixSection = { category, index: idx, name: names[category] ?? category, desc: MATRIX_DESC[category] ?? "", rows: [] };
    sec.rows.push({ label: "소계", period: list.length ? span(first, last) : "-", ...tally(list), isTotal: true });
    // 연도별 행은 통합환경허가만(현행 총괄표와 같은 모양, 한 쪽에 들어가게) — 다른 분야는 2020년까지·2021년부터 두 줄
    if (idx === 1 && list.length >= 10) {
      const early = list.filter((r) => Number(r.year) > 0 && Number(r.year) <= 2020);
      if (early.length) sec.rows.push({ label: "", period: span(first, Math.min(2020, last)), ...tally(early), isTotal: false });
      for (const y of years.filter((y) => y > 2020)) sec.rows.push({ label: "", period: String(y), ...tally(list.filter((r) => Number(r.year) === y)), isTotal: false });
    } else if (list.length >= 10) {
      const early = list.filter((r) => Number(r.year) > 0 && Number(r.year) <= 2020);
      const late = list.filter((r) => Number(r.year) > 2020);
      if (early.length && late.length) {
        sec.rows.push({ label: "", period: span(first, 2020), ...tally(early), isTotal: false });
        sec.rows.push({ label: "", period: `2021–`, ...tally(late), isTotal: false });
      }
    }
    out.push(sec);
  }
  return out;
}

function maskOrg(doc: OrgChartDoc, names: string[]): OrgChartDoc {
  const walk = (n: OrgNode): OrgNode => ({ ...n, label: maskNamesIn(n.label, names), sub: maskNamesIn(n.sub, names), children: n.children.map(walk) });
  return { nodes: doc.nodes.map(walk) };
}

export interface LoadOptions extends RenderOptions {
  docId?: string;
}

export async function loadCatalogRenderData(o: LoadOptions): Promise<CatalogRenderData> {
  const docId = o.docId ?? MASTER_DOC_ID;
  const masked = o.naming === "masked";
  const db = await getDb();
  const asOf = kstToday();
  const nowYear = Number(asOf.slice(0, 4));
  const nowYears = nowYear + (Number(asOf.slice(5, 7)) - 0.5) / 12;

  const [theme, rules, projects, profile, history, credentials, people, extras, advisors, ceoMsg, orgPublished, clients, figureRows, areaRows, customDefs] =
    await Promise.all([
      getDocumentTheme(docId),
      getAppendixRules(docId),
      listCatalogProjects(),
      getCompanyProfile(),
      listHistory(),
      listCredentials(),
      listCatalogPeople(),
      listExtraPeople(),
      listAdvisors(),
      getPublishedContent("ceo_message"),
      getPublishedContent("org_chart"),
      listClients(),
      db.exec("SELECT figure_key, value FROM catalog_external_figures"),
      db.exec("SELECT name, display_name FROM catalog_business_areas WHERE is_active = 1 AND content IS NULL"),
      listCustomAreas(),
    ]);
  // 마스킹판도 대표이사는 실명·사진(사용자 결정 2026-10-26) — 회사 프로필 대표자·인사말 서명·직위 '대표이사' 재직자
  const ceoNames = [profile.ceoName, ceoMsg?.signName ?? "", ...people.filter((p) => p.positionName === "대표이사").map((p) => p.name)];
  const { nm, maskList } = nameMasker(masked, ceoNames);
  const metricsBundle = await computeCatalogMetrics({ projects, people, extraPeople: extras });
  const metrics = Object.fromEntries(metricsBundle.metrics.map((m) => [m.id, m])) as Record<MetricId, MetricValue>;
  const notices: string[] = [];

  const figures: Record<string, number> = {};
  for (const r of rowsToObjects(figureRows)) if (r.value != null) figures[s(r.figure_key)] = Number(r.value);
  const names: Record<string, string> = { ...Object.fromEntries(CATALOG_CATEGORIES.map((c) => [c, AREA_DISPLAY_NAME[c] ?? c])) };
  for (const r of rowsToObjects(areaRows)) if (s(r.display_name)) names[s(r.name)] = s(r.display_name);

  // ── 부록·총괄 ──
  const appendix = applyAppendixRules(projects, rules, nowYear);
  const shownIds = new Set(appendix.sections.flatMap((sec) => sec.years.flatMap((y) => y.rows.flatMap((r) => r.contractIds))));
  const basis = rules.summaryBasis === "all" ? projects : projects.filter((p) => shownIds.has(p.contractId));
  const matrix = buildMatrix(basis, names);
  const permitByRegion: Record<string, number> = {};
  for (const p of basis.filter((r) => r.category === CATALOG_CATEGORIES[0])) {
    const id = mapRegionId(p.regionGroup || REGION_UNKNOWN.id);
    permitByRegion[id] = (permitByRegion[id] ?? 0) + 1;
  }

  // ── 사업 분야 ──
  const areas: AreaInfo[] = CATALOG_CATEGORIES.map((category, i) => {
    const list = projects.filter((p) => p.category === category);
    const years = list.map((p) => Number(p.year)).filter((y) => y > 0);
    const featuredRows = list.filter((p) => p.meta?.isFeatured && (p.meta?.isPublic ?? true));
    const fallback = featuredRows.length === 0;
    const pick = (fallback ? list.filter((p) => isCompleted(p) && (p.meta?.isPublic ?? true) && (p.amount ?? 0) > 0).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)) : featuredRows)
      .slice(0, 4)
      .sort((a, b) => (a.year || "").localeCompare(b.year || ""));
    if (fallback && list.length > 0) notices.push(`${names[category] ?? category}: '대표 실적'으로 표시한 계약이 없어 금액이 큰 준공 계약으로 대표 실적을 채웠습니다(실적 노출 관리에서 지정).`);
    return {
      index: i + 1,
      category,
      name: names[category] ?? category,
      count: list.length,
      completed: list.filter(isCompleted).length,
      recent3: list.filter((p) => Number(p.year) >= nowYear - 2).length,
      regions: new Set(list.map((p) => p.regionGroup).filter((g) => g && g !== REGION_UNKNOWN.id)).size,
      firstYear: years.length ? String(Math.min(...years)) : "",
      featured: pick.map(caseRow),
      featuredFallback: fallback && pick.length > 0,
    };
  });

  // ── 새 사업 분야(P6) — 대표 실적은 지정한 계약 중 공개 계약만 ──
  const projectById = new Map(projects.map((p) => [p.contractId, p]));
  const customAreas: CustomAreaInfo[] = customDefs.map((d) => ({
    id: d.areaId,
    key: `area-${d.areaId}`,
    name: d.name,
    slot: d.slot,
    content: d.content,
    featured: d.content.featured
      .map((id) => projectById.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null && (p.meta?.isPublic ?? true))
      .sort((a, b) => (a.year || "").localeCompare(b.year || ""))
      .map(caseRow),
  }));

  // 통합허가 수행 업종(20개 업종 라벨) — 계약 수 많은 순
  const labelSet = new Set(INTEGRATED_PERMIT_INDUSTRIES.map((x) => x.label));
  const industryCount = new Map<string, number>();
  for (const p of projects.filter((r) => r.category === CATALOG_CATEGORIES[0])) {
    const l = buildDisplayIndustry(p);
    if (labelSet.has(l)) industryCount.set(l, (industryCount.get(l) ?? 0) + 1);
  }
  const permitIndustries = [...industryCount.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);

  // ── 연혁 ──
  const historyYears = new Map<string, HistoryYear>();
  for (const h of history.filter((x) => x.isPublic).sort((a, b) => a.eventYm.localeCompare(b.eventYm))) {
    const year = h.eventYm.slice(0, 4);
    if (!historyYears.has(year)) historyYears.set(year, { year, highlight: false, items: [] });
    const y = historyYears.get(year)!;
    y.items.push({ month: h.eventYm.slice(5, 7), content: h.content, category: h.category, highlight: h.highlight });
    if (h.highlight) y.highlight = true;
  }

  // ── 인증·등록·특허 ──
  const KIND: Record<string, string> = { license: "등록", certification: "인증", patent: "특허", award: "수상" };
  const KIND_ORDER: Record<string, number> = { license: 0, certification: 1, patent: 2, award: 3 };
  const credCards: CredentialCard[] = credentials
    .filter((c) => c.isPublic)
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (a.issuedAt || "9999").localeCompare(b.issuedAt || "9999"))
    .map((c) => {
      const ym = c.issuedAt.match(/(\d{4})\D?(\d{1,2})/);
      const isImage = Boolean(c.file && /\.(png|jpe?g|webp)$/i.test(c.file.fileName));
      return {
        key: c.credentialId,
        kind: KIND[c.kind] ?? "등록",
        name: c.name,
        meta: [c.credentialNo, ym ? `${ym[1]}.${ym[2].padStart(2, "0")}` : ""].filter(Boolean).join(" · "),
        image: isImage ? `c/${c.credentialId}` : null,
      };
    });

  // ── 사람 ──
  const shownPeople = people.filter((p) => p.shown);
  const hr = await loadHrDetails(people.map((p) => p.employeeId));
  // 마스킹판은 대표이사 말고는 사람 사진을 모두 뺀다(블루프린트 §6-6 — 이름 가리기와 함께 쪽마다 다르지 않게 일괄 적용, 사진 자리는 이니셜)
  const photoKey = (p: CatalogPerson) =>
    (masked && p.positionName !== "대표이사") || !p.photoShown ? null : p.meta?.photoAssetId ? `a/${p.meta.photoAssetId}` : p.photoPath ? `e/${p.employeeId}` : null;
  const ceoPerson = people.find((p) => p.positionName === "대표이사") ?? null;
  const toLeader = (p: CatalogPerson): LeaderCard => {
    const d = hr.get(p.employeeId);
    const years = careerYears(p, d, nowYears);
    return {
      key: p.employeeId,
      name: nm(p.name),
      initial: initialOf(p.name),
      role: p.meta?.roleLabel || p.positionName,
      photo: photoKey(p),
      edu: highestEdu(d).text,
      cert: (d?.certs ?? []).slice(0, 4).join(", "),
      career: careerSummary(years, p.meta?.bioShort ?? "", d),
      careerYears: years,
      manual: false,
    };
  };
  type Sortable = { card: LeaderCard; order: number; rank: number };
  const leaderItems: Sortable[] = shownPeople
    .filter((p) => p.section === "exec")
    .map((p) => ({ card: toLeader(p), order: p === ceoPerson ? -1 : (p.meta?.orderNo ?? 1000), rank: p.rankOrder ?? 0 }));
  for (const x of extras.filter((e) => e.isPublic)) {
    const yearsMatch = (x.career + " " + x.bioShort).match(/경력\s*(\d{1,2})\s*년/);
    leaderItems.push({
      card: {
        key: x.personId,
        name: nm(x.name),
        initial: initialOf(x.name),
        role: x.roleLabel || x.employmentType,
        photo: !masked && x.photoAssetId ? `a/${x.photoAssetId}` : null,
        edu: "",
        cert: "",
        career: [x.career, x.bioShort].filter(Boolean).join(" · "),
        careerYears: yearsMatch ? Number(yearsMatch[1]) : null,
        manual: true,
      },
      order: x.orderNo ?? 1000,
      rank: 0,
    });
  }
  leaderItems.sort((a, b) => a.order - b.order || b.rank - a.rank);
  const leaders = leaderItems.map((x) => x.card);
  const leaderYears = leaders.map((l) => l.careerYears).filter((v): v is number => v != null);
  const leaderAvgCareer = leaderYears.length ? Math.round(leaderYears.reduce((a, b) => a + b, 0) / leaderYears.length) : null;

  // 기술인력 현황 — 모집단 = 사용자관리 재직자(촉탁 제외)
  const certCount = new Map<string, number>();
  const degrees = { doctor: 0, master: 0, bachelor: 0, other: 0 };
  const buckets: [number, number, number, number] = [0, 0, 0, 0];
  let experts = 0;
  let pro = 0;
  let doctors = 0;
  const yearsAll: number[] = [];
  for (const p of people) {
    const d = hr.get(p.employeeId);
    for (const c of new Set(d?.certs ?? [])) certCount.set(c, (certCount.get(c) ?? 0) + 1);
    const lvl = highestEdu(d).level;
    if (lvl === "doctor" || lvl === "master" || lvl === "bachelor") degrees[lvl] += 1;
    else degrees.other += 1;
    const isPro = (d?.certs ?? []).some((c) => c.includes("기술사"));
    if (isPro) pro += 1;
    if (lvl === "doctor") doctors += 1;
    if (isPro || lvl === "doctor") experts += 1;
    const y = careerYears(p, d, nowYears);
    if (y != null) {
      yearsAll.push(y);
      buckets[y >= 20 ? 0 : y >= 10 ? 1 : y >= 5 ? 2 : 3] += 1;
    }
  }
  const staffStats: StaffStats = {
    technical: Number(metrics["staff.technical"]?.value ?? 0),
    experts,
    expertNote: [pro ? `기술사 ${pro}` : "", doctors ? `박사 ${doctors}` : ""].filter(Boolean).join(" · "),
    avgCareer: yearsAll.length ? Math.round((yearsAll.reduce((a, b) => a + b, 0) / yearsAll.length) * 10) / 10 : null,
    certs: [...certCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, 8).map(([name, count]) => ({ name, count })),
    degrees,
    careerBuckets: buckets,
    population: people.length,
  };
  const staffRows: StaffRow[] = shownPeople
    .filter((p) => p.section === "staff")
    .sort((a, b) => (b.rankOrder ?? 0) - (a.rankOrder ?? 0) || a.hiredAt.localeCompare(b.hiredAt))
    .map((p) => {
      const d = hr.get(p.employeeId);
      return {
        key: p.employeeId,
        name: nm(p.name),
        position: p.positionName,
        dept: p.deptName,
        edu: highestEdu(d).text,
        certs: (d?.certs ?? []).join(", "),
        years: careerYears(p, d, nowYears),
      };
    });

  // ── 부록 C 수행인력 상세 이력(실명판만) ──
  let cvs: PersonCv[] = [];
  if (!masked) {
    const cvPeople = shownPeople.filter((p) => p.section === "exec" || p.section === "staff");
    const ids = cvPeople.map((p) => p.employeeId);
    const partRows = ids.length
      ? rowsToObjects(
          await db.exec(
            `SELECT sp.employee_id, c.contract_id, c.contract_title, COALESCE(sp.role_label, sp.task_label, '') AS role,
                    SUBSTRING(COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at), 1, 4) AS year
               FROM service_participants sp JOIN contracts c ON c.contract_id = sp.contract_id AND c.deleted_at IS NULL
              WHERE sp.employee_id = ANY($1)
              ORDER BY year DESC NULLS LAST`,
            [ids]
          )
        )
      : [];
    const byContract = new Map(projects.map((p) => [p.contractId, p]));
    cvs = cvPeople.map((p) => {
      const d = hr.get(p.employeeId);
      const years = careerYears(p, d, nowYears);
      const parts = partRows.filter((r) => s(r.employee_id) === p.employeeId).slice(0, 4);
      return {
        key: p.employeeId,
        name: p.name,
        role: [p.meta?.roleLabel || p.positionName, p.deptName].filter(Boolean).join(" · "),
        years,
        duty: p.deptName,
        photo: photoKey(p),
        edu: (d?.edu ?? []).map((e) => [e.school, e.major, DEGREE_LABEL[e.level] ?? ""].filter(Boolean).join(" ")).join(" · "),
        cert: (d?.certs ?? []).join(" · "),
        // 약력 요약이 있으면 그것을, 없으면 인사 기록의 이전 직장 경력을 쓴다(둘을 이으면 같은 경력이 겹친다)
        career: p.meta?.bioShort || (d?.careers ?? []).map((c) => [c.company, c.position].filter(Boolean).join(" ")).filter(Boolean).join(" · "),
        projects: parts.map((r) => {
          const row = byContract.get(s(r.contract_id));
          return { year: s(r.year), title: [row ? caseTitle(row) : s(r.contract_title), s(r.role)].filter(Boolean).join(" — ") };
        }),
      };
    });
  }

  // ── 조직도 ──
  let orgChart = orgPublished ?? null;
  if (!orgChart) {
    orgChart = await buildOrgChartFromMaster();
    notices.push("조직도 확정판이 없어 MCM 조직 마스터에서 만든 기본안으로 그렸습니다(회사소개서 > 조직도에서 확정).");
  }
  if (masked) orgChart = maskOrg(orgChart, maskList([...people.map((p) => p.name), ...extras.map((x) => x.name)]));

  // ── 고객사 ──
  const groups = new Map<string, ClientGroup>();
  for (const c of clients.filter((x) => x.isPublic)) {
    const g = CLIENT_GROUP_LABEL[c.category] ?? { label: c.category, sub: "" };
    if (!groups.has(c.category)) groups.set(c.category, { label: g.label, sub: g.sub, items: [] });
    groups.get(c.category)!.items.push({ name: c.name, logo: c.logoAssetId ? `a/${c.logoAssetId}` : null });
  }

  // ── 대표이사 인사말 ──
  let ceoMessage: CatalogRenderData["ceoMessage"] = null;
  if (ceoMsg && ceoMsg.body.trim()) {
    const paragraphs = ceoMsg.body.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    const titleIsQuote = ceoMsg.title && ceoMsg.title !== "인사말";
    ceoMessage = {
      title: "대표이사 인사말",
      quote: titleIsQuote ? ceoMsg.title : "",
      paragraphs,
      signTitle: ceoMsg.signTitle || "대표이사",
      signName: nm(ceoMsg.signName || profile.ceoName),
      draft: false,
    };
  } else {
    notices.push("대표이사 인사말 확정판이 없어 인사말 쪽을 뺐습니다(회사소개서 > 대표이사 인사말에서 확정).");
  }

  // ── 회사·사무소 ──
  const fm = profile.foundedYm.match(/(\d{4})\D?(\d{1,2})?/);
  const fin = [...profile.finance].filter((f) => Number(f.revenue) > 0).sort((a, b) => b.year.localeCompare(a.year))[0];
  const credit = [...profile.credit].sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))[0];
  const hqLines = profile.address.split(/,\s*/);
  const offices: Office[] = [
    {
      key: "hq",
      name: OFFICE_CONTENT.hq.name,
      nameEn: OFFICE_CONTENT.hq.nameEn,
      address: profile.address,
      addressLines: hqLines.length > 1 ? [hqLines[0], hqLines.slice(1).join(", ")] : [profile.address],
      phone: profile.phone,
      transit: OFFICE_CONTENT.hq.transit,
      lon: OFFICE_CONTENT.hq.lon,
      lat: OFFICE_CONTENT.hq.lat,
      photo: "k/assets/hq-building-3.webp",
    },
    ...OFFICE_CONTENT.branches.map((b) => ({ ...b, photo: null })),
  ];
  if (!profile.address) notices.push("회사 프로필에 본사 주소가 없습니다.");

  // 주요 등록 — 등록번호가 있는 것(대행업 등록 등)을 앞에, 그다음 최근 등록 순
  const registrations = credentials
    .filter((c) => c.isPublic && c.kind === "license")
    .sort((a, b) => Number(Boolean(b.credentialNo)) - Number(Boolean(a.credentialNo)) || (b.issuedAt || "").localeCompare(a.issuedAt || ""))
    .map((c) => (c.credentialNo ? `${c.name} ${c.credentialNo}` : c.name));
  const asOfLabel = `${asOf.slice(0, 4)}. ${Number(asOf.slice(5, 7))}`;

  return {
    asOf,
    asOfLabel,
    docLabel: `회사소개서 ${asOf.slice(0, 4)}.${Number(asOf.slice(5, 7))}`,
    theme,
    rules,
    company: {
      name: profile.companyName || "㈜한국환경안전연구원",
      nameShort: VISION_CONTENT.nameShort,
      nameEn: VISION_CONTENT.nameEn,
      ceoName: nm(profile.ceoName),
      ceoTitle: "대표이사",
      foundedYear: fm?.[1] ?? "",
      foundedMonth: fm?.[2] ? String(Number(fm[2])) : "",
      website: profile.website,
      email: profile.email,
      phone: profile.phone,
      vision: profile.vision,
      slogan: profile.slogan,
      revenue: fin ? { year: fin.year, millionWon: Math.round(Number(fin.revenue) / 1_000_000) } : null,
      credit: credit ? { grade: credit.creditGrade, agency: credit.agency, ratedAt: credit.ratedAt } : null,
      registrations,
    },
    offices,
    metrics,
    initialPermit: metricsBundle.initialPermit,
    figures,
    areas,
    customAreas,
    appendix,
    projectIndex: Object.fromEntries(projects.map((p) => [p.contractId, { subtype: p.subtype, permitIssuedAt: p.permitIssuedAt }])),
    matrix,
    regionColumns: REGION_GROUPS.map((g) => ({ id: g.id, label: g.label.replace(/^영남권\((.*)\)$/, "$1") })),
    permitByRegion,
    permitIndustries,
    history: [...historyYears.values()],
    credentials: credCards,
    ceoMessage,
    ceo: ceoPerson ? toLeader(ceoPerson) : null,
    leaders,
    leaderAvgCareer,
    staffStats,
    staffRows,
    advisors: advisors.filter((a) => a.isPublic).map((a) => ({ key: a.advisorId, name: nm(a.name), field: a.field, org: a.org, title: a.title, career: a.career })),
    orgChart,
    clients: [...groups.values()],
    people: cvs,
    maskNames: maskList([...people.map((p) => p.name), ...extras.map((x) => x.name), ...advisors.map((a) => a.name)]),
    notices: [...new Set(notices)],
  };
}

export { SOFTWARE_CATEGORY };
