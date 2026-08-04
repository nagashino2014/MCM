"use client";

// 우측 "발주 정보 분석용 데이터 수집현황" 패널 — 기간(수집일 기준) 총계·추이·소스별 채택·세부 유형.
// 채택 = 영업건 전환(converted) 또는 등급 confirmed.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ApexOptions } from "apexcharts";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { INTEL_SIGNAL_TYPE_LABELS, INTEL_SIGNAL_GRADE_LABELS } from "@/lib/intel/signal-extractor";
import { MATCH_LABEL, SOURCE_LABEL, STAT_SOURCE_LABELS, STATUS_LABEL } from "./intel-shared";

/** 수집현황 조회 기간 — 전체/연도별/월별 */
export interface StatsPeriod {
  mode: "all" | "year" | "month";
  year: string; // 'YYYY'
  month: string; // 'YYYY-MM'
}

interface SourceStat { collected: number; adopted: number }
interface BreakdownRow {
  source: string; signalType: string; matchStatus: string; status: string; grade: string; count: number;
}
interface DailyRow {
  date: string;
  collected: number;
  confirmed: number;
  candidate: number;
  adopted: number;
  bySource: Record<string, number>;
}
export interface IntelStatsData {
  from: string;
  to: string;
  bySource: Record<string, SourceStat>;
  total: SourceStat;
  monthly: Array<{ month: string; collected: number; adopted: number }>;
  breakdown: BreakdownRow[];
  /** 최근 5일 일별 수집 로그(기간 선택과 무관 — 전체는 로그 모달) */
  daily: DailyRow[];
  /** 삭제 피드백 현황(성장형 수집 로직 모니터링) */
  feedback: {
    byReason: Record<string, number>;
    total: number;
    recentBySource: Array<{ source: string; deleted: number; collected: number; rate: number }>;
    duplicateSims: number[];
  };
  /** 소스별 마지막 수집 실행(수동 실행 패널 표시용) */
  collectState: Array<{ source: string; lastRunAt: string | null; lastCursor: string | null }>;
}

/** 소스별 삭제율 경보 임계 — 이 이상이면 수집 키워드·분류 기준 점검 필요 */
const FEEDBACK_RATE_WARN = 0.1;
/** 뉴스 중복 병합 임계(rag-indexer 와 동일 값 표기용) */
const DEDUP_THRESHOLD = 0.9;

