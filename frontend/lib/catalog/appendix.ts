/*
 * 회사소개서 부록 실적 — 대외 표기 규칙 + 표시 범위 규칙(블루프린트 §6-4). 클라이언트 안전(순수 함수).
 * 서버(lib/catalog/projects.ts)가 계약 행을 읽어 오고, 이 모듈이 표기명을 만들고 표시 범위를 적용한다.
 * 실적 노출 관리 화면은 같은 함수로 설정 변경 즉시 행 수를 미리 본다(서버 미리보기 API 와 결과가 같다).
 */
import { DASHBOARD_SERVICE_CATEGORIES } from "@/lib/ieps/contract-categories";
import { CATALOG_CATEGORIES, SOFTWARE_CATEGORY } from "./areas";
import { INTEGRATED_PERMIT_INDUSTRIES, canonicalServiceSubtype, matchesIndustryText } from "@/lib/ieps/integrated-permit";
import { REGION_GROUPS, REGION_UNKNOWN } from "./regions";

export type DisplayOverride = "auto" | "always" | "never";

export interface ContractCatalogMeta {
  displayTitle: string;
  displayIndustry: string;
  isPublic: boolean;
  isFeatured: boolean;
  displayOverride: DisplayOverride;
  groupKey: string;
  note: string;
  /** 한 용역이 맡은 허가 사업장 수(직접 지정). null = 결정번호 수(없으면 1) */
  siteCount: number | null;
  reviewedAt: string | null;
}

/** 계약 없는 실적 행의 id 접두어 — contractId 자리에 "manual:{manual_id}" 로 들어간다. */
export const MANUAL_ID_PREFIX = "manual:";

/**
 * 계약 없는 실적(310 catalog_manual_projects) — 정식 계약 없이 수행한 실적. 회사소개서 지표·부록에만 들어간다.
 * 예: 석문에너지 통합환경허가(한국종합기술 위임, 대금만 수령 — 사용자 확인 10-22).
 */
export interface ManualProject {
  manualId: string;
  category: string;
  subtype: string;
  title: string;
  displayTitle: string;
  counterpartyName: string;
  siteName: string;
  regionSido: string;
  industry: string;
  startedAt: string;
  endedAt: string;
  status: "completed" | "ongoing";
  permitIssuedAt: string;
  permitNo: string;
  siteCount: number | null;
  amount: number | null;
  displayOverride: DisplayOverride;
  isPublic: boolean;
  isFeatured: boolean;
  groupKey: string;
  note: string;
}

/** 부록 원천 행 — 계약 1건(또는 계약 없는 실적 1건). 금액은 변경 반영 금액(current_amount), 없으면 원 계약금액. */
export interface CatalogProjectRow {
  /** 계약 id. 계약 없는 실적은 "manual:{manual_id}" */
  contractId: string;
  /** contract = 계약 관리의 계약, manual = 계약 없는 실적 */
  source: "contract" | "manual";
  contractTitle: string;
  /** 소개서 분야 — 계약 관리 5분류(categoryCaseSql), 응용소프트웨어 공급 계약은 '응용소프트웨어'(lib/catalog/areas.ts) */
  category: string;
  subtype: string;
  /** 계약일 → 착수일 → 생성일(수주 연도) */
  contractDate: string;
  year: string;
  startedAt: string;
  endedAt: string;
  amount: number | null;
  isUnitPrice: boolean;
  counterpartyName: string;
  siteName: string;
  regionSido: string;
  regionGroup: string;
  industryCategory: string;
  industryName: string;
  industryCode: string;
  permitIssuedAt: string;
  permitNo: string;
  /** 완료일 = 허가일 또는 최종 대금 단계 계산서 발행일(completions-status 규칙) */
  completedAt: string;
  meta: ContractCatalogMeta | null;
}

// ─────────────────────────────── 대외 표기 ───────────────────────────────

const PERMIT_CATEGORY = DASHBOARD_SERVICE_CATEGORIES[0]; // 통합환경허가
/**
 * 최초허가로 세는 세분류 — '통합허가'는 최초허가의 구 표기(canonicalServiceSubtype), '시범사업'은 2017 환경부 시범사업
 * (엔에스티·진주산업 2개소 최초 작성). 영업부 최초허가 완료현황(2026.05.15. 기준, 99개소)이 시범사업 2개소를 포함한다.
 */
