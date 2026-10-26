"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock, Briefcase, CalendarClock, ClipboardList, Plus, Search, Siren, X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ProgressReportModal } from "./ProgressReportModal";
import { SalesSettingsCard } from "./SalesSettingsCard";
import { useClientPaging } from "@/components/ui/PaginationControls";
import "@/components/cdash/cdash.css";
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
import { SALES_REGION_GROUPS, SALES_REGION_UNKNOWN, salesRegionGroupId } from "@/lib/sales/regions";

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
const CATEGORY_UNSET = "unset";
const REGION_TAGS: { id: string; label: string }[] = [
  ...SALES_REGION_GROUPS.map((g) => ({ id: g.id, label: g.label })),
  { id: SALES_REGION_UNKNOWN.id, label: SALES_REGION_UNKNOWN.label },
];
const CATEGORY_TAGS: { id: string; label: string }[] = [
  ...SALES_SERVICE_CATEGORIES.map((c) => ({ id: c.code, label: c.label })),
  { id: CATEGORY_UNSET, label: "미분류" },
];
const projectCategoryId = (p: SalesProject) => p.serviceCategory ?? CATEGORY_UNSET;

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

  const [projects, setProjects] = useState<SalesProject[]>([]);
  // 담당 필터 모집단 = "영업 제설정"에서 지정한 영업 담당자(298). 전 직원이 아니다.
  const [assignees, setAssignees] = useState<SalesEmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sales/projects", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

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

  const years = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => (p.openedAt ?? "").slice(0, 4)).filter(Boolean)))
        .sort()
        .reverse(),
    [projects]
  );

  // 상단 필터(검색·담당·연도)만 적용한 모집단. 태그 건수는 여기서 "다른 그룹 선택"까지 적용해 센다.
  const baseFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (s && !(p.title.toLowerCase().includes(s) || (p.facilityName ?? "").toLowerCase().includes(s))) return false;
      if (owner && p.ownerEmployeeId !== owner && p.leadMemberId !== owner) return false;
      if (year && (p.openedAt ?? "").slice(0, 4) !== year) return false;
      return true;
    });
  }, [projects, q, owner, year]);

  const regionOf = (p: SalesProject) => salesRegionGroupId(p.regionSido);
  const matchRegion = (p: SalesProject) => regionIds.length === 0 || regionIds.includes(regionOf(p));
  const matchCategory = (p: SalesProject) => categoryIds.length === 0 || categoryIds.includes(projectCategoryId(p));

  const filtered = useMemo(
    () => baseFiltered.filter((p) => matchRegion(p) && matchCategory(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseFiltered, regionIds, categoryIds]
  );

  // 태그별 건수 — 같은 그룹의 선택은 빼고(OR 라 선택해도 늘어나는 수를 보이게), 다른 그룹 선택은 적용.
  const regionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of baseFiltered) if (matchCategory(p)) m.set(regionOf(p), (m.get(regionOf(p)) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFiltered, categoryIds]);
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of baseFiltered) if (matchRegion(p)) m.set(projectCategoryId(p), (m.get(projectCategoryId(p)) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFiltered, regionIds]);

  const toggleIn = (set: (f: (prev: string[]) => string[]) => void, id: string) =>
    set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const hasFilter = !!(q || owner || year || regionIds.length || categoryIds.length);
  const clearFilters = () => {
    setQ("");
    setOwner("");
    setYear("");
    setRegionIds([]);
    setCategoryIds([]);
  };

  // 목록 쪽 나눔(공용 useClientPaging, 10-21 규칙). 필터가 바뀌면 첫 쪽으로.
  const { pageRows, pager, resetPage } = useClientPaging(filtered, "sales-board-page-size", loading);
  useEffect(() => {
    resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, owner, year, regionIds, categoryIds]);

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Briefcase className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="영업/마케팅"
        titleSuffix={`${filtered.length}건${hasFilter ? ` / ${projects.length}` : ""}`}
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
              regionCounts={regionCounts}
              categoryCounts={categoryCounts}
              onToggleRegion={(id) => toggleIn(setRegionIds, id)}
              onToggleCategory={(id) => toggleIn(setCategoryIds, id)}
              onClearRegion={() => setRegionIds([])}
              onClearCategory={() => setCategoryIds([])}
            />
            <div className="flex-1 min-w-0 min-h-0">
              {loading ? (
                <div className="cd-text-faint text-sm p-6">불러오는 중…</div>
              ) : (
                <ListView projects={pageRows} total={filtered.length} pager={pager} onRowClick={(id) => router.push(`/sales/${id}`)} />
              )}
            </div>
          </div>
        </div>
      </div>

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
          onReported={() => { reload(); }}
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
  regionCounts: Map<string, number>;
  categoryCounts: Map<string, number>;
  onToggleRegion: (id: string) => void;
  onToggleCategory: (id: string) => void;
  onClearRegion: () => void;
  onClearCategory: () => void;
}) {
  const group = (
    title: string,
    tags: { id: string; label: string }[],
    selected: string[],
    counts: Map<string, number>,
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
        const n = counts.get(t.id) ?? 0;
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
