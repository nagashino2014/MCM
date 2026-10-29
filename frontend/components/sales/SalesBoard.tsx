"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock, Briefcase, CalendarClock, ClipboardList, Percent, Plus, Search, Siren, Sparkles, Trophy, Workflow, X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ProgressReportModal } from "./ProgressReportModal";
import { SalesSettingsCard } from "./SalesSettingsCard";
import { SalesInsightZone, funnelLabel } from "./SalesInsights";
import { PAGE_SIZE_OPTIONS, PaginationControls, usePageSize } from "@/components/ui/PaginationControls";
import "@/components/cdash/cdash.css";
import {
  SALES_CATEGORY_UNSET,
  boardFilterToParams,
  kstNowIso,
  type SalesBoardStats,
  type SalesKpiFilter,
} from "@/lib/sales/board";
import {
  ACTIVITY_TYPE_META,
  SALES_SERVICE_CATEGORIES,
  SALES_SUBCATEGORIES_BY_CATEGORY,
  SALES_STAGE_LABELS,
  type SalesActivityType,
  type SalesEmployeeOption,
  type SalesProject,
  type SalesServiceCategory,
  type SalesStage,
} from "@/lib/sales/types";
import { SALES_REGION_GROUPS, SALES_REGION_UNKNOWN } from "@/lib/sales/regions";

const STAGE_PILL: Record<SalesStage, string> = {
  lead: "cd-pill-idle",
  contact: "cd-pill-info",
  proposal: "cd-pill-secondary",
  bidding: "cd-pill-warn",
  won: "cd-pill-success",
  lost: "cd-pill-error",
  hold: "cd-pill-outline",
};

// 진행단계 태그 8종(영업 스케쥴 업무 단계) 표시명. 색은 활동유형 메타에서 파생.
// 배치 순서는 고정이 아니라 스케쥴 시작 날짜순이라 라벨 맵으로만 쓴다.
const STEP_TAG_LABELS: Record<SalesActivityType, string> = {
  telemarketing: "전화",
  email: "메일",
  visit: "방문",
  site_briefing: "현설",
  quote: "견적",
  proposal_meeting: "제안",
  bid: "투찰",
  result: "결과",
};

const PANEL_HEIGHT = 375; // 탭 패널·리스트 카드 높이
const TAB_PANEL_WIDTH = 616; // 탭 패널 너비
const TAG_PANEL_WIDTH = 236; // 리스트 왼쪽 태그 필터 패널 너비(지역권·업종분류 2열)
const SEARCH_WIDTH = 300; // 제목·사업장 검색란 너비(180→300, 2026-10-26)

type TabKey = "bids" | "reports" | "activities";

// 리스트 왼쪽 태그 필터(2026-10-26) — 지역권(공공입찰 7권+미상)·업종분류(용역 분류 4종+미분류).
// 같은 그룹 안은 OR, 그룹 사이는 AND. 영업건이 늘어도 목록을 좁혀 볼 수 있게 한다.
// 판정·건수·쪽 나눔은 서버(/api/sales/projects?limit=…, lib/sales/board.ts)가 한다(2026-10-29, 수천 건 대비).
const REGION_TAGS: { id: string; label: string }[] = [
  ...SALES_REGION_GROUPS.map((g) => ({ id: g.id, label: g.label })),
  { id: SALES_REGION_UNKNOWN.id, label: SALES_REGION_UNKNOWN.label },
];
const CATEGORY_TAGS: { id: string; label: string }[] = [
  ...SALES_SERVICE_CATEGORIES.map((c) => ({ id: c.code, label: c.label })),
  { id: SALES_CATEGORY_UNSET, label: "미분류" },
];

// 상단 KPI 띠(2026-10-26) — 서버 집계(/api/sales/board-stats, 목록과 같은 가시성 scope)와 탭 패널 응답에서 파생한다.
// 목록 필터(검색·담당·연도·태그)와 무관하게 '보이는 영업건 전체' 기준이다. 날짜 판정은 KST.
// 칸을 누르면 목록 필터로 걸린다(KpiFilter). 투찰 예정 칸은 필터 대신 왼쪽 [투찰 임박] 탭을 연다.
type KpiFilter = SalesKpiFilter;
const KPI_FILTER_LABELS: Record<KpiFilter, string> = {
  active: "진행 중",
  new: "이번 달 신규",
  won: "올해 수주",
  lost: "올해 실주",
  outcome: "올해 결과",
};
const SEARCH_DEBOUNCE_MS = 250; // 검색어는 입력이 멈춘 뒤 서버에 묻는다
const daysUntil = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
};

interface FacilityOption {
  facilityId: string;
  companyName: string;
}

