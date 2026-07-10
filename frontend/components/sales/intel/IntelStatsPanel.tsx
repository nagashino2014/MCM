"use client";

// 우측 "발주 정보 분석용 데이터 수집현황" 패널 — 기간(수집일 기준) 총계·추이·소스별 채택·세부 유형.
// 채택 = 영업건 전환(converted) 또는 등급 confirmed.

import { useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { INTEL_SIGNAL_TYPE_LABELS, INTEL_SIGNAL_GRADE_LABELS } from "@/lib/intel/signal-extractor";
import { MATCH_LABEL, STAT_SOURCE_LABELS, STATUS_LABEL } from "./intel-shared";

interface SourceStat { collected: number; adopted: number }
interface BreakdownRow {
  source: string; signalType: string; matchStatus: string; status: string; grade: string; count: number;
}
export interface IntelStatsData {
  from: string;
  to: string;
  bySource: Record<string, SourceStat>;
  total: SourceStat;
  monthly: Array<{ month: string; collected: number; adopted: number }>;
  breakdown: BreakdownRow[];
  /** 소스별 마지막 수집 실행(수동 실행 패널 표시용) */
  collectState: Array<{ source: string; lastRunAt: string | null; lastCursor: string | null }>;
}

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

export function IntelStatsPanel({
  theme,
  stats,
  loading,
  month,
  onMonthChange,
}: {
  theme: string;
  stats: IntelStatsData | null;
  loading: boolean;
  /** 'YYYY-MM' — 기간은 해당 월 1일~말일 */
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const pal = chartColors(theme);
  const [bdSource, setBdSource] = useState<string>("dart");
  const [axis, setAxis] = useState<AxisKey>("signalType");

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
        <input
          type="month"
          className="cd-input"
          style={{ width: "auto" }}
          value={month}
          onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          title="수집일 기준 조회 월"
        />
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
        </>
      )}
    </section>
  );
}
