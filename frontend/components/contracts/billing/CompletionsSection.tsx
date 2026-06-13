"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import { BadgeCheck, BarChart3, ListTree, Timer, TrendingUp } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import type { ContractCompletionRow, ContractCompletionsStatus } from "@/lib/ieps/completions-types";
import { completionDate } from "@/lib/ieps/completions-types";
import { filterCompletionRows } from "@/lib/ieps/completions-filter";
import {
  CATEGORY_META,
  DASHBOARD_CATEGORIES,
  chartPalette,
  softCategoryColor,
  type CdTheme,
} from "@/components/contracts/dashboard/types";
import { filenameFromDisposition } from "@/lib/client-download";

const TREND_YEARS = 8; // 완료 건수 추이: 현재 연도 기준 7년 전까지
const PERIOD_YEARS = 7; // 평균 완료 소요기간: 7개년도

/** 용역 세분류 칩 — 통합환경허가 선택 시에만 활성화 */
const INTEGRATED_SUBTYPES = ["최초허가", "변경허가", "변경신고", "재검토", "사후관리", "통합교육"];
const INTEGRATED_CATEGORY = "통합환경허가";

/**
 * 완료 현황 — 용역/세분류/연도 필터 + 완료 리스트(계약 상세 딥링크) +
 * 연도별 완료 건수 추이 / 용역별 완료 비율 / 평균 완료 소요기간 / 세분류별 완료 비율.
 * 완료 건 = 완료일(허가일) 혹은 완료일(발행일)이 존재하는 계약.
 * 연도 분류는 모두 계약일 기준이다.
 */