export const INITIAL_PERMIT_SUBTYPES = ["최초허가", "통합허가", "시범사업"];
export const CHANGE_PERMIT_SUBTYPES = ["변경허가", "변경신고"];

const normName = (v: string) => v.replace(/\(주\)|㈜|주식회사|\s+/g, "").toLowerCase();

/** 발주처·사업장 이름 조합 — 사업장명이 발주처명을 담으면 사업장명만, 반대면 발주처명만. */
export function projectPartyName(counterpartyName: string, siteName: string): string {
  const cp = counterpartyName.trim();
  const site = siteName.trim();
  if (!site) return cp;
  if (!cp) return site;
  if (normName(site).includes(normName(cp))) return site;
  if (normName(cp).includes(normName(site))) return cp;
  return `${cp} ${site}`;
}

/** 결정번호 표기 정리 — '제 0009-01호'·'0009-01' → '0009-01'(여러 개면 쉼표). */
export function formatPermitNo(permitNo: string): string {
  const nos = permitNo.match(/\d{3,4}-\d{2}/g);
  if (nos && nos.length) return nos.join(", ");
  return permitNo.replace(/^\s*제\s*/, "").replace(/\s*호\s*$/, "").trim();
}

/** 허가 결정번호 수(한 계약이 여러 사업장을 다룰 때 사업장 수). 번호가 없으면 1. */
export function permitSiteCount(permitNo: string): number {
  const nos = permitNo.match(/\d{3,4}-\d{2}/g);
  return nos && nos.length ? new Set(nos).size : 1;
}

/**
 * 계약이 세는 허가 사업장 수 — 직접 지정(실적 노출 관리의 사업장 수)이 우선, 없으면 결정번호 수(없으면 1).
 * 묶음 용역 예: 2017 시범사업(엔아이티·진주산업, 결정번호 없음) 2 · 지역난방 중앙지사 3 · 세진메탈 1·3공장 2 · 동남 울산·서산 2.
 */
export function projectSiteCount(row: Pick<CatalogProjectRow, "permitNo" | "meta">): number {
  return row.meta?.siteCount ?? permitSiteCount(row.permitNo);
}

export function isCompleted(row: Pick<CatalogProjectRow, "completedAt">): boolean {
  return Boolean(row.completedAt);
}

export function isInitialPermit(row: Pick<CatalogProjectRow, "category" | "subtype">): boolean {
  return row.category === PERMIT_CATEGORY && INITIAL_PERMIT_SUBTYPES.includes(row.subtype.trim());
}

/** 업종 대외 표기 — 통합허가 20개 업종 라벨(계약 업종분류·사업장 업종명/코드 매칭), 없으면 계약 업종분류·사업장 업종명. */
export function buildDisplayIndustry(row: Pick<CatalogProjectRow, "industryCategory" | "industryName" | "industryCode">): string {
  const hit = INTEGRATED_PERMIT_INDUSTRIES.find((i) =>
    matchesIndustryText([row.industryCategory, row.industryName, row.industryCode], i.label)
  );
  return hit?.label ?? (row.industryCategory.trim() || row.industryName.trim());
}

/**
 * 대외 표기명 자동 생성(메타가 없어도 부록이 만들어진다).
 *  - 통합환경허가: 현행 소개서 문안 — "{발주처} {사업장} 통합환경허가 취득 용역 준공(2021-08-13, 결정번호 : 제 0388-01호)", 진행 중이면 "… 수행 중".
 *  - 그 외: 계약명(발주처명이 없으면 앞에 붙인다).
 *  - 비공개 고객(is_public=0): 이름 자리를 "○○사"로 바꾼다(D9).
 * 입찰 패키지 용역개요(lib/bid/package-data.ts buildOverview)의 규칙 기반 조립을 소개서 문안으로 넓힌 것.
 */