const REASON_LABELS: Record<string, string> = {
  irrelevant_industry: "무관한 업종",
  mere_goal: "단순 경영목표",
  duplicate: "중복 기사",
  lacks_specifics: "구체성 부재",
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const STAT_SOURCES = ["dart", "eiass", "press", "news", "gosi_eum", "gosi_me"] as const;

// 세부 유형 카드의 분해 축
const AXES = [
  { key: "signalType", label: "신호유형", labels: INTEL_SIGNAL_TYPE_LABELS as Record<string, string> },
  { key: "matchStatus", label: "매칭", labels: MATCH_LABEL },
  { key: "status", label: "상태", labels: STATUS_LABEL },
  { key: "grade", label: "등급", labels: INTEL_SIGNAL_GRADE_LABELS as Record<string, string> },
] as const;
type AxisKey = (typeof AXES)[number]["key"];

function chartColors(theme: string) {
  return {
    primary: "#5d87ff",
    accent: "#ffae1f",
    secondary: "#49beff",
    success: "#13deb9",
    error: "#fa896b",
    muted: theme === "dark" ? "#8c9bb5" : "#5a6a85",
    faint: theme === "dark" ? "#5a6a85" : "#7c8fac",
    grid: theme === "dark" ? "#333f55" : "#e5eaef",
    track: theme === "dark" ? "#1d2530" : "#f2f6fa",
  };
}

/** 미니 도넛(SVG) — 소스별 채택률. ApexCharts 6개 인스턴스 대신 가볍게 그린다. */
function MiniDonut({ pct, color, track }: { pct: number | null; color: string; track: string }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const ratio = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: 68, height: 68 }}>
      <svg width={68} height={68} viewBox="0 0 68 68" className="-rotate-90">
        <circle cx={34} cy={34} r={R} fill="none" stroke={track} strokeWidth={8} />
        {pct != null && (
          <circle
            cx={34} cy={34} r={R} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
            strokeDasharray={`${C * ratio} ${C * (1 - ratio)}`}
          />
        )}
      </svg>
      <span className="absolute text-[12px] font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>
        {pct == null ? "—" : `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

type LogGranularity = "day" | "week" | "month" | "year";

const GRANULARITY_TABS: Array<{ key: LogGranularity; label: string }> = [
  { key: "day", label: "일별" },
  { key: "week", label: "주별" },
  { key: "month", label: "월별" },
  { key: "year", label: "연도별" },
];

/** 기간 라벨 — day 'MM-DD', week '주 시작일~', month 'YYYY-MM', year 'YYYY' */
function periodLabel(date: string, granularity: LogGranularity): string {
  if (granularity === "day") return date.slice(5);
  if (granularity === "week") return `${date.slice(5)} 주`;
  return date;
}

/** 일별/기간별 수집 로그 테이블 — 카드(최근 5일)와 전체 보기 모달이 공유. */
function DailyLogTable({ rows, granularity }: { rows: DailyRow[]; granularity: LogGranularity }) {
  const periodCol = granularity === "month" || granularity === "year" ? "72px" : "64px";
  return (
    <div className="flex flex-col">
      <div
        className={`grid gap-x-2 px-2 py-1.5 rounded-lg text-[10px] font-bold`}
        style={{ gridTemplateColumns: `${periodCol} 1fr 1fr 1fr 1fr`, background: "var(--cd-surface)", color: "var(--cd-muted)" }}
      >
        <span>수집일</span>
        <span className="text-right">수집</span>
        <span className="text-right">확정</span>
        <span className="text-right">후보</span>
        <span className="text-right">채택</span>
      </div>
      {rows.map((d) => (
        <div key={d.date} className="cd-row-hover px-2 py-1.5 rounded-lg">
          <div className="grid gap-x-2 text-[11px] tabular-nums" style={{ gridTemplateColumns: `${periodCol} 1fr 1fr 1fr 1fr` }}>
            <span className="font-bold" style={{ color: "var(--cd-text)" }}>{periodLabel(d.date, granularity)}</span>
            <span className="text-right font-extrabold" style={{ color: "var(--cd-text)" }}>{d.collected.toLocaleString()}</span>
            <span className="text-right font-bold" style={{ color: d.confirmed > 0 ? "#13deb9" : "var(--cd-faint)" }}>{d.confirmed}</span>
            <span className="text-right font-bold" style={{ color: d.candidate > 0 ? "#5d87ff" : "var(--cd-faint)" }}>{d.candidate}</span>
            <span className="text-right font-bold" style={{ color: "var(--cd-muted)" }}>{d.adopted}</span>
          </div>
          <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--cd-faint)" }} title={
            Object.entries(d.bySource).map(([s, c]) => `${STAT_SOURCE_LABELS[s] ?? s} ${c}`).join(" · ")
          }>
            {Object.entries(d.bySource)
              .sort((a, b) => b[1] - a[1])
              .map(([s, c]) => `${STAT_SOURCE_LABELS[s] ?? s} ${c}`)
              .join(" · ")}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 전체 수집 로그 모달 — 일/주/월/연 집계 전환 + 페이지네이션. */
function CollectLogsModal({ theme, onClose }: { theme: string; onClose: () => void }) {
  const [granularity, setGranularity] = useState<LogGranularity>("day");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const pageSize = 15;

  const load = useCallback(async (g: LogGranularity, p: number) => {
    setRows(null);
    try {
      const res = await fetch(`/api/sales/intel/stats/logs?granularity=${g}&page=${p}&pageSize=${pageSize}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total ?? 0));
    } catch {
      setRows([]);
      setTotal(0);
    }
  }, []);

  useEffect(() => {
    load(granularity, page);
  }, [granularity, page, load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (typeof document === "undefined") return null;
  return createPortal(
    // 포털은 .cdash 밖이라 토큰이 안 풀린다 — 루트에 cdash-vars + data-theme 부여
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[70] flex items-center justify-center p-4"
      data-theme={theme}
      style={{ background: "rgba(16,22,36,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cd-card-bg rounded-2xl border cd-border-c w-full max-w-lg flex flex-col" style={{ maxHeight: "86vh" }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b cd-border-c">
          <h3 className="cd-text text-[0.95rem] font-extrabold flex-1">전체 수집 로그</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" title="닫기" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2.5 overflow-y-auto">
          <div className="flex items-center gap-1 flex-wrap">
            {GRANULARITY_TABS.map((t) => (
              <button
                key={t.key}
                className="cd-chip cd-chip-sm"
                data-active={granularity === t.key}
                onClick={() => { setGranularity(t.key); setPage(1); }}
              >
                {t.label}
              </button>
            ))}
            <span className="text-[10px] ml-auto" style={{ color: "var(--cd-faint)" }}>
              총 {total.toLocaleString()}개 기간 · 수집일(KST) 기준
            </span>
          </div>
          {rows === null ? (
            <div className="cd-text-faint text-sm py-8 text-center">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="cd-text-faint text-sm py-8 text-center">수집 이력이 없습니다.</div>
          ) : (
            <DailyLogTable rows={rows} granularity={granularity} />
          )}
        </div>
        <div className="flex items-center justify-center gap-2 px-5 py-3 border-t cd-border-c">
          <button
            className="cd-btn cd-btn-ghost cd-btn-sm disabled:opacity-40"
            disabled={page <= 1 || rows === null}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="w-4 h-4" /> 이전
          </button>
          <span className="cd-text text-xs font-bold tabular-nums">{page} / {totalPages}</span>
          <button
            className="cd-btn cd-btn-ghost cd-btn-sm disabled:opacity-40"
            disabled={page >= totalPages || rows === null}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function IntelStatsPanel({
  theme,
  stats,
  loading,
  period,
  onPeriodChange,
}: {
  theme: string;
  stats: IntelStatsData | null;
  loading: boolean;
  /** 조회 기간 — 전체 / 연도별(1/1~12/31) / 월별(1일~말일) */
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
}) {
  const pal = chartColors(theme);
  const [bdSource, setBdSource] = useState<string>("dart");
  const [axis, setAxis] = useState<AxisKey>("signalType");
  const [logsOpen, setLogsOpen] = useState(false);

  // 연도 선택 옵션 — 2025(데이터 시작)부터 올해까지
  const yearOptions = useMemo(() => {
    const thisYear = Number(new Date().toISOString().slice(0, 4));
    const ys: string[] = [];
    for (let y = thisYear; y >= 2025; y--) ys.push(String(y));
    return ys;
  }, []);

  // 선택 소스에 데이터가 없으면 데이터 있는 첫 소스로 이동(초기 UX)
  useEffect(() => {
    if (!stats) return;
    if (stats.breakdown.some((r) => r.source === bdSource)) return;
    const first = STAT_SOURCES.find((s) => stats.breakdown.some((r) => r.source === s));
    if (first) setBdSource(first);
  }, [stats, bdSource]);

  const trendOptions = useMemo<ApexOptions>(() => ({
    chart: { type: "line", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 450 }, parentHeightOffset: 0 },
    stroke: { width: [0, 0, 2.5], curve: "smooth" },
    plotOptions: { bar: { columnWidth: "55%", borderRadius: 3, borderRadiusApplication: "end" } },
    colors: [pal.primary, pal.accent, pal.muted],
    dataLabels: { enabled: false },
    grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 4, right: 4 } },
    xaxis: {
      categories: (stats?.monthly ?? []).map((m) => `${m.month.slice(2, 4)}.${m.month.slice(5, 7)}.`),
      labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: [
      {
        seriesName: "수집 총계",
        labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => String(Math.round(v)) },
      },
      { seriesName: "수집 총계", show: false }, // 채택 건수 → 수집 총계와 스케일 공유
      {
        seriesName: "채택률",
        opposite: true,
        min: 0,
        max: 1,
        tickAmount: 4,
        labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => `${Math.round(v * 100)}%` },
      },
    ],
    legend: { labels: { colors: pal.muted }, fontSize: "11px", markers: { size: 5 } },
    tooltip: {
      theme: theme === "dark" ? "dark" : "light",
      y: {
        formatter: (v: number, opts?: { seriesIndex?: number }) =>
          opts?.seriesIndex === 2 ? `${Math.round(v * 100)}%` : `${v}건`,
      },
    },
  }), [stats, theme, pal.primary, pal.accent, pal.muted, pal.faint, pal.grid]);

  const trendSeries = useMemo(() => {
    const monthly = stats?.monthly ?? [];
    return [
      { name: "수집 총계", type: "column" as const, data: monthly.map((m) => m.collected) },
      { name: "채택 건수", type: "column" as const, data: monthly.map((m) => m.adopted) },
      { name: "채택률", type: "line" as const, data: monthly.map((m) => (m.collected > 0 ? Number((m.adopted / m.collected).toFixed(3)) : 0)) },
    ];
  }, [stats]);

  // 세부 유형: 선택 소스 × 선택 축으로 breakdown 합산
  const axisMeta = AXES.find((a) => a.key === axis)!;
  const bdCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stats?.breakdown ?? []) {
      if (row.source !== bdSource) continue;
      const key = row[axis];
      map.set(key, (map.get(key) ?? 0) + row.count);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [stats, bdSource, axis]);

  const donutOptions = useMemo<ApexOptions>(() => ({
    chart: { type: "donut", fontFamily: "inherit", animations: { speed: 450 } },
    labels: bdCounts.map(([k]) => axisMeta.labels[k] ?? k),
    colors: [pal.primary, pal.accent, pal.secondary, pal.success, pal.error],
    dataLabels: { enabled: false },
    legend: { show: false },
    stroke: { show: false },
    plotOptions: { pie: { donut: { size: "68%" } } },
    tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => `${v}건` } },
  }), [bdCounts, axisMeta, theme, pal.primary, pal.accent, pal.secondary, pal.success, pal.error]);

  const donutColors = [pal.primary, pal.accent, pal.secondary, pal.success, pal.error];

  return (
    <section className="cd-card-bg rounded-2xl border cd-border-c p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="cd-card-title cd-text text-[15px] font-extrabold">발주 정보 분석용 데이터 수집현황</h2>
        <div className="flex items-center gap-1.5">
          <select
            className="cd-select"
            style={{ width: "auto" }}
            value={period.mode}
            onChange={(e) => onPeriodChange({ ...period, mode: e.target.value as StatsPeriod["mode"] })}
            title="수집일 기준 조회 범위"
          >
            <option value="all">전체</option>
            <option value="year">연도별</option>
            <option value="month">월별</option>
          </select>
          {period.mode === "year" && (
            <select
              className="cd-select"
              style={{ width: "auto" }}
              value={period.year}
              onChange={(e) => onPeriodChange({ ...period, year: e.target.value })}
              title="조회 연도"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          )}
          {period.mode === "month" && (
            <input
              type="month"
              className="cd-input"
              style={{ width: "auto" }}
              value={period.month}
              onChange={(e) => e.target.value && onPeriodChange({ ...period, month: e.target.value })}
              title="수집일 기준 조회 월"
            />
          )}
        </div>
      </div>

      {loading || !stats ? (
        <div className="cd-text-faint text-sm py-8 text-center">수집현황을 불러오는 중…</div>
      ) : (
        <>
          {/* 수집 총계 + 소스별 6칸 */}
          <div className="grid grid-cols-[minmax(96px,0.9fr)_2fr] gap-2">
            <div className="rounded-xl border cd-border-c cd-tint-primary flex flex-col items-center justify-center py-3">
              <span className="text-[11px] font-bold" style={{ color: "var(--cd-muted)" }}>수집 총계</span>
              <span className="text-2xl font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>
                {stats.total.collected.toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {STAT_SOURCES.map((src) => (
                <div key={src} className="rounded-xl border cd-border-c px-2.5 py-2">
                  <div className="text-[10px] font-bold truncate" style={{ color: "var(--cd-muted)" }}>
                    {STAT_SOURCE_LABELS[src]}
                  </div>
                  <div className="text-right text-[15px] font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>
                    {(stats.bySource[src]?.collected ?? 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 수집현황 추이 */}
          <div className="rounded-xl border cd-border-c p-3">
            <h3 className="text-[13px] font-extrabold mb-1" style={{ color: "var(--cd-text)" }}>수집현황 추이</h3>
            <ApexChart key={`trend-${theme}-${stats.to}`} options={trendOptions} series={trendSeries} type="line" height={200} />
          </div>

          {/* 소스별 채택 현황 */}
          <div className="rounded-xl border cd-border-c p-3">
            <h3 className="text-[13px] font-extrabold mb-2" style={{ color: "var(--cd-text)" }}>소스별 채택 현황</h3>
            <div className="grid grid-cols-3 gap-2">
              {STAT_SOURCES.map((src) => {
                const st = stats.bySource[src] ?? { collected: 0, adopted: 0 };
                const pct = st.collected > 0 ? (st.adopted / st.collected) * 100 : null;
                return (
                  <div key={src} className="rounded-xl border cd-border-c px-2 py-2 flex flex-col items-center">
                    <span className="text-[10px] font-bold self-start" style={{ color: "var(--cd-muted)" }}>
                      {STAT_SOURCE_LABELS[src]}
                    </span>
                    <MiniDonut pct={pct} color={pal.primary} track={pal.track} />
                    <span className="text-[10px] font-bold tabular-nums self-end" style={{ color: "var(--cd-faint)" }}>
                      <b style={{ color: "var(--cd-text)" }}>{st.adopted}</b> / {st.collected}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 소스별 세부 유형 */}
          <div className="rounded-xl border cd-border-c p-3">
            <h3 className="text-[13px] font-extrabold mb-2" style={{ color: "var(--cd-text)" }}>소스별 세부 유형</h3>
            <div className="flex items-center gap-1 flex-wrap mb-2">
              {STAT_SOURCES.map((src) => (
                <button
                  key={src}
                  className="cd-chip cd-chip-sm"
                  data-active={bdSource === src}
                  onClick={() => setBdSource(src)}
                >
                  {STAT_SOURCE_LABELS[src]}
                </button>
              ))}
            </div>
            {bdCounts.length === 0 ? (
              <div className="cd-text-faint text-xs py-6 text-center">기간 내 수집된 신호가 없습니다.</div>
            ) : (
              <div className="grid grid-cols-[1.1fr_1fr] gap-2 items-center">
                <ApexChart
                  key={`bd-${bdSource}-${axis}-${theme}`}
                  options={donutOptions}
                  series={bdCounts.map(([, v]) => v)}
                  type="donut"
                  height={150}
                />
                <div className="flex flex-col gap-1">
                  {bdCounts.map(([k, v], i) => (
                    <div key={k} className="flex items-center gap-1.5 text-[11px]">
                      <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: donutColors[i % donutColors.length] }} />
                      <span className="font-bold truncate" style={{ color: "var(--cd-muted)" }}>{axisMeta.labels[k] ?? k}</span>
                      <span className="ml-auto font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-1 flex-wrap mt-2">
              {AXES.map((a) => (
                <button
                  key={a.key}
                  className="cd-chip cd-chip-sm"
                  data-active={axis === a.key}
                  onClick={() => setAxis(a.key)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* 일별 수집 로그 — 야간 배치가 매일 몇 건을 넣었고 그중 몇 건이 확정·후보인지 */}
          <div className="rounded-xl border cd-border-c p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[13px] font-extrabold" style={{ color: "var(--cd-text)" }}>일별 수집 로그</h3>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px]" style={{ color: "var(--cd-faint)" }}>수집일 기준 최근 5일 · 기간 선택과 무관</span>
                <button className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setLogsOpen(true)}>전체 보기</button>
              </div>
            </div>
            {(stats.daily ?? []).length === 0 ? (
              <div className="cd-text-faint text-xs py-4 text-center">최근 5일 수집 이력이 없습니다.</div>
            ) : (
              <DailyLogTable rows={stats.daily} granularity="day" />
            )}
          </div>

          {/* 삭제 피드백 — 사유별 축적 현황과 소스별 삭제율(성장형 수집 로직 모니터링) */}
          <div className="rounded-xl border cd-border-c p-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-[13px] font-extrabold" style={{ color: "var(--cd-text)" }}>삭제 피드백</h3>
              <span className="text-[10px]" style={{ color: "var(--cd-faint)" }}>누계 {stats.feedback?.total ?? 0}건</span>
            </div>
            {!stats.feedback || stats.feedback.total === 0 ? (
              <p className="cd-text-faint text-xs py-2 text-center">
                아직 삭제 피드백이 없습니다. 리스트에서 오인 수집 신호를 사유와 함께 삭제하면 여기에 축적됩니다.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {Object.entries(REASON_LABELS).map(([code, label]) => (
                    <div key={code} className="rounded-lg border cd-border-c px-2 py-1.5 text-center">
                      <div className="text-[10px] font-bold truncate" style={{ color: "var(--cd-muted)" }}>{label}</div>
                      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>
                        {stats.feedback.byReason[code] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>

                {stats.feedback.recentBySource.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[10px] font-bold mb-1" style={{ color: "var(--cd-muted)" }}>최근 30일 소스별 삭제율</p>
                    <div className="flex flex-col gap-1">
                      {stats.feedback.recentBySource.map((r) => (
                        <div key={r.source} className="flex items-center gap-2 text-[11px]">
                          <span className="font-bold" style={{ width: 64, color: "var(--cd-muted)" }}>
                            {SOURCE_LABEL[r.source] ?? STAT_SOURCE_LABELS[r.source] ?? r.source}
                          </span>
                          <span className="tabular-nums" style={{ color: "var(--cd-text)" }}>
                            {r.deleted} / {r.collected}건
                          </span>
                          <span className="tabular-nums font-extrabold" style={{ color: r.rate >= FEEDBACK_RATE_WARN ? "#fa896b" : "var(--cd-faint)" }}>
                            {(r.rate * 100).toFixed(1)}%
                          </span>
                          {r.rate >= FEEDBACK_RATE_WARN && (
                            <span className="cd-pill cd-pill-warn" title="오인 수집 비중이 높습니다 — 수집 키워드·분류 기준 점검을 권장합니다">
                              점검 권장
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stats.feedback.duplicateSims.length > 0 && (() => {
                  const med = median(stats.feedback.duplicateSims);
                  return (
                    <div className="rounded-lg px-2.5 py-2 mb-2 text-[11px]" style={{ background: "var(--cd-surface)" }}>
                      <span style={{ color: "var(--cd-muted)" }}>
                        수동 중복 삭제 {stats.feedback.duplicateSims.length}건 · 최근접 유사도 중앙값{" "}
                        <b style={{ color: "var(--cd-text)" }}>{med?.toFixed(3)}</b> (자동 병합 임계 {DEDUP_THRESHOLD})
                      </span>
                      {med != null && med < DEDUP_THRESHOLD && (
                        <span className="cd-pill cd-pill-warn ml-1.5" title="수동으로 지운 중복들이 임계 아래에 있습니다 — 임계 하향으로 자동 병합 범위를 넓힐 수 있습니다">
                          임계 하향 검토
                        </span>
                      )}
                    </div>
                  );
                })()}

                <p className="text-[10px] leading-snug" style={{ color: "var(--cd-faint)" }}>
                  삭제 사례는 다음 야간 배치부터 분류 프롬프트에 오답 실례로 자동 반영되고, 같은 신호는 재수집되지 않습니다.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {/* 전체 수집 로그 모달 */}
      {logsOpen && <CollectLogsModal theme={theme} onClose={() => setLogsOpen(false)} />}
    </section>
  );
}
