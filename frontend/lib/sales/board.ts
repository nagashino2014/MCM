/*
 * Salesboard(/sales) 목록 필터·KPI·영업 현황 집계(클라이언트 안전 — DB 접근 없음).
 * 2026-10-29: 영업건이 수천 건이 돼도 화면이 버티도록, 원래 SalesBoard·SalesInsights 가 클라이언트에서 하던 판정을
 *   그대로 옮겨 서버(/api/sales/projects?limit=…, /api/sales/board-stats)가 계산한다. 화면 숫자는 이전과 같아야 하므로
 *   판정식(올해 = outcomeAt→closedAt→openedAt, 도달 단계, 담당 = 담당자 또는 대표 멤버 등)을 바꾸지 않는다.
 * 입력 projects 는 가시성 scope(X-03)가 적용된 listSalesProjects 결과(updated_at 내림차순)다.
 */

import { salesRegionGroupId } from "./regions";
import { SALES_SERVICE_CATEGORIES, type SalesProject, type SalesStage } from "./types";

// KPI 칸 클릭 필터(하나만)
export type SalesKpiFilter = "active" | "new" | "won" | "lost" | "outcome";
export const SALES_KPI_FILTERS: SalesKpiFilter[] = ["active", "new", "won", "lost", "outcome"];

/** 업종분류 태그의 미분류 id */
export const SALES_CATEGORY_UNSET = "unset";

// 퍼널 단계(도달 단계 기준) — 첫 칸은 전체(모든 영업건이 리드 이상)
export const FUNNEL_STEPS: { stage: SalesStage; label: string }[] = [
  { stage: "lead", label: "전체 영업건" },
  { stage: "contact", label: "컨택 이상" },
  { stage: "proposal", label: "제안 이상" },
  { stage: "bidding", label: "입찰 이상" },
  { stage: "won", label: "수주" },
];
const RANK: Partial<Record<SalesStage, number>> = { lead: 0, contact: 1, proposal: 2, bidding: 3, won: 4 };
/** 도달 단계가 stage 이상인지 — 목록 필터와 W4 가 같은 판정을 쓴다. */
export const reachedAtLeast = (p: SalesProject, stage: SalesStage) =>
  (RANK[p.reachedStage ?? (p.stage === "won" ? "won" : "lead")] ?? 0) >= (RANK[stage] ?? 0);

export const kstNowIso = () => new Date(Date.now() + 9 * 3600000).toISOString();
export const isActiveProject = (p: SalesProject) => p.status !== "closed" && p.stage !== "won" && p.stage !== "lost";
const openedMonth = (p: SalesProject) => (p.openedAt ?? p.createdAt ?? "").slice(0, 7);
// 결과 확정 연도 — 결과 스케쥴 날짜, 없으면(스케쥴 없이 단계만 저장된 옛 건) 종료일·시작일.
const outcomeYear = (p: SalesProject) => (p.outcomeAt ?? p.closedAt ?? p.openedAt ?? "").slice(0, 4);
const projectCategoryId = (p: SalesProject) => p.serviceCategory ?? SALES_CATEGORY_UNSET;
const isOwnedBy = (p: SalesProject, employeeId: string) => p.ownerEmployeeId === employeeId || p.leadMemberId === employeeId;

// ── 목록 필터 ────────────────────────────────────────────────

export interface SalesBoardFilter {
  q: string;
  owner: string;
  year: string;
  regionIds: string[];
  categoryIds: string[];
  kpi: SalesKpiFilter | null;
  reached: SalesStage | null;
}

const listParam = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** URL 쿼리 ↔ 필터. 클라이언트(요청 생성)와 서버(해석)가 같은 키를 쓴다. */
export function boardFilterToParams(f: SalesBoardFilter): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.owner) sp.set("owner", f.owner);
  if (f.year) sp.set("year", f.year);
  if (f.regionIds.length) sp.set("region", [...f.regionIds].sort().join(","));
  if (f.categoryIds.length) sp.set("category", [...f.categoryIds].sort().join(","));
  if (f.kpi) sp.set("kpi", f.kpi);
  if (f.reached) sp.set("reached", f.reached);
  return sp;
}

