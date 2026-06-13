"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import { BarChart3, FileClock, PieChart, Table2, TrendingUp } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import type { ContractUnbilledRow, ContractUnbilledStatus } from "@/lib/ieps/unbilled-types";
import { filterUnbilledRows } from "@/lib/ieps/unbilled-filter";
import {
  CATEGORY_META,
  DASHBOARD_CATEGORIES,
  chartPalette,
  fmtCompact,
  fmtFull,
  softCategoryColor,
  type CdTheme,
} from "@/components/contracts/dashboard/types";
import { filenameFromDisposition } from "@/lib/client-download";

const TREND_YEARS = 8; // 현재 연도 기준 7년 전까지
const SUBTYPE_DONUT_COLORS = [
  "#FF6B6B",
  "#F3C16F",
  "#FFF176",
  "#B7F59A",
  "#8FD476",
  "#B9D8FF",
  "#D5A9FF",
  "#E4B4FF",
  "#F6B6E8",
  "#A8E7F2",
];

/**
 * 미발행 현황 — 용역/연도 필터 + 미발행 리스트(계약 상세 딥링크) +
 * 연도별 미발행액 추이 / 용역별 미발행 비율 / 이중 도넛 / 3개년 표.
 */
export function UnbilledSection({ theme }: { theme: CdTheme }) {
  const router = useRouter();
  const pal = chartPalette(theme);
  const [data, setData] = useState<ContractUnbilledStatus | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contracts/billing/unbilled", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
        }
        const json = (await res.json()) as ContractUnbilledStatus;
        if (cancelled) return;
        setData(json);
        if (json.availableYears.length > 0 && !json.availableYears.includes(String(new Date().getFullYear()))) {
          setYear(json.availableYears[0]);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const listRows = useMemo(
    () => filterUnbilledRows(allRows, { category, year }),
    [allRows, category, year]
  );
  const listTotal = useMemo(() => listRows.reduce((acc, r) => acc + r.amount, 0), [listRows]);

  /** 연도별 미발행액 집계 (계약일 기준) */
  const unbilledByYear = useMemo(() => {
    const m = new Map<string, { total: number; byCategory: Record<string, number> }>();
    for (const row of allRows) {
      const y = (row.contractDate ?? "").slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      const entry = m.get(y) ?? { total: 0, byCategory: {} };
      entry.total += row.amount;
      entry.byCategory[row.category] = (entry.byCategory[row.category] ?? 0) + row.amount;
      m.set(y, entry);
    }
    return m;
  }, [allRows]);

  const ordersByYear = useMemo(() => {
    const m = new Map<string, { total: number; byCategory: Record<string, number> }>();
    for (const e of data?.ordersYearly ?? []) m.set(e.year, { total: e.total, byCategory: e.byCategory });
    return m;
  }, [data]);

  const categoryColor = category
    ? softCategoryColor(CATEGORY_META[category]?.color ?? pal.primary)
    : pal.primary;

  const isAllYears = year === "all";
  const yearLabel = isAllYears ? "전체 기간" : `${year}년`;

  /* ---------------- (a) 연도별 미발행액 추이 (이중 막대 + 비율 선) ---------------- */
  const trendYears = useMemo(() => {
    const current = new Date().getFullYear();
    const years: string[] = [];
    for (let y = current - (TREND_YEARS - 1); y <= current; y += 1) years.push(String(y));
    return years;
  }, []);

  const trendSeries = useMemo(() => {
    const totalUnbilled = trendYears.map((y) => Math.round(unbilledByYear.get(y)?.total ?? 0));
    const totalRatio = trendYears.map((y) => {
      const orders = ordersByYear.get(y)?.total ?? 0;
      const unbilled = unbilledByYear.get(y)?.total ?? 0;
      return orders > 0 ? Number(((unbilled / orders) * 100).toFixed(1)) : 0;
    });
    const series: Array<{ name: string; type: "column" | "line"; data: number[] }> = [
      { name: "전체 미발행액", type: "column", data: totalUnbilled },
    ];
    if (category) {
      series.push({
        name: `${category} 미발행액`,
        type: "column",
        data: trendYears.map((y) => Math.round(unbilledByYear.get(y)?.byCategory[category] ?? 0)),
      });
    }
    series.push({ name: "전체 미발행 비율", type: "line", data: totalRatio });
    if (category) {
      series.push({
        name: `${category} 미발행 비율`,
        type: "line",
        data: trendYears.map((y) => {
          const orders = ordersByYear.get(y)?.byCategory[category] ?? 0;
          const unbilled = unbilledByYear.get(y)?.byCategory[category] ?? 0;
          return orders > 0 ? Number(((unbilled / orders) * 100).toFixed(1)) : 0;
        }),
      });
    }
    return series;
  }, [trendYears, unbilledByYear, ordersByYear, category]);

  const trendOptions = useMemo<ApexOptions>(() => {
    const amountNames = trendSeries.filter((s) => s.type === "column").map((s) => s.name);
    const ratioNames = trendSeries.filter((s) => s.type === "line").map((s) => s.name);
    // "전체" 막대는 용역 선택 필터의 활성 칩 배경색(primary)과 동일 톤
    const colors = category
      ? [pal.primary, categoryColor, pal.warning, pal.success]
      : [pal.primary, pal.warning];
    return {
      chart: {
        type: "line",
        stacked: false,
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      colors,
      stroke: { curve: "smooth", width: trendSeries.map((s) => (s.type === "line" ? 2.5 : 0)) },
      plotOptions: { bar: { columnWidth: category ? "55%" : "38%", borderRadius: 3 } },
      // 막대에만 은은한 세로 그라데이션, 비율 선은 단색 유지
      fill: {
        type: trendSeries.map((s) => (s.type === "column" ? "gradient" : "solid")),
        gradient: {
          shade: "light",
          type: "vertical",
          shadeIntensity: 0.4,
          opacityFrom: 1,
          opacityTo: 0.72,
          stops: [0, 100],
        },
      },
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 4 } },
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "left",
        fontSize: "10px",
        fontWeight: 600,
        labels: { colors: pal.muted },
        markers: { size: 4 },
        itemMargin: { horizontal: 6 },
      },
      xaxis: {
        categories: trendYears,
        labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      // 금액 축(좌) / 비율 축(우) — 같은 종류의 시리즈는 첫 축을 공유
      yaxis: [
        ...amountNames.map((_, idx) => ({
          seriesName: amountNames[0],
          show: idx === 0,
          labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => fmtCompact(v) },
        })),
        ...ratioNames.map((_, idx) => ({
          seriesName: ratioNames[0],
          opposite: true,
          show: idx === 0,
          min: 0,
          labels: {
            style: { colors: pal.faint, fontSize: "10px" },
            formatter: (v: number) => `${Math.round(v)}%`,
          },
        })),
      ],
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: {
          formatter: (v: number, opts) => {
            const name = trendSeries[opts?.seriesIndex ?? 0]?.name ?? "";
            return name.includes("비율") ? `${v.toFixed(1)}%` : fmtFull(v);
          },
        },
      },
      markers: { size: 0, hover: { size: 4 } },
    };
  }, [trendSeries, trendYears, pal, theme, category, categoryColor]);

  /* ---------------- (b) 해당연도 용역별 미발행 비율 (가로 막대) ---------------- */
  const ratioByCategory = useMemo(() => {
    const yearUnbilled = isAllYears ? aggregateAll(unbilledByYear) : unbilledByYear.get(year);
    const yearOrders = isAllYears ? aggregateAll(ordersByYear) : ordersByYear.get(year);
    return DASHBOARD_CATEGORIES.map((cat) => {
      const orders = yearOrders?.byCategory[cat] ?? 0;
      const unbilled = yearUnbilled?.byCategory[cat] ?? 0;
      return {
        category: cat,
        ratio: orders > 0 ? Number(((unbilled / orders) * 100).toFixed(1)) : 0,
        unbilled,
      };
    }).filter((e) => e.ratio > 0 || e.unbilled > 0);
  }, [unbilledByYear, ordersByYear, year, isAllYears]);

  const ratioBarOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      colors: ratioByCategory.map((e) => softCategoryColor(CATEGORY_META[e.category]?.color ?? pal.faint)),
      plotOptions: {
        bar: { horizontal: true, barHeight: "58%", borderRadius: 3, distributed: true },
      },
      fill: {
        type: "gradient",
        gradient: {
          shade: "light",
          type: "horizontal",
          shadeIntensity: 0.4,
          opacityFrom: 1,
          opacityTo: 0.75,
          stops: [0, 100],
        },
      },
      dataLabels: {
        enabled: true,
        formatter: (v: number) => `${v}%`,
        style: { fontSize: "10px", fontWeight: 700 },
      },
      legend: { show: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 8 } },
      xaxis: {
        categories: ratioByCategory.map((e) => e.category),
        labels: {
          style: { colors: pal.faint, fontSize: "10px" },
          formatter: (v: string) => `${Math.round(Number(v))}%`,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } } },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: { formatter: (v: number) => `${v.toFixed(1)}%` },
      },
    }),
    [ratioByCategory, pal, theme]
  );

  /* ---------------- (c) 이중 도넛 (선택 용역 비중 + 세분류별 비중) ---------------- */
  const yearEntry = useMemo(
    () => (isAllYears ? aggregateAll(unbilledByYear) : unbilledByYear.get(year)),
    [unbilledByYear, year, isAllYears]
  );
  const shareDonut = useMemo(() => {
    const total = yearEntry?.total ?? 0;
    if (category) {
      const catAmount = yearEntry?.byCategory[category] ?? 0;
      return {
        labels: [category, "그 외 용역"],
        series: [Math.round(catAmount), Math.round(Math.max(0, total - catAmount))],
        colors: [categoryColor, theme === "dark" ? "#2a3442" : "#dbe4ee"],
      };
    }
    const cats = DASHBOARD_CATEGORIES.filter((cat) => (yearEntry?.byCategory[cat] ?? 0) > 0);
    return {
      labels: [...cats],
      series: cats.map((cat) => Math.round(yearEntry?.byCategory[cat] ?? 0)),
      colors: cats.map((cat) => softCategoryColor(CATEGORY_META[cat]?.color ?? pal.faint, 0.14)),
    };
  }, [yearEntry, category, categoryColor, theme, pal]);

  const subtypeDonut = useMemo(() => {
    if (!category) return null;
    const m = new Map<string, number>();
    for (const row of allRows) {
      if (row.category !== category) continue;
      if (!isAllYears && (row.contractDate ?? "").slice(0, 4) !== year) continue;
      const key = row.subtype.trim() || "기타";
      m.set(key, (m.get(key) ?? 0) + row.amount);
    }
    const entries = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([k]) => k),
      series: entries.map(([, v]) => Math.round(v)),
    };
  }, [allRows, category, year, isAllYears]);

  const donutBase = (labels: string[], colors: string[], centerLabel: string, centerTotal: number): ApexOptions => ({
    chart: { type: "donut", fontFamily: "inherit", parentHeightOffset: 0, animations: { enabled: false } },
    labels,
    colors,
    stroke: { width: 3, colors: [theme === "dark" ? "#171c23" : "#ffffff"] },
    fill: {
      type: "gradient",
      gradient: {
        shade: "light",
        type: "radial",
        shadeIntensity: 0.4,
        opacityFrom: 1,
        opacityTo: 0.78,
        stops: [0, 100],
      },
    },
    dataLabels: { enabled: false },
    legend: {
      show: true,
      position: "bottom",
      fontSize: "10px",
      fontWeight: 600,
      labels: { colors: pal.muted },
      markers: { size: 4 },
      itemMargin: { horizontal: 4, vertical: 1 },
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
          size: "74%",
          labels: {
            show: true,
            name: { show: true, fontSize: "10px", color: pal.faint, offsetY: 16 },
            value: {
              show: true,
              fontSize: "13px",
              fontWeight: 800,
              color: pal.text,
              offsetY: -12,
              formatter: (v: string) => fmtCompact(Number(v)),
            },
            total: {
              show: true,
              label: centerLabel,
              fontSize: "9px",
              color: pal.faint,
              formatter: () => fmtCompact(centerTotal),
            },
          },
        },
      },
    },
    tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => fmtFull(v) } },
  });

  /* ---------------- (d) 6개년 미발행액 표 ---------------- */
  const tableYears = useMemo(() => {
    const base = /^\d{4}$/.test(year) ? Number(year) : new Date().getFullYear();
    const years: string[] = [];
    for (let y = base - 5; y <= base; y += 1) years.push(String(y));
    return years;
  }, [year]);

  const yearOptions = data?.availableYears ?? [];

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(format);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (year && /^\d{4}$/.test(year)) params.set("year", year);
      params.set("format", format);
      const res = await fetch("/api/contracts/billing/unbilled/export?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `미발행리스트_${stamp}.${format}`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setExporting(null);
    }
  };

  const openContract = (row: ContractUnbilledRow) => {
    const treeYear = (row.contractDate ?? "").slice(0, 4);
    const params = new URLSearchParams();
    params.set("contract", row.contractId);
    if (/^\d{4}$/.test(treeYear)) params.set("year", treeYear);
    params.set("milestone", row.milestoneId);
    router.push(`/contracts?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바: 용역 선택 + 연도 선택 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-extrabold mr-1" style={{ color: "var(--cd-faint)" }}>
            용역 선택
          </span>
          <button
            type="button"
            className="cd-chip cd-chip-sm"
            data-active={category === null}
            onClick={() => setCategory(null)}
          >
            전체 용역
          </button>
          {DASHBOARD_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className="cd-chip cd-chip-sm inline-flex items-center gap-1.5"
              data-active={category === cat}
              onClick={() => setCategory(cat)}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: CATEGORY_META[cat]?.color ?? "var(--cd-faint)" }}
              />
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
            기준 연도
          </span>
          <select
            className="cd-input"
            style={{ width: "7.5rem" }}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="all">전체 기간</option>
            {(yearOptions.includes(year) || isAllYears ? yearOptions : [year, ...yearOptions]).map((item) => (
              <option key={item} value={item}>
                {item}년
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p
          className="text-[11px] font-bold px-3 py-2 rounded-lg"
          style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}
        >
          불러오기 실패: {error}
        </p>
      )}

      {/* items-stretch(기본값)로 행 높이를 리스트 카드에 맞춰 우측 카드도 가득 채운다 */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.8fr)_minmax(0,0.62fr)] gap-4">
        {/* ---------------- 미발행 리스트 (좌측, 2행 차지) ---------------- */}
        <div className="cdb-box p-4 min-w-0 xl:row-span-2">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="cd-card-title">
              <span className="cd-title-icon">
                <FileClock className="w-4 h-4" />
              </span>
              미발행 리스트
            </p>
            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={() => handleExport("xlsx")}
                disabled={exporting !== null || listRows.length === 0}
                title="현재 리스트를 엑셀로 다운로드"
                className="flex items-center justify-center disabled:opacity-40"
                style={{ width: 30, height: 30 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
              </button>
              <button
                type="button"
                onClick={() => handleExport("pdf")}
                disabled={exporting !== null || listRows.length === 0}
                title="현재 리스트를 PDF로 다운로드"
                className="flex items-center justify-center disabled:opacity-40"
                style={{ width: 30, height: 30 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
              </button>
            </div>
          </div>

          {/* 총 건수 / 미발행 총액 */}
          <div className="flex items-center justify-end gap-2 mb-2 flex-wrap">
            <span className="text-[11px] font-bold" style={{ color: "var(--cd-muted)" }}>
              총 건수{" "}
              <span className="tabular-nums font-extrabold" style={{ color: "var(--cd-text)" }}>
                {listRows.length.toLocaleString()}건
              </span>
            </span>
            <span className="text-[11px] font-bold" style={{ color: "var(--cd-muted)" }}>
              미발행액 총액{" "}
              <span className="tabular-nums font-extrabold" style={{ color: "var(--cd-text)" }}>
                {listTotal > 0 ? `${fmtFull(listTotal)}원` : "-"}
              </span>
            </span>
          </div>

          {/* 열 레이블 */}
          <div
            className="cdb-unbilled-row !cursor-default text-[11px] font-extrabold"
            style={{ color: "var(--cd-faint)", background: "transparent" }}
          >
            <span>용역명</span>
            <span className="text-center">계약일</span>
            <span>조건</span>
            <span className="text-right">대상 금액</span>
          </div>

          {/* 한 번에 16건이 보이도록 (행 높이 약 50px 기준) */}
          <div className="h-[800px] overflow-y-auto scrollbar-hide">
            {loading && !data ? (
              <p className="py-10 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                미발행 데이터를 불러오는 중…
              </p>
            ) : listRows.length === 0 ? (
              <p className="py-10 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
                조건에 맞는 미발행 건이 없습니다.
              </p>
            ) : (
              listRows.map((row) => (
                <div
                  key={row.milestoneId}
                  className="cdb-unbilled-row text-xs"
                  title="클릭하면 계약 관리에서 해당 단계의 발행/수금 입력 창이 열립니다"
                  onClick={() => openContract(row)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold" style={{ color: "var(--cd-text)" }}>
                      {row.contractTitle}
                    </span>
                    <span className="block truncate text-[10px]" style={{ color: "var(--cd-faint)" }}>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                        style={{ background: CATEGORY_META[row.category]?.color ?? "var(--cd-faint)" }}
                      />
                      {row.counterpartyName || "-"}
                    </span>
                  </span>
                  <span className="text-center tabular-nums text-[11px]" style={{ color: "var(--cd-muted)" }}>
                    {row.contractDate ?? "-"}
                  </span>
                  <span className="truncate text-[11px]" style={{ color: "var(--cd-muted)" }} title={row.stageLabel || undefined}>
                    {row.stageLabel || "-"}
                  </span>
                  <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                    {row.amount > 0 ? fmtFull(row.amount) : "-"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ---------------- (a) 연도별 미발행액 추이 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-2">
            <span className="cd-title-icon">
              <TrendingUp className="w-4 h-4" />
            </span>
            연도별 미발행액 추이
          </p>
          <p className="text-[10px] font-bold mb-4" style={{ color: "var(--cd-faint)" }}>
            계약일 기준 · 막대 = 미발행액, 선 = 수주액 대비 미발행 비율
          </p>
          <ApexChart
            key={`trend-${theme}-${category ?? "all"}`}
            options={trendOptions}
            series={trendSeries}
            type="line"
            height={330}
          />
        </div>

        {/* ---------------- (b) 해당연도 용역별 미발행 비율 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-2">
            <span className="cd-title-icon">
              <BarChart3 className="w-4 h-4" />
            </span>
            {yearLabel} 용역별 미발행 비율
          </p>
          <p className="text-[10px] font-bold mb-4" style={{ color: "var(--cd-faint)" }}>
            {isAllYears ? "전체 기간" : "해당 연도"} 용역별 수주액 대비
          </p>
          {ratioByCategory.length === 0 ? (
            <EmptyHint label="표시할 미발행 데이터가 없습니다." height={330} />
          ) : (
            <ApexChart
              key={`ratiobar-${theme}-${year}`}
              options={ratioBarOptions}
              series={[{ name: "미발행 비율", data: ratioByCategory.map((e) => e.ratio) }]}
              type="bar"
              height={330}
            />
          )}
        </div>

        {/* ---------------- (c) 이중 도넛 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-4">
            <span className="cd-title-icon">
              <PieChart className="w-4 h-4" />
            </span>
            {yearLabel} 미발행액 구성
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold mb-2 text-center" style={{ color: "var(--cd-faint)" }}>
                {category ? `${category} 비중` : "용역별 비중"}
              </p>
              {shareDonut.series.reduce((a, b) => a + b, 0) <= 0 ? (
                <EmptyHint label="데이터 없음" height={250} />
              ) : (
                <ApexChart
                  key={`share-${theme}-${year}-${category ?? "all"}`}
                  options={donutBase(shareDonut.labels, shareDonut.colors, "전체 미발행액", yearEntry?.total ?? 0)}
                  series={shareDonut.series}
                  type="donut"
                  height={270}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold mb-2 text-center" style={{ color: "var(--cd-faint)" }}>
                세분류별 비중
              </p>
              {!category ? (
                <EmptyHint label="용역 분류를 선택하면 세분류별 비중이 표시됩니다." height={250} />
              ) : !subtypeDonut || subtypeDonut.series.length === 0 ? (
                <EmptyHint label="데이터 없음" height={250} />
              ) : (
                <ApexChart
                  key={`subtype-${theme}-${year}-${category}`}
                  options={donutBase(
                    subtypeDonut.labels,
                    subtypeDonut.labels.map((_, i) => subtypePalette(i)),
                    `${category} 미발행액`,
                    subtypeDonut.series.reduce((a, b) => a + b, 0)
                  )}
                  series={subtypeDonut.series}
                  type="donut"
                  height={270}
                />
              )}
            </div>
          </div>
        </div>

        {/* ---------------- (d) 6개년 미발행액 표 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-4">
            <span className="cd-title-icon">
              <Table2 className="w-4 h-4" />
            </span>
            6개년도 미발행액
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
            {tableYears.map((y) => (
              <div
                key={y}
                className="cd-row-hover grid grid-cols-[56px_1fr_1fr] gap-x-2 items-center px-2 py-2 rounded-lg"
              >
                <span className="font-bold" style={{ color: "var(--cd-muted)" }}>
                  {y}
                </span>
                <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                  {fmtFull(unbilledByYear.get(y)?.total ?? 0)}
                </span>
                <span
                  className="text-right tabular-nums font-extrabold"
                  style={{ color: category ? categoryColor : "var(--cd-faint)" }}
                >
                  {category ? fmtFull(unbilledByYear.get(y)?.byCategory[category] ?? 0) : "-"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 전체 기간 선택 시 연도별 집계 맵을 하나로 합산 */
function aggregateAll(m: Map<string, { total: number; byCategory: Record<string, number> }>) {
  const agg = { total: 0, byCategory: {} as Record<string, number> };
  for (const e of m.values()) {
    agg.total += e.total;
    for (const [cat, v] of Object.entries(e.byCategory)) {
      agg.byCategory[cat] = (agg.byCategory[cat] ?? 0) + v;
    }
  }
  return agg;
}

/** 세분류 도넛용: 대시보드 세분류 표의 좌상단→우하단 색상 순서에 맞춘 팔레트 */
function subtypePalette(index: number): string {
  return softCategoryColor(SUBTYPE_DONUT_COLORS[index % SUBTYPE_DONUT_COLORS.length], 0.08);
}

function EmptyHint({ label, height }: { label: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl text-[11px] font-bold text-center px-3"
      style={{
        height,
        background: "var(--cd-surface)",
        color: "var(--cd-faint)",
        border: "1px dashed var(--cd-border)",
      }}
    >
      {label}
    </div>
  );
}
