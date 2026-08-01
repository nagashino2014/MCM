"use client";

// 데이터 분석 보드(/approval/analytics) — SW-P3. 일반 사용자용 지표 조회(공개범위 필터는 서버).
// 지표 선택 → 실행 → 차트(그룹 bar / 시간축 line) + 표 + CSV + 산출 근거(진단 메타).
// 관리 권한자는 "새 지표 만들기" 마법사(MetricWizard)로 노코드 지표를 추가한다.
// 설계: docs/semantic-analytics-wizard-blueprint.md §5(마법사)·§4-3(산출물 게시).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { BarChart3, Download, Play, Plus } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette } from "@/components/contracts/dashboard/types";
import { MetricWizard } from "@/components/approval/MetricWizard";
import { formatMetricValue, type MetricItem, type MetricResult } from "@/lib/analytics/metric-types";
import "@/components/cdash/cdash.css";

const KIND_LABEL: Record<string, string> = { aggregate: "집계", composite: "복합" };
const EXCLUDE_LABEL: Record<string, string> = {
  noGroupKey: "참조 미입력",
  manualRef: "직접 입력(마스터 미연결)",
  emptyValue: "값 비어 있음",
  emptyDoc: "문서 값 없음",
  formWithoutRefField: "양식에 참조 필드 없음",
};

