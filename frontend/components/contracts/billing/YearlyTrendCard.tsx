"use client";

import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import { TrendingUp } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import type { ContractOrdersYearlyEntry } from "@/lib/ieps/contracts";
import {
  CATEGORY_META,
  DASHBOARD_CATEGORIES,
  chartPalette,
  fmtCompact,
  fmtFull,
  softCategoryColor,
  type CdTheme,
} from "@/components/contracts/dashboard/types";

/**
 * 연도별 수주 현황 추이 — 수주 계약 리스트 하단 카드.
 *  (a) 10개년 전체/선택 용역 수주액 이중 라인
 *  (b) 기준연도 용역별 수주액 비율 도넛
 *  (c) 선택 용역의 전체 대비 비율 7개년 (그라데이션 면적 라인)
 *  (d) 전체/선택 용역 3개년 수주액 표 (선 없는 표)
 */
export function YearlyTrendCard({
  theme,
  year,
  category,
  yearly,
}: {
  theme: CdTheme;
  year: string | null;
  category: string | null;
  yearly: ContractOrdersYearlyEntry[];
}) {
  const pal = chartPalette(theme);
  const categoryColor = category
    ? softCategoryColor(CATEGORY_META[category]?.color ?? pal.primary)
    : pal.primary;

  const catAmount = (entry: ContractOrdersYearlyEntry): number =>
    category ? entry.byCategory[category] ?? 0 : 0;

  /* ---------- (a) 10개년 이중 라인 ---------- */
  const lineOptions = useMemo<ApexOptions>(
    () => ({
      // 애니메이션 중 리마운트 시 ApexCharts 내부에서 제거된 DOM 노드를 참조하는
      // "Cannot read properties of null (reading 'node')" 버그가 있어 비활성화
      chart: {
        type: "line",
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      stroke: { curve: "smooth", width: 3 },
      // "전체 용역" 선은 용역 선택 필터의 활성 칩 배경색(primary)과 동일 톤으로 맞춘다
      colors: [pal.primary, categoryColor],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 4 } },
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "left",
        fontSize: "11px",
        fontWeight: 600,
        labels: { colors: pal.muted },
        markers: { size: 4 },
        itemMargin: { horizontal: 8 },
      },
      xaxis: {
        categories: yearly.map((e) => e.year),
        labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => fmtCompact(v) },
      },
      tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => fmtFull(v) } },
      markers: { size: 0, hover: { size: 4 } },
    }),
    [theme, pal, categoryColor, yearly]
  );

  const lineSeries = useMemo(() => {
    const series: Array<{ name: string; data: number[] }> = [
      { name: "전체 용역", data: yearly.map((e) => Math.round(e.total)) },
    ];
    if (category) series.push({ name: category, data: yearly.map((e) => Math.round(catAmount(e))) });
    return series;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearly, category]);

  /* ---------- (b) 기준연도(또는 전체 기간) 용역별 비율 도넛 ---------- */
  const isAllPeriod = year === "all";
  const currentEntry = useMemo<ContractOrdersYearlyEntry | null>(() => {
    if (yearly.length === 0) return null;
    if (!isAllPeriod) return yearly[yearly.length - 1];
    // 전체 기간: 10개년 합산
    const agg: ContractOrdersYearlyEntry = { year: "전체 기간", total: 0, byCategory: {} };
    for (const e of yearly) {
      agg.total += e.total;
      for (const [cat, amount] of Object.entries(e.byCategory)) {
        agg.byCategory[cat] = (agg.byCategory[cat] ?? 0) + amount;
      }
    }
    return agg;
  }, [yearly, isAllPeriod]);
  const donutCategories = useMemo(
    () => DASHBOARD_CATEGORIES.filter((cat) => (currentEntry?.byCategory[cat] ?? 0) > 0),
    [currentEntry]
  );
  const donutLabel = isAllPeriod ? "전체 기간" : `${currentEntry?.year ?? ""}년`;
  const donutOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "donut",
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      labels: [...donutCategories],
      colors: donutCategories.map((cat) => softCategoryColor(CATEGORY_META[cat]?.color ?? pal.faint, 0.14)),
      stroke: { width: 3, colors: [theme === "dark" ? "#171c23" : "#ffffff"] },
      fill: {
        type: "gradient",
        gradient: {
          shade: "light",
          type: "radial",
          shadeIntensity: 0.35,
          opacityFrom: 1,
          opacityTo: 0.78,
          stops: [0, 100],
        },
      },
      dataLabels: { enabled: false },
      legend: {
        show: true,
        position: "right",
        offsetY: 0,
        fontSize: "10px",
        fontWeight: 600,
        labels: { colors: pal.muted },
        markers: { size: 4 },
        itemMargin: { horizontal: 0, vertical: 2 },
        // 범례에 분류명 + 점유 비율(%) 표기
        formatter: (seriesName: string, opts) => {
          const series = (opts?.w?.globals?.series as number[] | undefined) ?? [];
          const total = series.reduce((acc, v) => acc + v, 0);
          const value = series[opts?.seriesIndex ?? -1] ?? 0;
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          return `${seriesName} ${pct}%`;
        },
      },
      plotOptions: {
        pie: {
          donut: {
            size: "78%",
            labels: {
              show: true,
              name: { show: true, fontSize: "10px", color: pal.faint, offsetY: 16 },
              value: {
                show: true,
                fontSize: "15px",
                fontWeight: 800,
                color: pal.text,
                offsetY: -12,
                formatter: (v: string) => fmtCompact(Number(v)),
              },
              total: {
                show: true,
                label: `${donutLabel} 수주총액`,
                fontSize: "10px",
                color: pal.faint,
                formatter: () => fmtCompact(currentEntry?.total ?? 0),
              },
            },
          },
        },
      },
      tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => fmtFull(v) } },
    }),
    [theme, pal, donutCategories, currentEntry, donutLabel]
  );
  const donutSeries = useMemo(
    () => donutCategories.map((cat) => Math.round(currentEntry?.byCategory[cat] ?? 0)),
    [donutCategories, currentEntry]
  );

  /* ---------- (c) 선택 용역 비율 추이 (7개년, 그라데이션 면적) ---------- */
  const ratioYears = yearly.slice(-7);
  const ratioOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "area",
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      stroke: { curve: "smooth", width: 2.5 },
      colors: [categoryColor],
      dataLabels: { enabled: false },
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 0.6, opacityFrom: 0.32, opacityTo: 0.02, stops: [0, 100] },
      },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 4 } },
      xaxis: {
        categories: ratioYears.map((e) => e.year),
        labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        min: 0,
        labels: {
          style: { colors: pal.faint, fontSize: "10px" },
          formatter: (v: number) => `${Math.round(v)}%`,
        },
      },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: { formatter: (v: number) => `${v.toFixed(1)}%` },
      },
      markers: { size: 0, hover: { size: 4 } },
    }),
    [theme, pal, categoryColor, ratioYears]
  );
  const ratioSeries = useMemo(
    () => [
      {
        name: category ? `${category} 비율` : "비율",
        data: ratioYears.map((e) =>
          e.total > 0 ? Number(((catAmount(e) / e.total) * 100).toFixed(1)) : 0
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ratioYears, category]
  );

  /* ---------- (d) 3개년 수주액 표 ---------- */
  const tableYears = yearly.slice(-3);

  return (
    <div className="cdb-box p-4">
      <p className="cd-card-title mb-3">
        <span className="cd-title-icon">
          <TrendingUp className="w-4 h-4" />
        </span>
        연도별 수주 현황 추이
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
        {/* (a) 10개년 수주액 추이 */}
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold mb-1" style={{ color: "var(--cd-faint)" }}>
            연도별 수주액 추이 (10개년)
          </p>
          <ApexChart
            key={`line-${theme}-${year}-${category ?? "all"}`}
            options={lineOptions}
            series={lineSeries}
            type="line"
            height={168}
          />
        </div>

        {/* (b) 기준연도(또는 전체 기간) 용역별 비율 도넛 */}
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold mb-1" style={{ color: "var(--cd-faint)" }}>
            {donutLabel} 용역별 수주 비율
          </p>
          {donutSeries.length === 0 ? (
            <EmptyHint label="표시할 수주 데이터가 없습니다." />
          ) : (
            <ApexChart
              key={`donut-${theme}-${year}`}
              options={donutOptions}
              series={donutSeries}
              type="donut"
              height={180}
            />
          )}
        </div>

        {/* (c) 선택 용역 비율 추이 */}
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold mb-1" style={{ color: "var(--cd-faint)" }}>
            {category ? `${category} — 전체 수주액 대비 비율 추이 (7개년)` : "전체 수주액 대비 비율 추이 (7개년)"}
          </p>
          {category ? (
            <ApexChart
              key={`ratio-${theme}-${year}-${category}`}
              options={ratioOptions}
              series={ratioSeries}
              type="area"
              height={150}
            />
          ) : (
            <EmptyHint label="용역 분류를 선택하면 비율 추이가 표시됩니다." />
          )}
        </div>

        {/* (d) 3개년 수주액 표 */}
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold mb-1" style={{ color: "var(--cd-faint)" }}>
            3개년 수주액
          </p>
          <div className="text-[11px] mt-1">
            <div
              className="grid grid-cols-[56px_1fr_1fr] gap-x-2 items-center px-2 py-1.5 font-bold"
              style={{ color: "var(--cd-faint)" }}
            >
              <span>연도</span>
              <span className="text-right">전체 용역</span>
              <span className="text-right inline-flex items-center justify-end gap-1.5">
                {category && (
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: categoryColor }} />
                )}
                {category ?? "선택 용역"}
              </span>
            </div>
            {tableYears.map((entry) => (
              <div
                key={entry.year}
                className="cd-row-hover grid grid-cols-[56px_1fr_1fr] gap-x-2 items-center px-2 py-2 rounded-lg"
              >
                <span className="font-bold" style={{ color: "var(--cd-muted)" }}>
                  {entry.year}
                </span>
                <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                  {fmtFull(entry.total)}
                </span>
                <span
                  className="text-right tabular-nums font-extrabold"
                  style={{ color: category ? categoryColor : "var(--cd-faint)" }}
                >
                  {category ? fmtFull(entry.byCategory[category] ?? 0) : "-"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center h-[150px] rounded-xl text-[11px] font-bold"
      style={{ background: "var(--cd-surface)", color: "var(--cd-faint)", border: "1px dashed var(--cd-border)" }}
    >
      {label}
    </div>
  );
}
