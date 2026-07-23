"use client";

// 직원별 휴가 관리 인포그래픽(LM-P4) — 월별 연차 사용 막대 / 월별 소진율 물결선 / 연도별 연차 외 막대.
// ApexChart 래퍼(dynamic ssr:false)와 chartPalette(theme) 재사용. 연도 변경 시 key 리마운트,
// 라인/area 는 animations 비활성(ApexCharts 리마운트 크래시 회피).

import { useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette, type CdTheme } from "@/components/contracts/dashboard/types";

interface Charts {
  year: string;
  monthlyUsed: number[];
  monthlyRate: number[];
  yearlyOther: { year: string; days: number }[];
}

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

export function LeaveCharts({ year, theme }: { year: string; theme: CdTheme }) {
  const [data, setData] = useState<Charts | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/approval/leave/charts?year=${year}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.charts) setData(d.charts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [year]);

  const pal = chartPalette(theme);

  const barOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 400 }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "48%", borderRadius: 5, borderRadiusApplication: "end" } },
      fill: { type: "gradient", gradient: { shade: theme === "dark" ? "dark" : "light", type: "vertical", shadeIntensity: 0.3, opacityFrom: 1, opacityTo: 0.75 } },
      colors: [pal.primary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 0 } },
      xaxis: { categories: MONTHS, labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => `${Math.round(v)}` } },
      tooltip: { theme, y: { formatter: (v: number) => `${v}일` } },
      states: { hover: { filter: { type: "lighten" } } },
    }),
    [theme, pal.primary, pal.grid, pal.muted, pal.faint]
  );

  const rateOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "area", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      stroke: { curve: "smooth", width: 3 },
      colors: [pal.accent],
      fill: { type: "gradient", gradient: { shadeIntensity: 0.4, opacityFrom: 0.32, opacityTo: 0.02, stops: [0, 100] } },
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 0 } },
      xaxis: { categories: MONTHS, labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { min: 0, labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => `${Math.round(v)}%` } },
      tooltip: { theme, y: { formatter: (v: number) => `${v}%` } },
      markers: { size: 0, hover: { size: 5 } },
    }),
    [theme, pal.accent, pal.grid, pal.muted, pal.faint]
  );

  const otherOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 400 }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "42%", borderRadius: 5, borderRadiusApplication: "end", distributed: false } },
      fill: { type: "gradient", gradient: { shade: theme === "dark" ? "dark" : "light", type: "vertical", shadeIntensity: 0.3, opacityFrom: 1, opacityTo: 0.75 } },
      colors: [pal.success],
      dataLabels: { enabled: true, style: { fontSize: "10px", colors: [pal.text] }, formatter: (v: number) => `${v}` },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: { categories: (data?.yearlyOther ?? []).map((y) => `${y.year}년`), labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => `${Math.round(v)}` } },
      tooltip: { theme, y: { formatter: (v: number) => `${v}일` } },
      states: { hover: { filter: { type: "lighten" } } },
    }),
    [theme, pal.success, pal.grid, pal.muted, pal.faint, pal.text, data?.yearlyOther]
  );

  if (!data) {
    return <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="cd-card rounded-2xl p-4 h-[240px]" />)}</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div className="cd-card rounded-2xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider cd-text-faint mb-1">월별 연차 사용일수</div>
        <div className="text-[10px] cd-text-faint mb-2">{data.year}년 · 전사 합계</div>
        <ApexChart key={`bar-${data.year}`} options={barOptions} series={[{ name: "연차 사용", data: data.monthlyUsed }]} type="bar" height={200} />
      </div>
      <div className="cd-card rounded-2xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider cd-text-faint mb-1">월별 연차 소진율</div>
        <div className="text-[10px] cd-text-faint mb-2">{data.year}년 · 누적 사용 ÷ 부여</div>
        <ApexChart key={`rate-${data.year}`} options={rateOptions} series={[{ name: "소진율", data: data.monthlyRate }]} type="area" height={200} />
      </div>
      <div className="cd-card rounded-2xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider cd-text-faint mb-1">연도별 연차 외 휴가</div>
        <div className="text-[10px] cd-text-faint mb-2">경조·공가·병가 사용일수</div>
        {data.yearlyOther.length > 0 ? (
          <ApexChart key={`other-${data.yearlyOther.length}`} options={otherOptions} series={[{ name: "연차 외", data: data.yearlyOther.map((y) => y.days) }]} type="bar" height={200} />
        ) : (
          <p className="text-[11.5px] cd-text-faint py-16 text-center">데이터가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