export function ApprovalAnalyticsBoard() {
  const { theme } = useCdashTheme();
  const [metrics, setMetrics] = useState<MetricItem[]>([]);
  const [manager, setManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [result, setResult] = useState<MetricResult | null>(null);
  const [running, setRunning] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approval/analytics", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "지표 목록을 불러오지 못했습니다.");
      setMetrics(body.metrics ?? []);
      setManager(body.manager === true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(async (key: string) => {
    setSelectedKey(key);
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/approval/analytics?run=${encodeURIComponent(key)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "실행 실패");
      setResult(body.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, []);

  const pal = chartPalette(theme);

  /** 차트 데이터 — 시간축이 있으면 기간별 시리즈(상위 6그룹), 없으면 그룹 bar(상위 15) */
  const chart = useMemo(() => {
    if (!result || result.rows.length === 0) return null;
    const fmt = (v: number) => formatMetricValue(v, result.format);
    if (!result.hasTime) {
      const rows = result.rows.filter((r) => r.value != null).slice(0, 15);
      const options: ApexOptions = {
        chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 400 }, parentHeightOffset: 0 },
        plotOptions: { bar: { horizontal: true, barHeight: "62%", borderRadius: 4, borderRadiusApplication: "end" } },
        colors: [pal.primary],
        dataLabels: { enabled: false },
        grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 8 } },
        xaxis: { categories: rows.map((r) => (r.groupLabel.length > 22 ? r.groupLabel.slice(0, 22) + "…" : r.groupLabel)), labels: { style: { colors: pal.faint, fontSize: "10px" } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } } },
        tooltip: { theme, y: { formatter: fmt } },
      };
      return { options, series: [{ name: result.label, data: rows.map((r) => r.value as number) }], height: Math.max(180, rows.length * 30 + 60) };
    }
    // 시간축: 기간 × 그룹(상위 6) 라인
    const times = [...new Set(result.rows.map((r) => r.time).filter(Boolean))].sort() as string[];
    const totals = new Map<string, { label: string; sum: number }>();
    for (const r of result.rows) {
      const k = r.groupId ?? r.groupLabel;
      const e = totals.get(k) ?? { label: r.groupLabel, sum: 0 };
      e.sum += r.value ?? 0;
      totals.set(k, e);
    }
    const topGroups = [...totals.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 6);
    const series = topGroups.map(([gid, g]) => ({
      name: g.label.length > 16 ? g.label.slice(0, 16) + "…" : g.label,
      data: times.map((t) => {
        const hit = result.rows.find((r) => (r.groupId ?? r.groupLabel) === gid && r.time === t);
        return hit?.value ?? 0;
      }),
    }));
    const options: ApexOptions = {
      chart: { type: "line", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      stroke: { curve: "smooth", width: 2.5 },
      colors: [pal.primary, pal.accent, "#49BEFF", "#FFAE1F", "#FA896B", "#13DEB9"],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 8 } },
      xaxis: { categories: times, labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => (result.format === "percent" ? `${Math.round(v * 100)}%` : v >= 10000 ? `${Math.round(v / 10000)}만` : String(Math.round(v))) } },
      legend: { labels: { colors: pal.muted }, fontSize: "11px" },
      tooltip: { theme, y: { formatter: fmt } },
      markers: { size: 0, hover: { size: 5 } },
    };
    return { options, series, height: 280 };
  }, [result, theme, pal]);

  const exportCsv = () => {
    if (!result) return;
    const head = ["구분", ...(result.hasTime ? ["기간"] : []), "값"];
    const lines = [head.join(",")];
    for (const r of result.rows) {
      const cells = [
        `"${r.groupLabel.replace(/"/g, '""')}"`,
        ...(result.hasTime ? [r.time ?? ""] : []),
        r.value == null ? "" : result.format === "percent" ? (r.value * 100).toFixed(2) : String(r.value),
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.metricKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="데이터 분석"
        meta={`${metrics.length}개 지표 · 모든 결과에 산출 근거(대상·제외 사유)가 표시됩니다`}
        actions={
          manager ? (
            <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5" onClick={() => setWizardOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> 새 지표 만들기
            </button>
          ) : undefined
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}
      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-4 overflow-y-auto xl:overflow-visible">
          {/* 좌: 지표 목록 */}
          <div className="flex flex-col gap-2 min-w-0 xl:overflow-y-auto">
            {metrics.map((m) => (
              <button
                key={m.metricKey}
                type="button"
                onClick={() => run(m.metricKey)}
                className={`rounded-2xl border px-3.5 py-3 text-left ${selectedKey === m.metricKey ? "cd-glass-active" : "cd-border-c cd-row-hover"}`}
                style={{ background: selectedKey === m.metricKey ? undefined : "var(--cd-card-solid)" }}
              >
                <span className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                  <span className="text-[13px] font-bold cd-text truncate">{m.label}</span>
                  <span className="ml-auto text-[10px] rounded-md border cd-border-c px-1.5 py-0.5 cd-text-faint shrink-0">{KIND_LABEL[m.definition.kind]}</span>
                </span>
                {m.description && <span className="block text-[10.5px] cd-text-faint mt-1 leading-relaxed">{m.description}</span>}
              </button>
            ))}
            {metrics.length === 0 && <p className="text-[12px] cd-text-faint py-6 text-center">조회 가능한 지표가 없습니다.</p>}
          </div>

          {/* 우: 결과 */}
          <div className="flex flex-col gap-4 min-w-0 xl:overflow-y-auto">
            {running && <p className="text-[12px] cd-text-faint">계산 중...</p>}
            {!running && !result && (
              <div className="cd-card p-6">
                <p className="text-[12.5px] cd-text-faint text-center py-10">
                  <Play className="w-5 h-5 inline mr-1.5 opacity-60" />
                  왼쪽에서 지표를 선택하면 실데이터로 계산해 차트와 표로 보여줍니다.
                </p>
              </div>
            )}
            {result && (
              <div className="cd-card p-5 gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold cd-text text-[13.5px]">{result.label}</h3>
                  <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1" onClick={exportCsv}>
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                </div>
                <div className="rounded-xl border border-dashed cd-border-c px-3 py-2 text-[11px] cd-text-faint leading-relaxed">
                  소스 {result.diagnostics.sources.join(", ")}
                  {result.diagnostics.totalDocs != null && <> · 대상 문서 {result.diagnostics.totalDocs}건</>} · 사용 {result.diagnostics.usedRows}행
                  {Object.entries(result.diagnostics.excluded).length > 0 && (
                    <> · 제외: {Object.entries(result.diagnostics.excluded).map(([k, v]) => `${EXCLUDE_LABEL[k.split(".").pop() ?? k] ?? k} ${v}건`).join(", ")}</>
                  )}
                  {result.diagnostics.notes.map((n, i) => (
                    <span key={i} className="block">{n}</span>
                  ))}
                </div>
                {chart && <ApexChart type={result.hasTime ? "line" : "bar"} options={chart.options} series={chart.series} height={chart.height} />}
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left cd-text-faint text-[11px]">
                        <th className="py-1.5 pr-2 font-semibold">구분</th>
                        {result.hasTime && <th className="py-1.5 pr-2 font-semibold">기간</th>}
                        <th className="py-1.5 font-semibold text-right">값</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i} className="border-t cd-border-c">
                          <td className="py-1.5 pr-2 cd-text">{r.groupLabel}</td>
                          {result.hasTime && <td className="py-1.5 pr-2 cd-text-faint">{r.time ?? "-"}</td>}
                          <td className="py-1.5 text-right font-bold cd-text">{formatMetricValue(r.value, result.format)}</td>
                        </tr>
                      ))}
                      {result.rows.length === 0 && (
                        <tr>
                          <td colSpan={result.hasTime ? 3 : 2} className="py-6 text-center text-[12px] cd-text-faint">
                            결과가 없습니다 — 위 산출 근거의 제외 사유를 확인하세요.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {wizardOpen && (
        <MetricWizard
          theme={theme}
          metrics={metrics}
          onClose={() => setWizardOpen(false)}
          onSaved={(key) => {
            setWizardOpen(false);
            load().then(() => run(key));
          }}
        />
      )}
    </div>
  );
}