export function CompletionsSection({ theme }: { theme: CdTheme }) {
  const router = useRouter();
  const pal = chartPalette(theme);
  const [data, setData] = useState<ContractCompletionsStatus | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [subtype, setSubtype] = useState<string | null>(null);
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contracts/billing/completions", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
        }
        const json = (await res.json()) as ContractCompletionsStatus;
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

  const subtypeEnabled = category === INTEGRATED_CATEGORY;

  const selectCategory = (next: string | null) => {
    setCategory(next);
    // 통합환경허가가 아닌 분류로 바뀌면 세분류 선택 해제
    if (next !== INTEGRATED_CATEGORY) setSubtype(null);
  };

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const listRows = useMemo(
    () => filterCompletionRows(allRows, { category, subtype: subtypeEnabled ? subtype : null, year }),
    [allRows, category, subtype, subtypeEnabled, year]
  );

  /** 연도별 완료 건수 집계 (계약일 기준) */
  const completedByYear = useMemo(() => {
    const m = new Map<
      string,
      { total: number; byCategory: Record<string, number>; bySubtype: Record<string, Record<string, number>> }
    >();
    for (const row of allRows) {
      const y = (row.contractDate ?? "").slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      const entry = m.get(y) ?? { total: 0, byCategory: {}, bySubtype: {} };
      entry.total += 1;
      entry.byCategory[row.category] = (entry.byCategory[row.category] ?? 0) + 1;
      const sub = row.subtype.trim();
      if (sub) {
        const subMap = entry.bySubtype[row.category] ?? {};
        subMap[sub] = (subMap[sub] ?? 0) + 1;
        entry.bySubtype[row.category] = subMap;
      }
      m.set(y, entry);
    }
    return m;
  }, [allRows]);

  const contractsByYear = useMemo(() => {
    const m = new Map<
      string,
      { total: number; byCategory: Record<string, number>; bySubtype: Record<string, Record<string, number>> }
    >();
    for (const e of data?.contractsYearly ?? []) {
      m.set(e.year, { total: e.total, byCategory: e.byCategory, bySubtype: e.bySubtype });
    }
    return m;
  }, [data]);

  const categoryColor = category
    ? softCategoryColor(CATEGORY_META[category]?.color ?? pal.primary)
    : pal.primary;

  const isAllYears = year === "all";
  const yearLabel = isAllYears ? "전체 기간" : `${year}년`;

  /* ---------------- (a) 연도별 완료 건수 추이 (물결 선) ---------------- */
  const trendYears = useMemo(() => {
    const current = new Date().getFullYear();
    const years: string[] = [];
    for (let y = current - (TREND_YEARS - 1); y <= current; y += 1) years.push(String(y));
    return years;
  }, []);

  const trendSeries = useMemo(() => {
    const series: Array<{ name: string; data: number[] }> = [
      { name: "전체 완료 건수", data: trendYears.map((y) => completedByYear.get(y)?.total ?? 0) },
    ];
    if (category) {
      series.push({
        name: `${category} 완료 건수`,
        data: trendYears.map((y) => completedByYear.get(y)?.byCategory[category] ?? 0),
      });
    }
    return series;
  }, [trendYears, completedByYear, category]);

  const trendOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "line",
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      // "전체" 선은 용역 선택 필터의 활성 칩 배경색(primary)과 동일 톤
      colors: category ? [pal.primary, categoryColor] : [pal.primary],
      stroke: { curve: "smooth", width: 2.5 },
      markers: { size: 4, strokeWidth: 0, hover: { size: 6 } },
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 8 } },
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
      yaxis: {
        min: 0,
        forceNiceScale: true,
        labels: {
          style: { colors: pal.faint, fontSize: "10px" },
          formatter: (v: number) => `${Math.round(v)}건`,
        },
      },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: { formatter: (v: number) => `${v}건` },
      },
    }),
    [trendYears, pal, theme, category, categoryColor]
  );

  /* ---------------- (b) 해당연도 용역별 완료 비율 (가로 막대) ---------------- */
  const ratioByCategory = useMemo(() => {
    const yearCompleted = isAllYears ? aggregateAll(completedByYear) : completedByYear.get(year);
    const yearContracts = isAllYears ? aggregateAll(contractsByYear) : contractsByYear.get(year);
    return DASHBOARD_CATEGORIES.map((cat) => {
      const contracts = yearContracts?.byCategory[cat] ?? 0;
      const completed = yearCompleted?.byCategory[cat] ?? 0;
      return {
        category: cat,
        ratio: contracts > 0 ? Number(((completed / contracts) * 100).toFixed(1)) : 0,
        completed,
        contracts,
      };
    }).filter((e) => e.contracts > 0 || e.completed > 0);
  }, [completedByYear, contractsByYear, year, isAllYears]);

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
        max: 100,
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
        y: {
          formatter: (v: number, opts) => {
            const e = ratioByCategory[opts?.dataPointIndex ?? -1];
            return e ? `${v.toFixed(1)}% (${e.completed}/${e.contracts}건)` : `${v.toFixed(1)}%`;
          },
        },
      },
    }),
    [ratioByCategory, pal, theme]
  );

  /* ---------------- (c) 7개년 평균 완료 소요기간 (세로 막대) ---------------- */
  const periodYears = useMemo(() => {
    const current = new Date().getFullYear();
    const years: string[] = [];
    for (let y = current - (PERIOD_YEARS - 1); y <= current; y += 1) years.push(String(y));
    return years;
  }, []);

  const periodStats = useMemo(() => {
    const acc = new Map<string, { allSum: number; allCnt: number; catSum: number; catCnt: number }>();
    for (const y of periodYears) acc.set(y, { allSum: 0, allCnt: 0, catSum: 0, catCnt: 0 });
    for (const row of allRows) {
      const y = (row.contractDate ?? "").slice(0, 4);
      const entry = acc.get(y);
      if (!entry || !row.contractDate) continue;
      const done = completionDate(row);
      if (!done) continue;
      const started = Date.parse(row.contractDate);
      const finished = Date.parse(done);
      if (!Number.isFinite(started) || !Number.isFinite(finished)) continue;
      const days = Math.max(0, Math.round((finished - started) / (1000 * 60 * 60 * 24)));
      entry.allSum += days;
      entry.allCnt += 1;
      if (category && row.category === category) {
        entry.catSum += days;
        entry.catCnt += 1;
      }
    }
    return periodYears.map((y) => {
      const e = acc.get(y)!;
      return {
        year: y,
        all: e.allCnt > 0 ? Math.round(e.allSum / e.allCnt) : 0,
        cat: category && e.catCnt > 0 ? Math.round(e.catSum / e.catCnt) : 0,
      };
    });
  }, [allRows, periodYears, category]);

  const periodSeries = useMemo(() => {
    const series: Array<{ name: string; data: number[] }> = [
      { name: "전체 용역", data: periodStats.map((e) => e.all) },
    ];
    if (category) {
      series.push({ name: category, data: periodStats.map((e) => e.cat) });
    }
    return series;
  }, [periodStats, category]);

  const periodOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
      },
      colors: category ? [pal.primary, categoryColor] : [pal.primary],
      plotOptions: { bar: { columnWidth: category ? "55%" : "38%", borderRadius: 3 } },
      fill: {
        type: "gradient",
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
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 8 } },
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
        categories: periodYears,
        labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        min: 0,
        labels: {
          style: { colors: pal.faint, fontSize: "10px" },
          formatter: (v: number) => `${Math.round(v)}일`,
        },
      },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: { formatter: (v: number) => `${v}일` },
      },
    }),
    [periodYears, pal, theme, category, categoryColor]
  );

  /* ---------------- (d) 해당연도 용역별 세부분류별 완료 비율 ---------------- */
  const subtypeRatios = useMemo(() => {
    if (!category) return [];
    const completedEntry = isAllYears ? aggregateAll(completedByYear) : completedByYear.get(year);
    const contractsEntry = isAllYears ? aggregateAll(contractsByYear) : contractsByYear.get(year);
    const completedSub = completedEntry?.bySubtype[category] ?? {};
    const contractsSub = contractsEntry?.bySubtype[category] ?? {};
    const keys = [...new Set([...Object.keys(contractsSub), ...Object.keys(completedSub)])];
    return keys
      .map((sub) => {
        const contracts = contractsSub[sub] ?? 0;
        const completed = completedSub[sub] ?? 0;
        return {
          subtype: sub,
          ratio: contracts > 0 ? Number(((completed / contracts) * 100).toFixed(1)) : 0,
          completed,
          contracts,
        };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }, [category, completedByYear, contractsByYear, year, isAllYears]);

  // 스파이더(레이더) 차트 — 세분류별 완료 비율 (첨부 스샷과 동일한 항목별 점수 형태)
  const subtypeRadialOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "radar",
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: false },
        toolbar: { show: false },
      },
      // 전체 용역 평균값(100%) 대비 비율 기준선 겸 업계평균 역할로 채우기
      fill: {
        type: "gradient",
        gradient: {
          shade: "light",
          type: "radial",
          shadeIntensity: 0.3,
          opacityFrom: 0.55,
          opacityTo: 0.15,
          stops: [0, 100],
        },
      },
      stroke: { width: 1.5 },
      markers: { size: 3, hover: { size: 5 } },
      colors: [categoryColor],
      xaxis: {
        categories: subtypeRatios.map((e) => e.subtype),
        labels: {
          style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 },
        },
      },
      yaxis: {
        min: 0,
        max: 100,
        tickAmount: 4,
        labels: {
          style: { colors: pal.faint, fontSize: "9px" },
          formatter: (v: number) => `${Math.round(v)}%`,
        },
      },
      plotOptions: {
        radar: {
          polygons: {
            strokeColors: theme === "dark" ? "#232c39" : "#e5eaf0",
            fill: { colors: theme === "dark" ? ["#1d2530", "#232c39"] : ["#f5f8fb", "#eef3f8"] },
          },
        },
      },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: {
          formatter: (v: number, opts) => {
            const e = subtypeRatios[opts?.dataPointIndex ?? -1];
            return e ? `${v.toFixed(1)}% (${e.completed}/${e.contracts}건)` : `${v.toFixed(1)}%`;
          },
        },
      },
      legend: { show: false },
    }),
    [subtypeRatios, pal, theme, categoryColor]
  );

  const yearOptions = data?.availableYears ?? [];

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(format);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (subtypeEnabled && subtype) params.set("subtype", subtype);
      if (year && /^\d{4}$/.test(year)) params.set("year", year);
      params.set("format", format);
      const res = await fetch("/api/contracts/billing/completions/export?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `완료리스트_${stamp}.${format}`);
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

  const openContract = (row: ContractCompletionRow) => {
    const treeYear = (row.contractDate ?? "").slice(0, 4);
    const params = new URLSearchParams();
    params.set("contract", row.contractId);
    if (/^\d{4}$/.test(treeYear)) params.set("year", treeYear);
    router.push(`/contracts?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바 1행: 용역 선택 + 연도 선택 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-extrabold mr-1" style={{ color: "var(--cd-faint)" }}>
            용역 선택
          </span>
          <button
            type="button"
            className="cd-chip cd-chip-sm"
            data-active={category === null}
            onClick={() => selectCategory(null)}
          >
            전체 용역
          </button>
          {DASHBOARD_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className="cd-chip cd-chip-sm inline-flex items-center gap-1.5"
              data-active={category === cat}
              onClick={() => selectCategory(cat)}
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

      {/* 필터 바 2행: 용역 세분류 (통합환경허가 선택 시에만 활성화) */}
      <div className="flex items-center gap-1.5 flex-wrap -mt-1.5">
        <span className="text-[11px] font-extrabold mr-1" style={{ color: "var(--cd-faint)" }}>
          용역 세분류
        </span>
        {INTEGRATED_SUBTYPES.map((sub) => (
          <button
            key={sub}
            type="button"
            className="cd-chip cd-chip-sm disabled:opacity-35 disabled:cursor-not-allowed"
            data-active={subtypeEnabled && subtype === sub}
            disabled={!subtypeEnabled}
            title={subtypeEnabled ? undefined : "용역 선택에서 통합환경허가를 선택하면 활성화됩니다"}
            onClick={() => setSubtype((prev) => (prev === sub ? null : sub))}
          >
            {sub}
          </button>
        ))}
        {!subtypeEnabled && (
          <span className="text-[10px] font-bold" style={{ color: "var(--cd-faint)" }}>
            — 통합환경허가 선택 시 활성화
          </span>
        )}
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
        {/* ---------------- 완료 리스트 (좌측, 2행 차지) ---------------- */}
        <div className="cdb-box p-4 min-w-0 xl:row-span-2">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="cd-card-title">
              <span className="cd-title-icon">
                <BadgeCheck className="w-4 h-4" />
              </span>
              완료 리스트
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

          {/* 총 완료 건수 */}
          <div className="flex items-center justify-end gap-2 mb-2 flex-wrap">
            <span className="text-[11px] font-bold" style={{ color: "var(--cd-muted)" }}>
              총 완료 건수{" "}
              <span className="tabular-nums font-extrabold" style={{ color: "var(--cd-text)" }}>
                {listRows.length.toLocaleString()}건
              </span>
            </span>
          </div>

          {/* 열 레이블 */}
          <div
            className="cdb-completion-row !cursor-default text-[11px] font-extrabold"
            style={{ color: "var(--cd-faint)", background: "transparent" }}
          >
            <span>용역명</span>
            <span className="text-center">계약일</span>
            <span className="text-center">완료일(허가일)</span>
            <span className="text-center">완료일(발행일)</span>
          </div>

          {/* 한 번에 15건이 보이도록 (행 높이 약 50px 기준) */}
          <div className="h-[750px] overflow-y-auto scrollbar-hide">
            {loading && !data ? (
              <p className="py-10 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                완료 데이터를 불러오는 중…
              </p>
            ) : listRows.length === 0 ? (
              <p className="py-10 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
                조건에 맞는 완료 건이 없습니다.
              </p>
            ) : (
              listRows.map((row) => (
                <div
                  key={row.contractId}
                  className="cdb-completion-row text-xs"
                  title="클릭하면 계약 관리에서 해당 계약 상세 정보가 열립니다"
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
                      {row.subtype ? ` · ${row.subtype}` : ""}
                    </span>
                  </span>
                  <span className="text-center tabular-nums text-[11px]" style={{ color: "var(--cd-muted)" }}>
                    {row.contractDate ?? "-"}
                  </span>
                  <span
                    className="text-center tabular-nums text-[11px] font-bold"
                    style={{ color: row.permitDate ? "var(--cd-text)" : "var(--cd-faint)" }}
                  >
                    {row.permitDate ?? "-"}
                  </span>
                  <span
                    className="text-center tabular-nums text-[11px] font-bold"
                    style={{ color: row.invoiceDoneDate ? "var(--cd-text)" : "var(--cd-faint)" }}
                  >
                    {row.invoiceDoneDate ?? "-"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ---------------- (a) 연도별 완료 건수 추이 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-2">
            <span className="cd-title-icon">
              <TrendingUp className="w-4 h-4" />
            </span>
            연도별 완료 건수 추이
          </p>
          <p className="text-[10px] font-bold mb-4" style={{ color: "var(--cd-faint)" }}>
            계약일 기준 · 완료일(허가일) 혹은 완료일(발행일) 존재 건
          </p>
          <ApexChart
            key={`cmp-trend-${theme}-${category ?? "all"}`}
            options={trendOptions}
            series={trendSeries}
            type="line"
            height={310}
          />
        </div>

        {/* ---------------- (b) 해당연도 용역별 완료 비율 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-2">
            <span className="cd-title-icon">
              <BarChart3 className="w-4 h-4" />
            </span>
            {yearLabel} 용역별 완료 비율
          </p>
          <p className="text-[10px] font-bold mb-4" style={{ color: "var(--cd-faint)" }}>
            {isAllYears ? "전체 기간" : "해당 연도"} 용역별 계약 건수 대비
          </p>
          {ratioByCategory.length === 0 ? (
            <EmptyHint label="표시할 완료 데이터가 없습니다." height={310} />
          ) : (
            <ApexChart
              key={`cmp-ratiobar-${theme}-${year}`}
              options={ratioBarOptions}
              series={[{ name: "완료 비율", data: ratioByCategory.map((e) => e.ratio) }]}
              type="bar"
              height={310}
            />
          )}
        </div>

        {/* ---------------- (c) 7개년 평균 완료 소요기간 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-2">
            <span className="cd-title-icon">
              <Timer className="w-4 h-4" />
            </span>
            7개년도 평균 완료 소요기간
          </p>
          <p className="text-[10px] font-bold mb-4" style={{ color: "var(--cd-faint)" }}>
            계약일 → 완료일(허가일 우선, 없으면 발행일)까지의 평균 기간
          </p>
          {periodStats.every((e) => e.all === 0) ? (
            <EmptyHint label="표시할 완료 소요기간 데이터가 없습니다." height={310} />
          ) : (
            <ApexChart
              key={`cmp-period-${theme}-${category ?? "all"}`}
              options={periodOptions}
              series={periodSeries}
              type="bar"
              height={310}
            />
          )}
        </div>

        {/* ---------------- (d) 해당연도 세부분류별 완료 비율 (방사형) ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <p className="cd-card-title mb-2">
            <span className="cd-title-icon">
              <ListTree className="w-4 h-4" />
            </span>
            {yearLabel} 세부분류별 완료 비율
          </p>
          <p className="text-[10px] font-bold mb-4" style={{ color: "var(--cd-faint)" }}>
            선택 용역의 세분류별 계약 건수 대비
          </p>
          {!category ? (
            <EmptyHint label="용역 분류를 선택하면 세분류별 완료 비율이 표시됩니다." height={310} />
          ) : subtypeRatios.length === 0 ? (
            <EmptyHint label="해당 기간에 표시할 세분류 데이터가 없습니다." height={310} />
          ) : (
            <ApexChart
              key={`cmp-subtype-${theme}-${year}-${category}`}
              options={subtypeRadialOptions}
              series={[{ name: category ?? "완료 비율", data: subtypeRatios.map((e) => e.ratio) }]}
              type="radar"
              height={310}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type CompletionsYearAgg = {
  total: number;
  byCategory: Record<string, number>;
  bySubtype: Record<string, Record<string, number>>;
};

/** 전체 기간 선택 시 연도별 집계 맵을 하나로 합산 */
function aggregateAll(m: Map<string, CompletionsYearAgg>): CompletionsYearAgg {
  const agg: CompletionsYearAgg = { total: 0, byCategory: {}, bySubtype: {} };
  for (const e of m.values()) {
    agg.total += e.total;
    for (const [cat, v] of Object.entries(e.byCategory)) {
      agg.byCategory[cat] = (agg.byCategory[cat] ?? 0) + v;
    }
    for (const [cat, subs] of Object.entries(e.bySubtype)) {
      const subMap = agg.bySubtype[cat] ?? {};
      for (const [sub, v] of Object.entries(subs)) {
        subMap[sub] = (subMap[sub] ?? 0) + v;
      }
      agg.bySubtype[cat] = subMap;
    }
  }
  return agg;
}

/** 세분류 차트용: 기준색에서 점차 밝아지는 파생 색상 */
function subtypePalette(baseHex: string, index: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(baseHex.trim());
  if (!m) return baseHex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = Math.min(0.72, index * 0.16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
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