// 상단 탭 패널용 — API 응답 shape(서버 queries.ts와 동일).
interface PendingReportItem {
  projectId: string;
  title: string;
  facilityName: string | null;
  activities: unknown[];
}
interface UpcomingBidItem {
  facilityId: string;
  facilityName: string | null;
  projectId: string;
  projectTitle: string;
  orderType: string | null;
  bidEnd: string;
  estimatedPrice: number | null;
}
interface UpcomingActivityItem {
  activityId: string;
  projectId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: SalesActivityType;
  scheduledAt: string;
  endedAt: string | null;
  summary: string | null;
}

export function SalesBoard() {
  const router = useRouter();
  const { data: session } = useSession();
  const canEdit = hasPerm(permsOf(session?.user), "sales.edit");
  // 영업 담당자 지정(영업 메뉴 개방) — 대표이사·관리자(298)
  const canManageStaff = hasPerm(permsOf(session?.user), "sales.staff.manage");
  const { theme } = useCdashTheme();

  // 목록 = 현재 쪽의 행만(서버 쪽 나눔). total = 필터 결과 전체, visibleTotal = 보이는 영업건 전체.
  const [list, setList] = useState<{
    rows: SalesProject[];
    total: number;
    visibleTotal: number;
    regionCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
  }>({ rows: [], total: 0, visibleTotal: 0, regionCounts: {}, categoryCounts: {} });
  const [listLoaded, setListLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  // KPI 띠·영업 현황 집계(목록 필터와 무관)
  const [stats, setStats] = useState<SalesBoardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  // 담당 필터 모집단 = "영업 제설정"에서 지정한 영업 담당자(298). 전 직원이 아니다.
  const [assignees, setAssignees] = useState<SalesEmployeeOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 상단 탭 패널(투찰임박·경과보고·다가오는일정) + 경과 보고 모달
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingReports, setPendingReports] = useState<PendingReportItem[]>([]);
  const [upcomingBids, setUpcomingBids] = useState<UpcomingBidItem[]>([]);
  const [upcomingActs, setUpcomingActs] = useState<UpcomingActivityItem[]>([]);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("bids");
  const [userPickedTab, setUserPickedTab] = useState(false);

  // 리스트 필터
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [year, setYear] = useState("");
  // 태그 필터(다중 선택) — 비어 있으면 그 그룹은 제한 없음
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  // KPI 칸 클릭 필터(하나만) — 같은 칸을 다시 누르면 해제
  const [kpiFilter, setKpiFilter] = useState<KpiFilter | null>(null);
  // 하단 퍼널(W4) 막대 필터 — 도달 단계가 이 단계 이상인 건
  const [reachedFilter, setReachedFilter] = useState<SalesStage | null>(null);

  // 검색어는 입력이 멈춘 뒤 반영(서버 요청을 글자마다 보내지 않는다)
  const [qApplied, setQApplied] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQApplied(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // 쪽 나눔(10-21 규칙의 표시 수 선택지). 필터가 바뀌면 첫 쪽 — offset 을 필터 키에 묶어 두어 바뀌는 순간 0이 된다.
  const [pageSize, setPageSize] = usePageSize("sales-board-page-size");
  const filterKey = useMemo(
    () =>
      boardFilterToParams({
        q: qApplied,
        owner,
        year,
        regionIds,
        categoryIds,
        kpi: kpiFilter,
        reached: reachedFilter,
      }).toString(),
    [qApplied, owner, year, regionIds, categoryIds, kpiFilter, reachedFilter]
  );
  const [page, setPage] = useState({ key: "", offset: 0 });
  const offset = page.key === filterKey ? page.offset : 0;
  const setOffset = (o: number) => setPage({ key: filterKey, offset: o });

  // KPI·영업 현황 집계 — 진입·경과 보고 뒤에 다시 받는다
  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/board-stats", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setStats(data.stats ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // 목록 — 필터·쪽이 바뀔 때마다 서버에 묻는다. 늦게 온 옛 응답은 버린다.
  const listSeq = useRef(0);
  useEffect(() => {
    const seq = ++listSeq.current;
    const sp = new URLSearchParams(filterKey);
    sp.set("limit", String(pageSize));
    sp.set("offset", String(offset));
    setListLoading(true);
    fetch(`/api/sales/projects?${sp.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (seq !== listSeq.current) return;
        setError(null);
        setList({
          rows: Array.isArray(data.projects) ? data.projects : [],
          total: Number(data.total ?? 0),
          visibleTotal: Number(data.visibleTotal ?? 0),
          regionCounts: data.regionCounts ?? {},
          categoryCounts: data.categoryCounts ?? {},
        });
        // 결과가 줄어 쪽이 비면 서버가 마지막 쪽으로 돌려준다
        if (Number(data.offset ?? 0) !== offset) setPage({ key: filterKey, offset: Number(data.offset ?? 0) });
        setListLoaded(true);
      })
      .catch((e) => {
        if (seq === listSeq.current) setError((e as Error).message);
      })
      .finally(() => {
        if (seq === listSeq.current) setListLoading(false);
      });
  }, [filterKey, pageSize, offset, reloadTick]);

  const reload = () => {
    loadStats();
    setReloadTick((n) => n + 1);
  };
  const loading = statsLoading;

  // 진입 시 탭 패널 데이터 로드(경과보고·투찰임박·다가오는일정)
  useEffect(() => {
    fetch("/api/sales/pending-reports", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => {
        const reports: PendingReportItem[] = Array.isArray(d.reports) ? d.reports : [];
        setPendingReports(reports);
        setPendingCount(reports.reduce((n, r) => n + (Array.isArray(r.activities) ? r.activities.length : 0), 0));
      })
      .catch(() => {});
    fetch("/api/sales/upcoming-bids", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { bids: [] }))
      .then((d) => setUpcomingBids(Array.isArray(d.bids) ? d.bids : []))
      .catch(() => {});
    fetch("/api/sales/upcoming-activities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { activities: [] }))
      .then((d) => setUpcomingActs(Array.isArray(d.activities) ? d.activities : []))
      .catch(() => {});
  }, []);

  const loadAssignees = useCallback(() => {
    fetch("/api/sales/assignees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((d) => setAssignees(Array.isArray(d.employees) ? d.employees : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAssignees();
  }, [loadAssignees]);

  // 초기 표시 탭 우선순위: 투찰 임박 > 경과 보고 > 다가오는 일정.
  // 사용자가 탭을 직접 누르면(userPickedTab) 자동 전환 중단.
  useEffect(() => {
    if (userPickedTab) return;
    if (upcomingBids.length > 0) setActiveTab("bids");
    else if (pendingCount > 0) setActiveTab("reports");
    else setActiveTab("activities");
  }, [userPickedTab, upcomingBids.length, pendingCount]);

  const pickTab = (k: TabKey) => {
    setUserPickedTab(true);
    setActiveTab(k);
  };

  const years = stats?.years ?? [];

  // KPI 값 — 목록 필터와 무관하게 보이는 영업건 전체 기준(서버 집계). 투찰 예정만 탭 패널 응답에서 센다.
  const kpi = useMemo(() => {
    const k = stats?.kpi;
    const by = k?.activeByStage ?? { lead: 0, contact: 0, proposal: 0, bidding: 0, hold: 0 };
    const won = k?.won ?? 0;
    const lost = k?.lost ?? 0;
    const nearest = upcomingBids.reduce<number | null>((m, b) => {
      const n = daysUntil(b.bidEnd);
      return m == null || n < m ? n : m;
    }, null);
    return {
      thisYear: stats?.thisYear ?? kstNowIso().slice(0, 4),
      active: k?.active ?? 0,
      // 보류는 있을 때만 덧붙여 내역 합이 진행 중 건수와 맞게 한다.
      activeBreakdown:
        `리드 ${by.lead} · 컨택 ${by.contact} · 제안 ${by.proposal} · 입찰 ${by.bidding}` + (by.hold > 0 ? ` · 보류 ${by.hold}` : ""),
      newThisMonth: k?.newThisMonth ?? 0,
      newPrevMonth: k?.newPrevMonth ?? 0,
      bids: upcomingBids.length,
      nearestBid: nearest,
      won,
      lost,
      winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    };
  }, [stats, upcomingBids]);

  const toggleKpi = (k: KpiFilter) => setKpiFilter((cur) => (cur === k ? null : k));

  const toggleIn = (set: (f: (prev: string[]) => string[]) => void, id: string) =>
    set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const hasFilter = !!(q || owner || year || regionIds.length || categoryIds.length || kpiFilter || reachedFilter);
  const clearFilters = () => {
    setQ("");
    setOwner("");
    setYear("");
    setRegionIds([]);
    setCategoryIds([]);
    setKpiFilter(null);
    setReachedFilter(null);
  };

  // 목록 쪽 나눔(10-21 규칙) — 서버가 한 쪽만 내려준다. 필터가 바뀌면 첫 쪽(offset 이 필터 키에 묶여 있음).
  const pager = (
    <PaginationControls
      total={list.total}
      limit={pageSize}
      offset={offset}
      loading={listLoading}
      onPageChange={setOffset}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      onPageSizeChange={(n) => {
        setPageSize(n);
        setOffset(0);
      }}
    />
  );

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Briefcase className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="영업/마케팅"
        titleSuffix={`${list.total}건${hasFilter ? ` / ${list.visibleTotal}` : ""}`}
        help="사업장별 영업건을 단계로 관리하고, 활동 이력·견적·입찰을 한 타임라인으로 추적합니다."
        actions={
          canEdit && (
            <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => setCreating(true)}>
              <Plus className="w-4 h-4" /> 영업건 추가
            </button>
          )
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      {/* 상단 KPI 띠 — 5칸. 칸을 누르면 아래 목록이 그 조건으로 걸린다(투찰 예정은 왼쪽 탭 열기) */}
      <KpiStrip
        kpi={kpi}
        loading={loading}
        active={kpiFilter}
        onToggle={toggleKpi}
        onOpenBids={() => pickTab("bids")}
      />

      <div className="flex gap-3 items-stretch flex-wrap">
        {/* 좌: 탭 패널 */}
        <SalesTabPanel
          activeTab={activeTab}
          onTab={pickTab}
          pendingCount={pendingCount}
          pendingReports={pendingReports}
          bids={upcomingBids}
          activities={upcomingActs}
          onOpenReport={() => setReportModalOpen(true)}
          onGoProject={(id) => router.push(`/sales/${id}`)}
        />

        {/* 우: 영업건 리스트(필터 + 목록, 합쳐 PANEL_HEIGHT) */}
        {/* 태그 패널(236px)이 더해져 좁은 화면(1366~1600)에서는 아래 줄로 내려 전폭을 쓴다(basis 480→720, 2026-10-26) */}
        <div className="flex flex-col min-w-0" style={{ flex: "1 1 720px", height: PANEL_HEIGHT }}>
          <div className="flex items-center gap-2 flex-wrap mb-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Search className="w-4 h-4 cd-text-faint" />
              <input
                className="cd-input"
                style={{ width: SEARCH_WIDTH }}
                placeholder="제목·사업장 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select className="cd-select" style={{ width: "auto" }} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">담당 전체</option>
              {assignees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>{e.name}{e.deptName ? ` (${e.deptName})` : ""}</option>
              ))}
            </select>
            {years.length > 0 && (
              <select className="cd-select" style={{ width: "auto" }} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">연도 전체</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            {kpiFilter && (
              <span className="cd-pill cd-pill-info inline-flex items-center gap-1">
                {KPI_FILTER_LABELS[kpiFilter]}
                <button type="button" onClick={() => setKpiFilter(null)} aria-label={`${KPI_FILTER_LABELS[kpiFilter]} 필터 해제`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {reachedFilter && (
              <span className="cd-pill cd-pill-info inline-flex items-center gap-1">
                {funnelLabel(reachedFilter)} 도달
                <button type="button" onClick={() => setReachedFilter(null)} aria-label={`${funnelLabel(reachedFilter)} 도달 필터 해제`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {hasFilter && (
              <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={clearFilters}>
                <X className="w-3.5 h-3.5" /> 초기화
              </button>
            )}
          </div>
          {/* 아래: 왼쪽 태그 필터 패널 + 오른쪽 목록(쪽 나눔) */}
          <div className="flex-1 min-h-0 flex gap-2">
            <TagFilterPanel
              regionIds={regionIds}
              categoryIds={categoryIds}
              regionCounts={list.regionCounts}
              categoryCounts={list.categoryCounts}
              onToggleRegion={(id) => toggleIn(setRegionIds, id)}
              onToggleCategory={(id) => toggleIn(setCategoryIds, id)}
              onClearRegion={() => setRegionIds([])}
              onClearCategory={() => setCategoryIds([])}
            />
            <div className="flex-1 min-w-0 min-h-0">
              {!listLoaded ? (
                <div className="cd-text-faint text-sm p-6">불러오는 중…</div>
              ) : (
                <ListView projects={list.rows} total={list.total} pager={pager} onRowClick={(id) => router.push(`/sales/${id}`)} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 하단 인포그래픽 존(W4~W7 + W8 요약) — 막대·행을 누르면 위 목록 필터로 걸린다(2026-10-26) */}
      <SalesInsightZone
        stats={stats}
        assignees={assignees}
        loading={loading}
        reachedFilter={reachedFilter}
        onReached={(st) => setReachedFilter((cur) => (cur === st ? null : st))}
        categoryIds={categoryIds}
        onToggleCategory={(id) => toggleIn(setCategoryIds, id)}
        owner={owner}
        onOwner={(id) => setOwner((cur) => (cur === id ? "" : id))}
      />

      {/* 하단: 영업 제설정(영업 담당자 지정·수집 소스) — 2026-10-19 */}
      <SalesSettingsCard theme={theme} canManageStaff={canManageStaff} canEditSources={canEdit} onStaffChanged={loadAssignees} />

      {creating && (
        <CreateProjectModal
          theme={theme}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/sales/${id}`);
          }}
        />
      )}

      {reportModalOpen && (
        <ProgressReportModal
          theme={theme}
          onClose={() => setReportModalOpen(false)}
          onReported={reload}
        />
      )}
    </div>
  );
}