export function parseBoardFilter(sp: URLSearchParams): SalesBoardFilter {
  const kpi = sp.get("kpi") as SalesKpiFilter | null;
  const reached = sp.get("reached") as SalesStage | null;
  return {
    q: sp.get("q") ?? "",
    owner: sp.get("owner") ?? "",
    year: sp.get("year") ?? "",
    regionIds: listParam(sp.get("region")),
    categoryIds: listParam(sp.get("category")),
    kpi: kpi && SALES_KPI_FILTERS.includes(kpi) ? kpi : null,
    reached: reached && RANK[reached] != null ? reached : null,
  };
}

export interface SalesBoardListResult {
  rows: SalesProject[];
  /** 태그별 건수 — 같은 그룹의 선택은 빼고(OR 라 선택해도 늘어나는 수를 보이게), 다른 그룹 선택은 적용 */
  regionCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
}

export function filterBoardProjects(projects: SalesProject[], f: SalesBoardFilter, now = kstNowIso()): SalesBoardListResult {
  const thisYear = now.slice(0, 4);
  const thisMonth = now.slice(0, 7);
  const matchKpi = (p: SalesProject) => {
    switch (f.kpi) {
      case "active": return isActiveProject(p);
      case "new": return openedMonth(p) === thisMonth;
      case "won": return p.stage === "won" && outcomeYear(p) === thisYear;
      case "lost": return p.stage === "lost" && outcomeYear(p) === thisYear;
      case "outcome": return (p.stage === "won" || p.stage === "lost") && outcomeYear(p) === thisYear;
      default: return true;
    }
  };
  // 상단 필터(검색·담당·연도)와 KPI·도달 단계 필터를 적용한 모집단. 태그 건수는 여기서 "다른 그룹 선택"까지 적용해 센다.
  const s = f.q.trim().toLowerCase();
  const base = projects.filter((p) => {
    if (s && !(p.title.toLowerCase().includes(s) || (p.facilityName ?? "").toLowerCase().includes(s))) return false;
    if (f.owner && !isOwnedBy(p, f.owner)) return false;
    if (f.year && (p.openedAt ?? "").slice(0, 4) !== f.year) return false;
    if (!matchKpi(p)) return false;
    if (f.reached && !reachedAtLeast(p, f.reached)) return false;
    return true;
  });
  const regionOf = (p: SalesProject) => salesRegionGroupId(p.regionSido);
  const matchRegion = (p: SalesProject) => f.regionIds.length === 0 || f.regionIds.includes(regionOf(p));
  const matchCategory = (p: SalesProject) => f.categoryIds.length === 0 || f.categoryIds.includes(projectCategoryId(p));

  const regionCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  for (const p of base) {
    if (matchCategory(p)) regionCounts[regionOf(p)] = (regionCounts[regionOf(p)] ?? 0) + 1;
    if (matchRegion(p)) categoryCounts[projectCategoryId(p)] = (categoryCounts[projectCategoryId(p)] ?? 0) + 1;
  }
  return { rows: base.filter((p) => matchRegion(p) && matchCategory(p)), regionCounts, categoryCounts };
}

// ── KPI 띠·영업 현황 집계 ─────────────────────────────────────

export interface SalesStaffStat {
  active: number;
  /** 14일 안 예정 스케쥴 수(다가오는 일정 탭과 같은 모집단) */
  upcoming: number;
  /** 미보고 경과 스케쥴 수(경과 보고 탭과 같은 모집단) */
  pending: number;
  wonYear: number;
}

export interface SalesBoardStats {
  thisYear: string;
  thisMonth: string;
  /** 보이는 영업건 전체 건수 */
  visibleTotal: number;
  /** 연도 필터 선택지(opened_at 연도, 내림차순) */
  years: string[];
  kpi: {
    active: number;
    activeByStage: Record<"lead" | "contact" | "proposal" | "bidding" | "hold", number>;
    newThisMonth: number;
    newPrevMonth: number;
    won: number;
    lost: number;
  };
  /** W4 — FUNNEL_STEPS 순서의 도달 건수 */
  funnel: number[];
  /** W5 — 4대 분류 + 미분류, 세분류는 건수 내림차순(같으면 목록 순서) */
  categories: { id: string; n: number; subs: { code: string; n: number }[] }[];
  /** W6 — 올해·작년·재작년 */
  outcomes: { year: string; won: number; lost: number; wonAmt: number; bidAmt: number; priced: number; total: number }[];
  /** W7 — 담당 직원 id 별(담당자 또는 대표 멤버). 한 영업건이 두 사람에게 함께 잡힐 수 있다 */
  staff: Record<string, SalesStaffStat>;
  unassigned: SalesStaffStat & { total: number };
}

