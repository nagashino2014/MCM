"use client";

// AI API 사용량·과금 관리(/admin/ai-usage) — docs/ai-api-usage-management-blueprint.md §5 (P1).
// 상단 KPI 6종 + 기간 필터 + 탭(대시보드 / 기능별 / 단가·모델 / 설정). 데이터는 /api/admin/ai-usage/summary 1회 로드.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CalendarRange, Coins, Gauge, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import "@/components/cdash/cdash.css";
import { DashboardTab } from "./DashboardTab";
import { FeaturesTab } from "./FeaturesTab";
import { PricesTab } from "./PricesTab";
import { SettingsTab } from "./SettingsTab";
import { fmtInt, fmtKrw, fmtPct, fmtUsd, fmtUsdSmall, type RangePreset, type SummaryResponse } from "./types";

type TabKey = "dashboard" | "features" | "prices" | "settings";

const KST_OFFSET_MS = 9 * 3600 * 1000;
const todayKst = () => new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "month", label: "당월" },
  { key: "custom", label: "직접" },
];

export function AiUsageBoard() {
  const { theme } = useCdashTheme();
  const today = useMemo(() => todayKst(), []);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customFrom, setCustomFrom] = useState(addDays(today, -29));
  const [customTo, setCustomTo] = useState(today);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset, today);
    const ok = isValidDateString(customFrom) && isValidDateString(customTo);
    return ok ? { from: customFrom <= customTo ? customFrom : customTo, to: customTo >= customFrom ? customTo : customFrom } : null;
  }, [preset, customFrom, customTo, today]);

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, asOf: today });
      const res = await fetch(`/api/admin/ai-usage/summary?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "사용량을 불러오지 못했습니다.");
      setData(j as SummaryResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, today]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis;
  const rate = data?.settings.usdKrwRate ?? null;
  const budgetPct = k?.budget.pctOfLimit ?? null;
  const forecastPct = k && k.budget.limitUsd ? (k.forecast.blended / k.budget.limitUsd) * 100 : null;
  const gaugeTone = (pct: number | null) => (pct == null ? "var(--cd-primary)" : pct >= 100 ? "var(--cd-error)" : pct >= 80 ? "var(--cd-warning)" : "var(--cd-primary)");

  const kpiCards = k
    ? [
        {
          icon: <Coins className="w-4 h-4" />,
          label: `당월 누계 (${k.month.ym})`,
          value: fmtUsd(k.month.cost),
          sub: [fmtKrw(k.month.cost, rate), `${fmtInt(k.month.calls)}회 · ${k.month.elapsedDays}/${k.month.days}일 경과`].filter(Boolean).join(" · "),
          gauge: budgetPct,
          gaugeLabel: k.budget.limitUsd != null ? `예산 ${fmtUsd(k.budget.limitUsd, 0)} 대비 ${fmtPct(budgetPct)}` : "예산 미설정",
        },
        {
          icon: <TrendingUp className="w-4 h-4" />,
          label: "월 예상 비용",
          value: fmtUsd(k.forecast.blended),
          sub: `현재 속도 기준 ${fmtUsd(k.forecast.byPace)} · 창 ${k.window.from.slice(5)}~${k.window.to.slice(5)} 일평균 ${fmtUsdSmall(k.window.dailyAvg)}`,
          gauge: forecastPct,
          gaugeLabel: forecastPct != null ? `예산 대비 ${fmtPct(forecastPct)}` : "예산 미설정",
        },
        {
          icon: <Activity className="w-4 h-4" />,
          label: "오늘",
          value: `${fmtInt(k.today.calls)}회`,
          sub: `${fmtUsd(k.today.cost, 3)}${rate ? ` · ${fmtKrw(k.today.cost, rate)}` : ""}`,
        },
        {
          icon: <Gauge className="w-4 h-4" />,
          label: "호출당 평균 비용 (30일)",
          value: fmtUsdSmall(k.last30.avgCostPerCall),
          sub: `${fmtInt(k.last30.calls)}회 · 합계 ${fmtUsd(k.last30.cost)}`,
        },
        {
          icon: <AlertTriangle className="w-4 h-4" />,
          label: "실패율 (30일)",
          value: fmtPct(k.last30.failRate, 1),
          sub: "오류·타임아웃 / 전체 호출",
          warn: (k.last30.failRate ?? 0) >= 20,
        },
        {
          icon: <CalendarRange className="w-4 h-4" />,
          label: `최근 ${k.window.days}일 일평균`,
          value: fmtUsd(k.window.dailyAvg, 3),
          sub: `창 합계 ${fmtUsd(k.window.cost)} · 월 예상의 근거`,
        },
      ]
    : [];

  const tabs = [
    { key: "dashboard" as const, label: "대시보드" },
    { key: "features" as const, label: "기능별 현황", count: data?.features.filter((f) => f.calls > 0).length },
    { key: "prices" as const, label: "단가 · 모델" },
    { key: "settings" as const, label: "설정 · 이력" },
  ];

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="AI API 사용량 · 과금"
        meta="Claude 호출 계측(ai_usage_log) — 기능별 호출·비용, 월 예상, 예산, 모델 단가"
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="새로고침" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`cd-chip cd-chip-sm ${preset === p.key ? "cd-fill-primary" : ""}`}
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <CdDateInput value={customFrom} onChange={setCustomFrom} style={{ width: 120 }} />
            <span className="cd-text-faint text-xs">~</span>
            <CdDateInput value={customTo} onChange={setCustomTo} style={{ width: 120 }} />
          </div>
        )}
        {range && (
          <span className="ml-auto text-[11px] cd-text-faint tabular-nums">
            집계 기간 {range.from} ~ {range.to} · 기준일 {today} (KST)
          </span>
        )}
      </div>

      {error && (
        <div className="cd-card rounded-2xl p-4 text-sm cd-error-text">{error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {(kpiCards.length ? kpiCards : Array.from({ length: 6 }, () => null)).map((c, i) => (
          <div key={i} className="cd-card rounded-2xl p-4 flex flex-col gap-1.5 min-h-[96px]">
            {c ? (
              <>
                <div className="flex items-center gap-1.5 text-[11px] cd-text-muted">
                  <span className="cd-text-primary">{c.icon}</span>
                  {c.label}
                </div>
                <div className={`text-xl font-bold tabular-nums ${c.warn ? "cd-error-text" : ""}`} style={{ letterSpacing: "-0.01em" }}>
                  {c.value}
                </div>
                <div className="text-[11px] cd-text-faint leading-snug">{c.sub}</div>
                {"gauge" in c && (
                  <div className="mt-auto pt-1">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cd-surface)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, c.gauge ?? 0))}%`, background: gaugeTone(c.gauge ?? null) }} />
                    </div>
                    <div className="text-[10px] cd-text-faint mt-0.5">{c.gaugeLabel}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center cd-text-faint text-xs">{loading ? "…" : "-"}</div>
            )}
          </div>
        ))}
      </div>

      <CdTabs items={tabs} active={tab} onChange={setTab} />

      {!data ? (
        <div className="cd-card rounded-3xl p-10 text-center cd-text-faint text-sm">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
              불러오는 중…
            </>
          ) : (
            error ?? "데이터가 없습니다."
          )}
        </div>
      ) : tab === "dashboard" ? (
        <DashboardTab data={data} theme={theme} />
      ) : tab === "features" ? (
        <FeaturesTab data={data} canManage={data.canManage} onChanged={load} />
      ) : tab === "prices" ? (
        <PricesTab data={data} canManage={data.canManage} onChanged={load} />
      ) : (
        <SettingsTab data={data} canManage={data.canManage} onChanged={load} />
      )}
    </div>
  );
}