function SalesTabPanel({
  activeTab,
  onTab,
  pendingCount,
  pendingReports,
  bids,
  activities,
  onOpenReport,
  onGoProject,
}: {
  activeTab: TabKey;
  onTab: (k: TabKey) => void;
  pendingCount: number;
  pendingReports: PendingReportItem[];
  bids: UpcomingBidItem[];
  activities: UpcomingActivityItem[];
  onOpenReport: () => void;
  onGoProject: (projectId: string) => void;
}) {
  const dday = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  };
  const mmdd = (iso: string) => {
    const [, m, d] = iso.slice(0, 10).split("-");
    return m && d ? `${Number(m)}/${Number(d)}` : iso.slice(0, 10);
  };
  const ddayLabel = (n: number) => (n <= 0 ? "D-DAY" : `D-${n}`);
  const ddayColor = (n: number) => (n <= 2 ? "var(--cd-error)" : n <= 6 ? "var(--cd-warning)" : "var(--cd-faint)");

  const tabs: {
    key: TabKey;
    label: string;
    Icon: typeof AlarmClock;
    color: string;
    count: number;
    pill: string;
  }[] = [
    { key: "bids", label: "투찰 임박", Icon: AlarmClock, color: "var(--cd-error)", count: bids.length, pill: "cd-pill-error" },
    { key: "reports", label: "경과 보고", Icon: ClipboardList, color: "var(--cd-warning)", count: pendingCount, pill: "cd-pill-warn" },
    { key: "activities", label: "다가오는 일정", Icon: CalendarClock, color: "var(--cd-primary)", count: activities.length, pill: "cd-pill-info" },
  ];

  const rowCls = "cd-row-hover text-left rounded-lg px-2 py-1.5 flex items-center gap-2 min-w-0 w-full text-sm";

  return (
    <div
      className="cd-card-bg rounded-2xl border cd-border-c flex flex-col min-w-0"
      style={{ flex: `0 0 ${TAB_PANEL_WIDTH}px`, height: PANEL_HEIGHT }}
    >
      {/* 탭 헤더 — 페이지 탭은 공통 밑줄형(UI 기준 §4). 균등 폭·탭별 아이콘 색·건수 배지는 유지 */}
      <div className="cd-tabs shrink-0 px-2" data-variant="underline" role="tablist" style={{ gap: 4 }}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(t.key)}
              className="cd-tab flex-1 justify-center gap-1 min-w-0"
            >
              <t.Icon className="w-4 h-4 shrink-0" style={{ color: t.color }} />
              <span className="text-xs font-bold truncate">{t.label}</span>
              <span className={`cd-pill ${t.count > 0 ? t.pill : "cd-pill-idle"}`}>{t.count}</span>
              {t.key === "bids" && bids.length > 0 && (
                <Siren className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cd-error)" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === "reports" && (
          pendingReports.length === 0 ? (
            <div className="cd-text-faint text-sm px-2 py-3">밀린 경과가 없습니다.</div>
          ) : (
            <div className="flex flex-col gap-1">
              <button className="cd-btn cd-btn-primary cd-btn-sm self-start mb-1" onClick={onOpenReport}>경과 보고</button>
              {pendingReports.map((r) => (
                <button key={r.projectId} onClick={() => onGoProject(r.projectId)} className={rowCls}>
                  <span className="cd-text font-bold truncate flex-1">{r.title}</span>
                  <span className="cd-text-faint text-[13px] shrink-0">{Array.isArray(r.activities) ? r.activities.length : 0}건</span>
                </button>
              ))}
            </div>
          )
        )}

        {activeTab === "bids" && (
          bids.length === 0 ? (
            <div className="cd-text-faint text-sm px-2 py-3">임박한 발주가 없습니다.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {bids.map((b) => {
                const n = dday(b.bidEnd);
                return (
                  <button key={`${b.projectId}-${b.facilityId}`} onClick={() => onGoProject(b.projectId)} className={rowCls}>
                    <span className="font-extrabold shrink-0 text-[13px]" style={{ width: 48, color: ddayColor(n) }}>{ddayLabel(n)}</span>
                    <span className="cd-text truncate flex-1">{b.facilityName ?? b.projectTitle}</span>
                    <span className="cd-text-faint text-[13px] shrink-0">{mmdd(b.bidEnd)}</span>
                  </button>
                );
              })}
            </div>
          )
        )}

        {activeTab === "activities" && (
          activities.length === 0 ? (
            <div className="cd-text-faint text-sm px-2 py-3">예정된 일정이 없습니다.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {activities.map((a) => {
                const meta = ACTIVITY_TYPE_META[a.activityType];
                return (
                  <button key={a.activityId} onClick={() => onGoProject(a.projectId)} className={rowCls}>
                    <span className="cd-text-faint text-[13px] font-bold shrink-0" style={{ width: 38 }}>{mmdd(a.scheduledAt)}</span>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta?.color ?? "var(--cd-secondary)" }} />
                    <span className="cd-text truncate flex-1">{a.projectTitle}</span>
                    {meta && <span className="cd-text-faint text-[13px] shrink-0">{meta.short}</span>}
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// 상단 KPI 띠 — 숫자는 텍스트 색(cd-text), 아이콘만 칸별 색. 상태색(수주·실주)은 라벨과 함께 쓴다.
// 칸은 무광 카드 + 1px 경계(UI Precision), 선택된 칸은 경계만 primary.
interface KpiValues {
  thisYear: string;
  active: number;
  activeBreakdown: string;
  newThisMonth: number;
  newPrevMonth: number;
  bids: number;
  nearestBid: number | null;
  won: number;
  lost: number;
  winRate: number | null;
}

function KpiStrip({
  kpi,
  loading,
  active,
  onToggle,
  onOpenBids,
}: {
  kpi: KpiValues;
  loading: boolean;
  active: KpiFilter | null;
  onToggle: (k: KpiFilter) => void;
  onOpenBids: () => void;
}) {
  const v = (n: number | string) => (loading ? "—" : n);
  const tileCls = "cd-card-bg rounded-2xl border cd-border-c min-w-0";
  const tileStyle = (on: boolean) => (on ? { borderColor: "var(--cd-primary)" } : undefined);
  const btnCls = "cd-row-hover w-full h-full text-left rounded-2xl px-3 py-2 flex items-center gap-3 min-w-0";
  const head = (Icon: typeof Workflow, color: string, label: string) => (
    <>
      <span
        className="w-6 h-6 rounded-md inline-flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 14%, var(--cd-card))`, color }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="cd-text-muted text-[11.5px] font-bold truncate">{label}</span>
    </>
  );
  const valueRow = (value: ReactNode, sub: string) => (
    <span className="flex items-baseline gap-2 min-w-0">
      <span className="cd-text text-xl font-extrabold leading-none">{value}</span>
      {/* 좁은 화면에서 말줄임되면 마우스를 올려 전체를 본다 */}
      <span className="cd-text-faint text-[11px] truncate" title={sub}>{sub}</span>
    </span>
  );
  const simple = (
    key: KpiFilter,
    Icon: typeof Workflow,
    color: string,
    label: string,
    value: ReactNode,
    sub: string,
    title: string
  ) => (
    <div className={tileCls} style={tileStyle(active === key)}>
      <button type="button" className={btnCls} aria-pressed={active === key} title={title} onClick={() => onToggle(key)}>
        <span className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">{head(Icon, color, label)}</span>
          {valueRow(value, sub)}
        </span>
      </button>
    </div>
  );
  const pillBtn = (key: KpiFilter, label: string, n: number, color: string) => (
    <button
      type="button"
      className="cd-row-hover rounded-lg px-1.5 py-0.5 inline-flex items-baseline gap-1.5"
      style={active === key ? { boxShadow: "inset 0 0 0 1px var(--cd-primary)" } : undefined}
      aria-pressed={active === key}
      title={`올해 ${label} 영업건만 목록에 보기`}
      onClick={() => onToggle(key)}
    >
      <span className="w-2 h-2 rounded-full self-center" style={{ background: color }} />
      <span className="cd-text-muted text-[11.5px] font-bold">{label}</span>
      <span className="cd-text text-xl font-extrabold leading-none">{v(n)}</span>
    </button>
  );

  return (
    <div className="grid gap-3 mb-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5" role="group" aria-label="영업 핵심 지표">
      {simple("active", Workflow, "var(--cd-primary)", "진행 중 영업건", v(kpi.active), kpi.activeBreakdown, "수주·실주가 아닌 영업건만 목록에 보기")}
      {simple(
        "new",
        Sparkles,
        "var(--cd-secondary)",
        "이번 달 신규",
        v(kpi.newThisMonth),
        `지난달 ${kpi.newPrevMonth}건`,
        "이번 달에 시작한 영업건만 목록에 보기"
      )}
      <div className={tileCls}>
        <button type="button" className={btnCls} title="왼쪽 투찰 임박 탭 열기" onClick={onOpenBids}>
          <span className="flex flex-col gap-1.5 min-w-0 flex-1">
            <span className="flex items-center gap-2 min-w-0">{head(AlarmClock, "var(--cd-error)", "투찰 예정 (14일)")}</span>
            {valueRow(
              v(kpi.bids),
              kpi.nearestBid == null ? "예정 없음" : `가장 가까운 ${kpi.nearestBid <= 0 ? "D-DAY" : `D-${kpi.nearestBid}`}`
            )}
          </span>
        </button>
      </div>
      <div className={`${tileCls} px-3 py-2 flex flex-col gap-1.5`} style={tileStyle(active === "won" || active === "lost")}>
        <span className="flex items-center gap-2 min-w-0">{head(Trophy, "var(--cd-success)", `${kpi.thisYear}년 수주 / 실주`)}</span>
        <span className="flex items-center gap-1 flex-wrap -ml-1.5">
          {pillBtn("won", "수주", kpi.won, "var(--cd-success)")}
          {pillBtn("lost", "실주", kpi.lost, "var(--cd-error)")}
        </span>
      </div>
      {simple(
        "outcome",
        Percent,
        "var(--cd-warning)",
        `${kpi.thisYear}년 수주율`,
        loading || kpi.winRate == null ? "—" : `${kpi.winRate}%`,
        kpi.won + kpi.lost > 0 ? `수주 ${kpi.won} ÷ 결과 ${kpi.won + kpi.lost}건` : "올해 결과 없음",
        "올해 수주·실주로 끝난 영업건만 목록에 보기"
      )}
    </div>
  );
}

// 리스트 왼쪽 태그 필터 패널 — 지역권·업종분류 두 그룹, 다중 선택(cd-chip data-active 토글, 공공입찰 알림 설정과 같은 패턴).
// 각 태그 오른쪽 숫자는 현재 다른 조건을 적용했을 때의 건수.
function TagFilterPanel({
  regionIds,
  categoryIds,
  regionCounts,
  categoryCounts,
  onToggleRegion,
  onToggleCategory,
  onClearRegion,
  onClearCategory,
}: {
  regionIds: string[];
  categoryIds: string[];
  regionCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  onToggleRegion: (id: string) => void;
  onToggleCategory: (id: string) => void;
  onClearRegion: () => void;
  onClearCategory: () => void;
}) {
  const group = (
    title: string,
    tags: { id: string; label: string }[],
    selected: string[],
    counts: Record<string, number>,
    onToggle: (id: string) => void,
    onClear: () => void
  ) => (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <div className="flex items-center justify-between px-1" style={{ height: 18 }}>
        <span className="cd-text-faint text-[11px] font-bold">
          {title}
          {selected.length > 0 && <span className="cd-text-primary"> {selected.length}</span>}
        </span>
        {selected.length > 0 && (
          <button type="button" className="cd-text-faint" onClick={onClear} aria-label={`${title} 선택 해제`}>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {tags.map((t) => {
        const active = selected.includes(t.id);
        const n = counts[t.id] ?? 0;
        return (
          <button
            key={t.id}
            type="button"
            className="cd-chip cd-chip-sm w-full justify-between"
            // 패널 높이(375) 안에 지역권 8개가 들어가도록 칩을 낮춘다(32→28px).
            style={{ minHeight: 28, padding: "3px 8px" }}
            data-active={active}
            aria-pressed={active}
            onClick={() => onToggle(t.id)}
          >
            <span className="truncate">{t.label}</span>
            <span className={`text-[11px] shrink-0 ${active ? "" : "cd-text-faint"}`}>{n}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <aside
      className="cd-card-bg rounded-2xl border cd-border-c p-2 flex gap-2 overflow-y-auto shrink-0"
      style={{ width: TAG_PANEL_WIDTH }}
      aria-label="영업건 태그 필터"
    >
      {group("지역권", REGION_TAGS, regionIds, regionCounts, onToggleRegion, onClearRegion)}
      {group("업종분류", CATEGORY_TAGS, categoryIds, categoryCounts, onToggleCategory, onClearCategory)}
    </aside>
  );
}

// 태그 순서는 서버가 내려준 순서(스케쥴 시작 날짜 오름차순)를 그대로 유지한다.
function StepTags({ types }: { types: SalesActivityType[] }) {
  if (types.length === 0) return <span className="cd-text-faint text-[11px]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {types.map((t) => {
        const meta = ACTIVITY_TYPE_META[t];
        if (!meta) return null;
        return (
          <span
            key={t}
            className="text-[12px] font-bold rounded-full px-2 py-0.5 leading-none"
            style={{ background: meta.color, color: "#1f2937" }}
          >
            {STEP_TAG_LABELS[t] ?? meta.short}
          </span>
        );
      })}
    </span>
  );
}

// projects = 현재 쪽의 행, total = 필터 결과 전체 건수. 예상 수주금액 열은 2026-10-26 사용자 요청으로 제거(값은 DB에 유지).
function ListView({
  projects,
  total,
  pager,
  onRowClick,
}: {
  projects: SalesProject[];
  total: number;
  pager: ReactNode;
  onRowClick: (projectId: string) => void;
}) {
  if (total === 0) {
    return <div className="cd-text-faint text-sm p-6 text-center cd-card-bg rounded-2xl border cd-border-c h-full flex items-center justify-center">표시할 영업건이 없습니다.</div>;
  }
  return (
    <div className="sales-list-scope cd-card-bg rounded-2xl border cd-border-c overflow-hidden h-full flex flex-col">
      {/* 본문은 좌측 탭 패널 목록(text-sm = 0.875rem)과 동일 크기로 맞춘다. 전역 cd-table은 공유 클래스라 스코프 오버라이드 */}
      <style>{`
        .sales-list-scope .cd-table thead th { font-size: 0.75rem; }
        .sales-list-scope .cd-table tbody td { font-size: 0.875rem; }
      `}</style>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="cd-table">
          <thead>
            <tr>
              <th>제목</th>
              <th>사업장</th>
              <th>분류 단계</th>
              <th>업무 단계</th>
              <th>담당</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const assignee = p.ownerEmployeeName ?? p.leadMemberName ?? null;
              return (
                <tr key={p.projectId} className="cursor-pointer" onClick={() => onRowClick(p.projectId)}>
                  <td className="cd-text font-bold">{p.title}</td>
                  <td className="cd-text-muted">{p.facilityName ?? "—"}</td>
                  <td><span className={`cd-pill ${STAGE_PILL[p.stage]}`}>{SALES_STAGE_LABELS[p.stage]}</span></td>
                  <td><StepTags types={p.activityTypes ?? []} /></td>
                  <td className="cd-text-muted">{assignee ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="shrink-0 border-t cd-border-c px-3 py-1.5">{pager}</div>
    </div>
  );
}

function CreateProjectModal({
  theme,
  onClose,
  onCreated,
}: {
  theme: string;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [serviceCategory, setServiceCategory] = useState<SalesServiceCategory | "">("");
  const [serviceSubcategory, setServiceSubcategory] = useState<string>("");
  const [memo, setMemo] = useState("");
  const [facility, setFacility] = useState<FacilityOption | null>(null);
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityResults, setFacilityResults] = useState<FacilityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (facility || !facilityQuery.trim()) {
      setFacilityResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/facilities?q=${encodeURIComponent(facilityQuery)}&limit=8`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const items = (data.items ?? data.facilities ?? []) as Array<Record<string, unknown>>;
        setFacilityResults(
          items.map((it) => ({
            facilityId: String(it.facilityId ?? it.facility_id ?? ""),
            companyName: String(it.companyName ?? it.company_name ?? ""),
          })).filter((it) => it.facilityId)
        );
      } catch {
        setFacilityResults([]);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [facilityQuery, facility]);

  const submit = async () => {
    if (!facility || !title.trim()) {
      setErr("사업장과 제목은 필수입니다.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/sales/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: facility.facilityId,
          title: title.trim(),
          // 단계는 영업 스케쥴 진행도에 따라 자동 분류 → 신규 생성 시 lead로 시작.
          stage: "lead",
          priority: "normal",
          serviceCategory: serviceCategory || null,
          serviceSubcategory: serviceSubcategory || null,
          // 예상 수주금액 입력은 2026-10-26 제거(컬럼·API는 유지, 보내지 않으면 null).
          memo: memo.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onCreated(String(data.projectId));
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 460, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">영업건 추가</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}

        <label className="cd-label">사업장 *</label>
        {facility ? (
          <div className="flex items-center justify-between rounded-lg border cd-border-c px-3 py-2 mb-3">
            <span className="cd-text text-sm font-bold">{facility.companyName}</span>
            <button className="cd-text-faint" onClick={() => setFacility(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative mb-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 cd-text-faint shrink-0" />
              <input
                className="cd-input"
                placeholder="사업장명 검색"
                value={facilityQuery}
                onChange={(e) => setFacilityQuery(e.target.value)}
              />
            </div>
            {facilityResults.length > 0 && (
              <div className="cd-card-bg rounded-lg border cd-border-c mt-1 max-h-48 overflow-y-auto">
                {facilityResults.map((f) => (
                  <button
                    key={f.facilityId}
                    className="cd-row-hover w-full text-left px-3 py-2 cd-text text-sm"
                    onClick={() => {
                      setFacility(f);
                      setFacilityQuery("");
                    }}
                  >
                    {f.companyName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="cd-label">제목 *</label>
        <input className="cd-input mb-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 통합허가 갱신 영업" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="cd-label">용역 분류</label>
            <select className="cd-select" value={serviceCategory} onChange={(e) => { setServiceCategory(e.target.value as SalesServiceCategory | ""); setServiceSubcategory(""); }}>
              <option value="">선택</option>
              {SALES_SERVICE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">세분류</label>
            <select className="cd-select" value={serviceSubcategory} onChange={(e) => setServiceSubcategory(e.target.value)} disabled={!serviceCategory}>
              <option value="">선택</option>
              {(serviceCategory ? SALES_SUBCATEGORIES_BY_CATEGORY[serviceCategory] : []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <label className="cd-label">메모</label>
        <textarea className="cd-textarea mb-4" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />

        <div className="flex justify-end gap-2">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={submit} disabled={saving}>
            {saving ? "저장 중…" : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
