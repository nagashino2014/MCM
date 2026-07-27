"use client";

// 결재 인사이트(AX-P1, admin) — KPI(진행/평균 소요/반려율/평균 체류) + 월별 추이(반려율·소요) + 병목(결재자·양식).
// 이 수치가 AX-P2(AI 요약)·AX-P3(사전검토) 도입 전후 ROI 비교 베이스라인이 된다.
// 설계: docs/e-approval-differentiation-blueprint.md §9-2.

import { useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { BarChart3, Clock, FileWarning, Timer, Hourglass } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette } from "@/components/contracts/dashboard/types";
import "@/components/cdash/cdash.css";

interface Insights {
  kpis: { inProgress: number; avgProcessingHours: number | null; rejectRatePct: number | null; avgDwellHours: number | null };
  monthly: { month: string; submitted: number; rejected: number; rejectRatePct: number; avgProcessingHours: number | null }[];
  approvers: { name: string; handled: number; avgDwellHours: number | null }[];
  forms: { formName: string; count: number; avgProcessingHours: number | null }[];
}

const fmtHours = (v: number | null) => (v == null ? "-" : v >= 24 ? `${(v / 24).toFixed(1)}일` : `${v.toFixed(1)}시간`);

export function ApprovalInsightsBoard() {
  const { theme } = useCdashTheme();
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/approval/insights", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.insights) setData(d.insights);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pal = chartPalette(theme);
  const months = data?.monthly.map((m) => m.month.slice(2)) ?? [];

  const rejectOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "line", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      stroke: { curve: "smooth", width: 3 },
      colors: [pal.accent],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 0 } },
      xaxis: { categories: months, labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { min: 0, labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => `${Math.round(v)}%` } },
      tooltip: { theme, y: { formatter: (v: number) => `${v}%` } },
      markers: { size: 0, hover: { size: 5 } },
    }),
    [theme, pal.accent, pal.grid, pal.muted, pal.faint, months]
  );

  const procOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 400 }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "48%", borderRadius: 5, borderRadiusApplication: "end" } },
      fill: { type: "gradient", gradient: { shade: theme === "dark" ? "dark" : "light", type: "vertical", shadeIntensity: 0.3, opacityFrom: 1, opacityTo: 0.75 } },
      colors: [pal.primary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 0 } },
      xaxis: { categories: months, labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => `${Math.round(v)}h` } },
      tooltip: { theme, y: { formatter: (v: number) => `${v}시간` } },
      states: { hover: { filter: { type: "lighten" } } },
    }),
    [theme, pal.primary, pal.grid, pal.muted, pal.faint, months]
  );

  const kpiCards = data
    ? [
        { icon: <Hourglass className="w-4 h-4" />, label: "진행 중 결재", value: `${data.kpis.inProgress}건`, hint: "현재 결재 진행 문서" },
        { icon: <Clock className="w-4 h-4" />, label: "평균 결재 소요", value: fmtHours(data.kpis.avgProcessingHours), hint: "최근 90일 완료 · 상신→완료" },
        { icon: <FileWarning className="w-4 h-4" />, label: "반려율", value: data.kpis.rejectRatePct == null ? "-" : `${data.kpis.rejectRatePct}%`, hint: "최근 90일 완료 문서 기준" },
        { icon: <Timer className="w-4 h-4" />, label: "평균 단계 체류", value: fmtHours(data.kpis.avgDwellHours), hint: "최근 90일 · 활성→처리" },
      ]
    : [];

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<BarChart3 className="w-5 h-5" />}
        eyebrow="Approval · Insights"
        title="결재 인사이트"
        subtitle="결재 소요시간·반려율·단계 체류를 집계해 병목을 진단합니다. AI 사전검토·요약 도입 효과의 비교 기준이 됩니다."
      />

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : !data ? (
        <p className="text-sm cd-text-faint">데이터를 불러오지 못했습니다.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpiCards.map((k) => (
              <div key={k.label} className="cd-card rounded-2xl p-4 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 cd-text-primary">
                  <span className="rounded-lg cd-tint-primary p-1.5">{k.icon}</span>
                  <span className="text-[11px] font-semibold cd-text-faint">{k.label}</span>
                </div>
                <div className="text-2xl font-bold cd-text mt-1">{k.value}</div>
                <div className="text-[10.5px] cd-text-faint">{k.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="cd-card rounded-2xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider cd-text-faint mb-1">월별 반려율</div>
              <div className="text-[10px] cd-text-faint mb-2">최근 12개월 · 상신 대비 반려</div>
              <ApexChart key="reject" options={rejectOptions} series={[{ name: "반려율", data: data.monthly.map((m) => m.rejectRatePct) }]} type="line" height={210} />
            </div>
            <div className="cd-card rounded-2xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider cd-text-faint mb-1">월별 평균 결재 소요</div>
              <div className="text-[10px] cd-text-faint mb-2">최근 12개월 · 상신→완료(시간)</div>
              <ApexChart key="proc" options={procOptions} series={[{ name: "평균 소요", data: data.monthly.map((m) => m.avgProcessingHours ?? 0) }]} type="bar" height={210} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="cd-card rounded-2xl p-5">
              <h3 className="font-bold cd-text text-sm mb-3">결재자별 평균 체류 (최근 90일)</h3>
              {data.approvers.length === 0 ? (
                <p className="text-[12px] cd-text-faint">데이터가 없습니다.</p>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left cd-text-faint text-[11px]">
                      <th className="py-1.5 pr-3 font-semibold">결재자</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">처리 건수</th>
                      <th className="py-1.5 font-semibold text-right">평균 체류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.approvers.map((a) => (
                      <tr key={a.name} className="border-t cd-border-c">
                        <td className="py-2 pr-3 cd-text">{a.name}</td>
                        <td className="py-2 pr-3 text-right cd-text-faint">{a.handled}</td>
                        <td className="py-2 text-right cd-text font-semibold">{fmtHours(a.avgDwellHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="cd-card rounded-2xl p-5">
              <h3 className="font-bold cd-text text-sm mb-3">양식별 건수·소요 (최근 90일)</h3>
              {data.forms.length === 0 ? (
                <p className="text-[12px] cd-text-faint">데이터가 없습니다.</p>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left cd-text-faint text-[11px]">
                      <th className="py-1.5 pr-3 font-semibold">양식</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">건수</th>
                      <th className="py-1.5 font-semibold text-right">평균 소요</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.forms.map((f) => (
                      <tr key={f.formName} className="border-t cd-border-c">
                        <td className="py-2 pr-3 cd-text">{f.formName}</td>
                        <td className="py-2 pr-3 text-right cd-text-faint">{f.count}</td>
                        <td className="py-2 text-right cd-text font-semibold">{fmtHours(f.avgProcessingHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