export function buildDisplayTitle(row: CatalogProjectRow, opts?: { anonymize?: boolean }): string {
  const anonymize = opts?.anonymize ?? (row.meta ? !row.meta.isPublic : false);
  // 계약 없는 실적은 발주·위임처(예: 한국종합기술)가 고객이 아니므로 사업장명이 있으면 사업장명만 쓴다
  const party = anonymize
    ? "○○사"
    : row.source === "manual" && row.siteName.trim()
      ? row.siteName.trim()
      : projectPartyName(row.counterpartyName, row.siteName);
  if (row.category === PERMIT_CATEGORY) {
    const subtype = canonicalServiceSubtype(row.subtype.trim() || null);
    const work =
      subtype === "최초허가"
        ? "통합환경허가 취득 용역"
        : subtype
          ? `통합환경 ${subtype} 용역`
          : "통합환경허가 용역";
    const head = [party, work].filter(Boolean).join(" ");
    if (!isCompleted(row)) return `${head} 수행 중`;
    const date = row.permitIssuedAt.slice(0, 10);
    const no = formatPermitNo(row.permitNo);
    if (date && no && !anonymize) return `${head} 준공(${date}, 결정번호 : 제 ${no}호)`;
    if (date) return `${head} 준공(${date})`;
    return `${head} 준공`;
  }
  const title = row.contractTitle.trim();
  if (anonymize) {
    const cp = row.counterpartyName.trim();
    const stripped = cp ? title.replace(cp, "").trim() : title;
    return `○○사 ${stripped}`.trim();
  }
  const cp = row.counterpartyName.trim();
  if (cp && !normName(title).includes(normName(cp))) return `${cp} ${title}`;
  return title;
}

export function effectiveTitle(row: CatalogProjectRow): string {
  return row.meta?.displayTitle.trim() || buildDisplayTitle(row);
}

export function effectiveIndustry(row: CatalogProjectRow): string {
  return row.meta?.displayIndustry.trim() || buildDisplayIndustry(row);
}

/** 수행기간 'YYYY.MM. ~ YYYY.MM.' (현행 소개서 표기) */
export function periodLabel(row: Pick<CatalogProjectRow, "startedAt" | "endedAt" | "contractDate" | "completedAt">): string {
  const ym = (v: string) => {
    const m = v.match(/(\d{4})\D?(\d{1,2})/);
    return m ? `${m[1]}.${m[2].padStart(2, "0")}.` : "";
  };
  const from = ym(row.startedAt) || ym(row.contractDate);
  const to = ym(row.endedAt) || ym(row.completedAt);
  if (!from) return "";
  return `${from} ~ ${to}`.trim();
}

/** 계약 없는 실적의 수행기간 표기 */
export function manualPeriodText(m: Pick<ManualProject, "startedAt" | "endedAt" | "permitIssuedAt">): string {
  return periodLabel({ startedAt: m.startedAt, endedAt: m.endedAt, contractDate: m.startedAt, completedAt: m.permitIssuedAt });
}

// ─────────────────────────────── 표시 범위 규칙 ───────────────────────────────

export interface AppendixRules {
  /** 분류별 금액 하한(원) — 이 금액 '이하'는 목록에서 뺀다. 0 = 전부 표시. 기준 금액 = 변경 반영 금액 */
  minAmountByCategory: Record<string, number>;
  /** 기간 — 'all' 전체 / 'from' 시작 연도부터 / 'recent' 최근 N년 */
  periodMode: "all" | "from" | "recent";
  fromYear: number;
  recentYears: number;
  /** 수행 중 계약 포함("수행 중" 표기) */
  includeOngoing: boolean;
  /** 금액 미정(단가 계약 등) 계약 표시 */
  includeNoAmount: boolean;
  /** 분류·연도 끝에 "그 외 ○건(500만 원 이하)" 한 줄 */
  showHiddenSummary: boolean;
  /** 총괄표(A01)·본편 KPI 집계 — all: 표시 범위와 무관하게 전체 실적 / shown: 표시된 실적만 */
  summaryBasis: "all" | "shown";
  /** 묶음 행 금액 기준 — item: 개별 계약 기준으로 거른 뒤 묶음 / group: 묶은 뒤 합계로 거름 */
  groupAmountBasis: "item" | "group";
}

export const DEFAULT_MIN_AMOUNT = 5_000_000;