export function computeBoardStats(
  projects: SalesProject[],
  upcomingActs: { projectId: string }[],
  pendingReports: { projectId: string; activities: unknown[] }[],
  now = kstNowIso()
): SalesBoardStats {
  const thisYear = now.slice(0, 4);
  const thisMonth = now.slice(0, 7);
  const prev = new Date(Date.UTC(Number(thisYear), Number(now.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

  const active = projects.filter(isActiveProject);
  const byStage = (st: SalesStage) => active.filter((p) => p.stage === st).length;
  const wonIn = (list: SalesProject[], y: string) => list.filter((p) => p.stage === "won" && outcomeYear(p) === y).length;

  const categories = [...SALES_SERVICE_CATEGORIES.map((c) => c.code as string), SALES_CATEGORY_UNSET].map((id) => {
    const list = projects.filter((p) => projectCategoryId(p) === id);
    const sub = new Map<string, number>();
    for (const p of list) if (p.serviceSubcategory) sub.set(p.serviceSubcategory, (sub.get(p.serviceSubcategory) ?? 0) + 1);
    const subs = Array.from(sub.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ code, n }));
    return { id, n: list.length, subs };
  });

  const y = Number(thisYear);
  const outcomes = [y, y - 1, y - 2].map(String).map((yy) => {
    const done = projects.filter((p) => (p.stage === "won" || p.stage === "lost") && outcomeYear(p) === yy);
    const w = done.filter((p) => p.stage === "won");
    const sum = (arr: SalesProject[]) => arr.reduce((s, p) => s + (p.finalBidAmount ?? 0), 0);
    return {
      year: yy,
      won: w.length,
      lost: done.length - w.length,
      wonAmt: sum(w),
      bidAmt: sum(done),
      priced: done.filter((p) => p.finalBidAmount != null).length,
      total: done.length,
    };
  });

  const upcomingBy = new Map<string, number>();
  for (const a of upcomingActs) upcomingBy.set(a.projectId, (upcomingBy.get(a.projectId) ?? 0) + 1);
  const pendingBy = new Map<string, number>();
  for (const r of pendingReports) pendingBy.set(r.projectId, (pendingBy.get(r.projectId) ?? 0) + (Array.isArray(r.activities) ? r.activities.length : 0));
  const statOf = (list: SalesProject[]): SalesStaffStat => ({
    active: list.filter(isActiveProject).length,
    upcoming: list.reduce((s, p) => s + (upcomingBy.get(p.projectId) ?? 0), 0),
    pending: list.reduce((s, p) => s + (pendingBy.get(p.projectId) ?? 0), 0),
    wonYear: wonIn(list, thisYear),
  });
  const owners = new Set<string>();
  for (const p of projects) {
    if (p.ownerEmployeeId) owners.add(p.ownerEmployeeId);
    if (p.leadMemberId) owners.add(p.leadMemberId);
  }
  const staff: Record<string, SalesStaffStat> = {};
  for (const e of owners) staff[e] = statOf(projects.filter((p) => isOwnedBy(p, e)));
  const unassigned = projects.filter((p) => !p.ownerEmployeeId && !p.leadMemberId);

  return {
    thisYear,
    thisMonth,
    visibleTotal: projects.length,
    years: Array.from(new Set(projects.map((p) => (p.openedAt ?? "").slice(0, 4)).filter(Boolean)))
      .sort()
      .reverse(),
    kpi: {
      active: active.length,
      activeByStage: {
        lead: byStage("lead"),
        contact: byStage("contact"),
        proposal: byStage("proposal"),
        bidding: byStage("bidding"),
        hold: byStage("hold"),
      },
      newThisMonth: projects.filter((p) => openedMonth(p) === thisMonth).length,
      newPrevMonth: projects.filter((p) => openedMonth(p) === prev).length,
      won: wonIn(projects, thisYear),
      lost: projects.filter((p) => p.stage === "lost" && outcomeYear(p) === thisYear).length,
    },
    funnel: FUNNEL_STEPS.map((s) => projects.filter((p) => reachedAtLeast(p, s.stage)).length),
    categories,
    outcomes,
    staff,
    unassigned: { ...statOf(unassigned), total: unassigned.length },
  };
}
