"use client";

// 대시보드 탭 — 월별 추이(예산선)·일별 그룹 스택·기능별 비중·모델별 비용. ApexCharts, cdash 팔레트.

import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette } from "@/components/contracts/dashboard/types";
import type { CdTheme } from "@/components/cdash/useCdashTheme";
import { GROUP_ORDER, fmtAxisUsd, fmtUsd, fmtUsdSmall, modelLabel, type SummaryResponse } from "./types";

const GROUP_COLORS: Record<string, string> = {
  전자결재: "#5d87ff",
  업무보고: "#49beff",
  "문서 파싱": "#13deb9",
  "양식 분석": "#ffae1f",
  "영업 인텔": "#fa896b",
  스크래퍼: "#7c8fac",
  기타: "#a5b3c9",
};

function baseOptions(theme: CdTheme): ApexOptions {
  const pal = chartPalette(theme);
  return {
    chart: { toolbar: { show: false }, fontFamily: "inherit", background: "transparent", animations: { speed: 200 } },
    dataLabels: { enabled: false },
    grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 6 } },
    xaxis: { axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } } },
    yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" } } },
    legend: { labels: { colors: pal.muted }, fontSize: "11px", markers: { size: 5 } },
    tooltip: { theme: theme === "dark" ? "dark" : "light" },
    stroke: { width: 0 },
  };
}

interface Props {
  data: SummaryResponse;
  theme: CdTheme;
}