/** 기본값(D14 권장값) — 통합환경허가·응용소프트웨어 전부 표시, 그 외 500만 원 이하 미표시, 총괄표는 전체 실적. */
export const DEFAULT_APPENDIX_RULES: AppendixRules = {
  minAmountByCategory: Object.fromEntries(
    CATALOG_CATEGORIES.map((c) => [c, c === PERMIT_CATEGORY || c === SOFTWARE_CATEGORY ? 0 : DEFAULT_MIN_AMOUNT])
  ),
  periodMode: "all",
  fromYear: 2016,
  recentYears: 5,
  includeOngoing: true,
  includeNoAmount: true,
  showHiddenSummary: true,
  summaryBasis: "all",
  groupAmountBasis: "item",
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** 저장값·요청값 정리 — 모르는 키는 버리고 빠진 키는 기본값. */
export function sanitizeAppendixRules(input: unknown): AppendixRules {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_APPENDIX_RULES;
  const minIn = (o.minAmountByCategory && typeof o.minAmountByCategory === "object" ? o.minAmountByCategory : {}) as Record<string, unknown>;
  const minAmountByCategory: Record<string, number> = {};
  for (const c of CATALOG_CATEGORIES) {
    minAmountByCategory[c] = minIn[c] === undefined ? d.minAmountByCategory[c] : clampInt(minIn[c], 0, 100_000_000_000, d.minAmountByCategory[c]);
  }
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  return {
    minAmountByCategory,
    periodMode: o.periodMode === "from" || o.periodMode === "recent" ? o.periodMode : "all",
    fromYear: clampInt(o.fromYear, 2000, 2100, d.fromYear),
    recentYears: clampInt(o.recentYears, 1, 30, d.recentYears),
    includeOngoing: bool(o.includeOngoing, d.includeOngoing),
    includeNoAmount: bool(o.includeNoAmount, d.includeNoAmount),
    showHiddenSummary: bool(o.showHiddenSummary, d.showHiddenSummary),
    summaryBasis: o.summaryBasis === "shown" ? "shown" : "all",
    groupAmountBasis: o.groupAmountBasis === "group" ? "group" : "item",
  };
}

export type HiddenReason = "never" | "period" | "ongoing" | "no-amount" | "amount";

export const HIDDEN_REASON_LABEL: Record<HiddenReason, string> = {
  never: "항상 숨김",
  period: "기간 밖",
  ongoing: "수행 중",
  "no-amount": "금액 미정",
  amount: "금액 기준 이하",
};

const hasAmount = (row: CatalogProjectRow) => row.amount != null && row.amount > 0;

/** 계약 1건의 표시 판정(묶음 전). 금액 판정은 groupAmountBasis=group 이면 묶은 뒤로 미룬다. */
export function hiddenReason(row: CatalogProjectRow, rules: AppendixRules, nowYear: number, skipAmount = false): HiddenReason | null {
  const override = row.meta?.displayOverride ?? "auto";
  if (override === "never") return "never";
  if (override === "always") return null;
  const year = Number(row.year);
  if (rules.periodMode === "from" && (!year || year < rules.fromYear)) return "period";
  if (rules.periodMode === "recent" && (!year || year < nowYear - rules.recentYears + 1)) return "period";
  if (!rules.includeOngoing && !isCompleted(row)) return "ongoing";
  if (!hasAmount(row)) return rules.includeNoAmount ? null : "no-amount";
  if (skipAmount || row.meta?.isFeatured) return null; // 대표 실적은 금액이 작아도 표시
  const min = rules.minAmountByCategory[row.category] ?? 0;
  if (min > 0 && (row.amount ?? 0) <= min) return "amount";
  return null;
}

export interface AppendixListRow {
  key: string;
  contractIds: string[];
  year: string;
  category: string;
  title: string;
  /** 묶음 행의 고객사 목록(최대 8 + "외 N개사") */
  detail: string;
  industry: string;
  region: string;
  period: string;
  status: "completed" | "ongoing";
  permitNo: string;
  amount: number | null;
  featured: boolean;
  grouped: boolean;
}

export interface AppendixYearBlock {
  year: string;
  rows: AppendixListRow[];
  hiddenCount: number;
  /** "그 외 3건(500만 원 이하)" — showHiddenSummary 일 때만 */
  hiddenSummary: string;
}

export interface AppendixSection {
  category: string;
  years: AppendixYearBlock[];
  shownRows: number;
  shownContracts: number;
  hiddenContracts: number;
}

export interface SummaryCell {
  count: number;
  /** 통합환경허가 최초허가 완료 사업장 수(지표 permit.initial.completed 와 같은 규칙) — 통합환경허가 행만 */
  initialCompleted: number;
}

export interface AppendixResult {
  sections: AppendixSection[];
  shownRows: number;
  shownContracts: number;
  hiddenContracts: number;
  hiddenByReason: Record<HiddenReason, number>;
  /** A4 가로 부록 표 기준 예상 쪽 수(행 26줄/쪽, 분류 머리 2줄·연도 머리 1줄 가정) */
  estimatedPages: number;
  /** 총괄표(A01) — 분류 × 연도 / 분류 × 권역 */
  summary: {
    basis: "all" | "shown";
    byYear: Record<string, Record<string, SummaryCell>>;
    byRegion: Record<string, Record<string, SummaryCell>>;
    total: Record<string, SummaryCell>;
  };
}

const ROWS_PER_PAGE = 26;

function fmtWon(n: number): string {
  if (n >= 100_000_000 && n % 100_000_000 === 0) return `${n / 100_000_000}억 원`;
  if (n >= 10_000 && n % 10_000 === 0) return `${(n / 10_000).toLocaleString("ko-KR")}만 원`;
  return `${n.toLocaleString("ko-KR")}원`;
}

function hiddenSummaryText(reasons: HiddenReason[], rules: AppendixRules, category: string): string {
  if (reasons.length === 0) return "";
  const amountOnly = reasons.every((r) => r === "amount");
  const min = rules.minAmountByCategory[category] ?? 0;
  return amountOnly && min > 0 ? `그 외 ${reasons.length}건(${fmtWon(min)} 이하)` : `그 외 ${reasons.length}건`;
}

/**
 * 표시 범위 적용 — 분류 → 연도(내림차순 아님: 현행 소개서처럼 오름차순) → 행. 묶음(group_key)은 같은 분류·연도 안에서 합친다.
 * 총괄표는 summaryBasis 에 따라 전체 또는 표시된 계약으로 센다.
 */
export function applyAppendixRules(rows: CatalogProjectRow[], rules: AppendixRules, nowYear = new Date().getFullYear()): AppendixResult {
  const hiddenByReason: Record<HiddenReason, number> = { never: 0, period: 0, ongoing: 0, "no-amount": 0, amount: 0 };
  const groupBasis = rules.groupAmountBasis === "group";
  const shownSet = new Set<string>();
  const sections: AppendixSection[] = [];

  for (const category of CATALOG_CATEGORIES) {
    const catRows = rows.filter((r) => r.category === category);
    const byYear = new Map<string, CatalogProjectRow[]>();
    for (const r of catRows) {
      const y = r.year || "미상";
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(r);
    }
    const years: AppendixYearBlock[] = [];
    let shownRows = 0;
    let shownContracts = 0;
    let hiddenContracts = 0;
    for (const year of [...byYear.keys()].sort()) {
      const list = byYear.get(year)!.slice().sort((a, b) => (a.startedAt || a.contractDate).localeCompare(b.startedAt || b.contractDate));
      const hidden: HiddenReason[] = [];
      const kept: CatalogProjectRow[] = [];
      for (const r of list) {
        // 묶음 행 + 합계 기준이면 금액 판정은 묶은 뒤에 한다
        const reason = hiddenReason(r, rules, nowYear, groupBasis && Boolean(r.meta?.groupKey));
        if (reason) hidden.push(reason);
        else kept.push(r);
      }
      // 묶기
      const groups = new Map<string, CatalogProjectRow[]>();
      const out: AppendixListRow[] = [];
      for (const r of kept) {
        const gk = r.meta?.groupKey.trim();
        if (gk) {
          if (!groups.has(gk)) groups.set(gk, []);
          groups.get(gk)!.push(r);
        } else {
          out.push(toListRow([r]));
        }
      }
      for (const [gk, members] of groups) {
        if (groupBasis && !members.some((m) => m.meta?.displayOverride === "always" || m.meta?.isFeatured)) {
          const sum = members.reduce((acc, m) => acc + (m.amount ?? 0), 0);
          const min = rules.minAmountByCategory[category] ?? 0;
          if (min > 0 && sum > 0 && sum <= min) {
            for (let i = 0; i < members.length; i += 1) hidden.push("amount");
            continue;
          }
        }
        out.push(toListRow(members, gk));
      }
      out.sort((a, b) => a.period.localeCompare(b.period));
      for (const row of out) row.contractIds.forEach((id) => shownSet.add(id));
      for (const reason of hidden) hiddenByReason[reason] += 1;
      shownRows += out.length;
      shownContracts += out.reduce((acc, r) => acc + r.contractIds.length, 0);
      hiddenContracts += hidden.length;
      years.push({
        year,
        rows: out,
        hiddenCount: hidden.length,
        hiddenSummary: rules.showHiddenSummary ? hiddenSummaryText(hidden.filter((h) => h !== "never"), rules, category) : "",
      });
    }
    sections.push({ category, years, shownRows, shownContracts, hiddenContracts });
  }

  // 예상 쪽 수 — 표시 행 + 분류 머리(2) + 연도 머리(1) + 숨긴 실적 요약 줄
  let lines = 0;
  for (const s of sections) {
    if (s.shownRows === 0) continue;
    lines += 2;
    for (const y of s.years) {
      if (y.rows.length === 0 && !y.hiddenSummary) continue;
      lines += 1 + y.rows.length + (y.hiddenSummary ? 1 : 0);
    }
  }
  const estimatedPages = lines === 0 ? 0 : Math.ceil(lines / ROWS_PER_PAGE);

  // 총괄표
  const basisRows = rules.summaryBasis === "all" ? rows : rows.filter((r) => shownSet.has(r.contractId));
  const byYear: Record<string, Record<string, SummaryCell>> = {};
  const byRegion: Record<string, Record<string, SummaryCell>> = {};
  const total: Record<string, SummaryCell> = {};
  const bump = (map: Record<string, Record<string, SummaryCell>>, cat: string, key: string, r: CatalogProjectRow) => {
    map[cat] ??= {};
    map[cat][key] ??= { count: 0, initialCompleted: 0 };
    map[cat][key].count += 1;
    if (isInitialPermit(r) && isCompleted(r)) map[cat][key].initialCompleted += projectSiteCount(r);
  };
  for (const r of basisRows) {
    bump(byYear, r.category, r.year || "미상", r);
    bump(byRegion, r.category, r.regionGroup || REGION_UNKNOWN.id, r);
    total[r.category] ??= { count: 0, initialCompleted: 0 };
    total[r.category].count += 1;
    if (isInitialPermit(r) && isCompleted(r)) total[r.category].initialCompleted += projectSiteCount(r);
  }

  return {
    sections,
    shownRows: sections.reduce((acc, s) => acc + s.shownRows, 0),
    shownContracts: shownSet.size,
    hiddenContracts: rows.length - shownSet.size,
    hiddenByReason,
    estimatedPages,
    summary: { basis: rules.summaryBasis, byYear, byRegion, total },
  };
}

function toListRow(members: CatalogProjectRow[], groupKey?: string): AppendixListRow {
  const first = members[0];
  const grouped = Boolean(groupKey) && members.length > 0;
  const names = [...new Set(members.map((m) => (m.meta && !m.meta.isPublic ? "○○사" : m.counterpartyName.trim() || m.siteName.trim())).filter(Boolean))];
  const detail = grouped ? (names.length > 8 ? `${names.slice(0, 8).join(", ")} 외 ${names.length - 8}개사` : names.join(", ")) : "";
  const periods = members.map((m) => periodLabel(m)).filter(Boolean).sort();
  const amounts = members.map((m) => m.amount).filter((a): a is number => a != null && a > 0);
  return {
    key: grouped ? `group:${first.category}:${first.year}:${groupKey}` : first.contractId,
    contractIds: members.map((m) => m.contractId),
    year: first.year,
    category: first.category,
    title: grouped ? groupKey! : effectiveTitle(first),
    detail,
    industry: grouped ? "" : effectiveIndustry(first),
    region: regionLabelOf(first.regionGroup),
    period: grouped && periods.length > 1 ? `${periods[0].split(" ~ ")[0]} ~ ${periods[periods.length - 1].split(" ~ ")[1] ?? ""}`.trim() : periods[0] ?? "",
    status: members.every((m) => isCompleted(m)) ? "completed" : "ongoing",
    permitNo: grouped ? "" : formatPermitNo(first.permitNo),
    amount: amounts.length ? amounts.reduce((a, b) => a + b, 0) : null,
    featured: members.some((m) => m.meta?.isFeatured),
    grouped,
  };
}

function regionLabelOf(id: string): string {
  return REGION_GROUPS.find((g) => g.id === id)?.label ?? REGION_UNKNOWN.label;
}