export function DashboardTab({ data, theme }: Props) {
  const pal = chartPalette(theme);
  const limit = data.kpis.budget.limitUsd;

  const monthly = useMemo<{ options: ApexOptions; series: NonNullable<ApexOptions["series"]> }>(() => {
    const base = baseOptions(theme);
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar" },
        colors: [pal.primary],
        plotOptions: { bar: { columnWidth: "46%", borderRadius: 5, borderRadiusApplication: "end" } },
        xaxis: { ...base.xaxis, categories: data.monthly.map((m) => m.ym.slice(2).replace("-", "/")) },
        yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: fmtAxisUsd } },
        tooltip: { ...base.tooltip, y: { formatter: (v: number, o?: { dataPointIndex: number }) => `${fmtUsd(v)} · ${data.monthly[o?.dataPointIndex ?? -1]?.calls.toLocaleString() ?? 0}회` } },
        annotations: limit
          ? {
              yaxis: [
                {
                  y: limit,
                  borderColor: pal.accent,
                  strokeDashArray: 4,
                  label: { text: `예산 ${fmtUsd(limit, 0)}`, position: "left", textAnchor: "start", style: { color: "#fff", background: pal.accent, fontSize: "10px" } },
                },
              ],
            }
          : undefined,
      },
      series: [{ name: "추정 비용", data: data.monthly.map((m) => Math.round(m.cost * 100) / 100) }],
    };
  }, [data.monthly, theme, pal, limit]);

  const daily = useMemo<{ options: ApexOptions; series: NonNullable<ApexOptions["series"]> }>(() => {
    const base = baseOptions(theme);
    const groups = GROUP_ORDER.filter((g) => data.daily.some((d) => (d.byGroup[g] ?? 0) > 0));
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", stacked: true },
        colors: groups.map((g) => GROUP_COLORS[g] ?? pal.faint),
        plotOptions: { bar: { columnWidth: data.daily.length > 40 ? "80%" : "55%", borderRadius: 3, borderRadiusApplication: "end" } },
        xaxis: { ...base.xaxis, categories: data.daily.map((d) => d.day.slice(5)), tickAmount: Math.min(12, data.daily.length) },
        yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: fmtAxisUsd } },
        tooltip: { ...base.tooltip, y: { formatter: (v: number) => fmtUsdSmall(v) } },
      },
      series: groups.map((g) => ({ name: g, data: data.daily.map((d) => Math.round((d.byGroup[g] ?? 0) * 10000) / 10000) })),
    };
  }, [data.daily, theme, pal]);

  const donut = useMemo<{ options: ApexOptions; series: number[]; labels: string[] }>(() => {
    const sorted = [...data.features].filter((f) => f.cost > 0).sort((a, b) => b.cost - a.cost);
    const top = sorted.slice(0, 8);
    const rest = sorted.slice(8).reduce((s, f) => s + f.cost, 0);
    const labels = [...top.map((f) => f.label), ...(rest > 0 ? ["기타"] : [])];
    const series = [...top.map((f) => Math.round(f.cost * 10000) / 10000), ...(rest > 0 ? [Math.round(rest * 10000) / 10000] : [])];
    return {
      labels,
      series,
      options: {
        chart: { type: "donut", fontFamily: "inherit", background: "transparent" },
        labels,
        colors: ["#5d87ff", "#49beff", "#13deb9", "#ffae1f", "#fa896b", "#7c8fac", "#8e6cf1", "#2fb3a0", "#a5b3c9"],
        legend: { position: "bottom", labels: { colors: pal.muted }, fontSize: "11px", markers: { size: 5 } },
        dataLabels: { enabled: false },
        stroke: { width: 0 },
        plotOptions: { pie: { donut: { size: "68%", labels: { show: true, total: { show: true, label: "합계", color: pal.muted, formatter: (w) => fmtUsd((w.globals.seriesTotals as number[]).reduce((a, b) => a + b, 0)) } } } } },
        tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => fmtUsdSmall(v) } },
      },
    };
  }, [data.features, theme, pal]);

  const models = useMemo<{ options: ApexOptions; series: NonNullable<ApexOptions["series"]> }>(() => {
    const base = baseOptions(theme);
    const rows = data.models.filter((m) => m.cost > 0);
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", stacked: true },
        colors: [pal.primary, pal.accent],
        plotOptions: { bar: { horizontal: true, barHeight: "55%", borderRadius: 4 } },
        xaxis: { ...base.xaxis, categories: rows.map((m) => modelLabel(m.modelFamily, data.prices)), labels: { ...base.xaxis?.labels, formatter: (v: string) => fmtAxisUsd(Number(v)) } },
        yaxis: { labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } } },
        legend: { ...base.legend, position: "top" },
        tooltip: { ...base.tooltip, y: { formatter: (v: number) => fmtUsdSmall(v) } },
      },
      series: [
        { name: "입력비", data: rows.map((m) => Math.round((m.costIn ?? 0) * 10000) / 10000) },
        { name: "출력비", data: rows.map((m) => Math.round((m.costOut ?? 0) * 10000) / 10000) },
      ],
    };
  }, [data.models, data.prices, theme, pal]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="cd-card-title">월별 추정 비용 (12개월)</h3>
          <span className="text-[11px] cd-text-faint">앱 로그 기준 · 실제 청구 대조는 P3</span>
        </div>
        <div className="h-[240px]">
          <ApexChart type="bar" height={240} options={monthly.options} series={monthly.series} />
        </div>
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="cd-card-title">일별 비용 · 기능 그룹별</h3>
          <span className="text-[11px] cd-text-faint">{data.range.from} ~ {data.range.to}</span>
        </div>
        <div className="h-[240px]">
          {daily.series.length ? (
            <ApexChart type="bar" height={240} options={daily.options} series={daily.series} />
          ) : (
            <div className="h-full flex items-center justify-center cd-text-faint text-sm">기간 내 호출이 없습니다.</div>
          )}
        </div>
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <h3 className="cd-card-title">기능별 비용 비중</h3>
        <div className="h-[300px]">
          {donut.series.length ? (
            <ApexChart type="donut" height={300} options={donut.options} series={donut.series} />
          ) : (
            <div className="h-full flex items-center justify-center cd-text-faint text-sm">기간 내 호출이 없습니다.</div>
          )}
        </div>
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="cd-card-title">모델별 비용 · 입력/출력 분해</h3>
          <span className="text-[11px] cd-text-faint">현재 단가 기준 재계산</span>
        </div>
        <div className="h-[300px]">
          {data.models.some((m) => m.cost > 0) ? (
            <ApexChart type="bar" height={300} options={models.options} series={models.series} />
          ) : (
            <div className="h-full flex items-center justify-center cd-text-faint text-sm">기간 내 호출이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
