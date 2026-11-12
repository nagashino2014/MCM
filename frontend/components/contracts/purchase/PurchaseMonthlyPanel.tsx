"use client";

import { useMemo, type ReactNode } from "react";
import type { ApexOptions } from "apexcharts";
import { FileText } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette, fmtCompact, fmtFull, type CdTheme } from "@/components/contracts/dashboard/types";
import { AmountInput, formatAmount } from "@/components/ui/AmountInput";
import type { PurchaseMonthlyKind } from "@/lib/contracts/purchase/options";
import type { PurchaseMonthlyEntry } from "@/lib/contracts/purchase/types";

/**
 * 월별 금액 패널(333, 2026-11-03 사용자 요청) — 추가 지출(정기 구독)·종량제 요금 추이(복합기·비데·정수기 렌트)·납부 현황(관리 계약)
 * 세 탭이 같은 틀을 쓴다. 우상단 연도 select → 월별 칸(추가 지출은 2열: 1·2월 / 3·4월 …, 나머지는 6열 × 2행) →
 * 좌하단 버튼 슬롯(분개장 이동·명세서 업로드) + 우하단 연도 총액 → 연도별 추이 막대.
 * 값은 부모가 들고 있다(신규 모달은 draft, 상세 화면은 서버 값 자동 저장).
 */
export const PURCHASE_MONTHLY_LABELS: Record<PurchaseMonthlyKind, { title: string; amount: string; total: string; chart: string }> = {
  extra_spend: { title: "추가 지출", amount: "추가 지출액", total: "총 추가 지출액", chart: "연도별 추가 지출액 추이" },
  metered: { title: "종량제 요금 추이", amount: "청구 금액", total: "청구 금액 총액", chart: "연도별 청구금액 추이" },
  management_fee: { title: "납부 현황", amount: "관리비 청구액", total: "관리비 청구 금액 총액", chart: "연도별 청구 관리비 추이" },
};

export function emptyMonthlyEntries(): PurchaseMonthlyEntry[] {
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: null, purpose: "", detail: {}, documentId: null, documentPath: null, documentName: null }));
}

export function PurchaseMonthlyPanel({
  kind,
  year,
  years,
  onYearChange,
  months,
  yearlyTotals,
  onChangeMonth,
  readOnly,
  theme,
  footerLeft,
  onOpenDocument,
  status,
}: {
  kind: PurchaseMonthlyKind;
  year: number;
  /** 연도 select 후보(월별 금액이 있는 연도 + 올해 ± 1). */
  years: number[];
  onYearChange: (year: number) => void;
  months: PurchaseMonthlyEntry[];
  yearlyTotals: Array<{ year: number; total: number }>;
  onChangeMonth: (month: number, patch: { amount?: string; purpose?: string }) => void;
  readOnly?: boolean;
  theme: CdTheme;
  footerLeft?: ReactNode;
  /** 관리비 — 달 칸의 명세서 아이콘 클릭. */
  onOpenDocument?: (entry: PurchaseMonthlyEntry) => void;
  /** "저장 중…" 같은 상태 문구. */
  status?: ReactNode;
}) {
  const labels = PURCHASE_MONTHLY_LABELS[kind];
  const yearTotal = useMemo(() => months.reduce((acc, m) => acc + (m.amount ?? 0), 0), [months]);
  const twoCol = kind === "extra_spend";
  const yearOptions = useMemo(() => {
    const set = new Set<number>(years);
    const now = new Date().getFullYear();
    set.add(now);
    set.add(now - 1);
    set.add(now + 1);
    set.add(year);
    return [...set].sort((a, b) => b - a);
  }, [years, year]);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs cd-text-muted">
          {kind === "extra_spend" && "월별 추가 지출액과 지출 목적(예: LLM 분석량 증가)을 적습니다."}
          {kind === "metered" && "월별 종량제 청구 금액을 적습니다. 청구 자료는 분개장에서 맞춰 봅니다."}
          {kind === "management_fee" && "월별 관리비 청구액입니다. 관리비 명세서 PDF 를 올리면 항목별로 읽어 채웁니다."}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs cd-text-muted shrink-0">
          <span className="cd-label-text">연도</span>
          <select className="cd-select text-xs" style={{ width: "10ch" }} value={year} onChange={(e) => onYearChange(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </label>
      </div>

      <div className={twoCol ? "grid grid-cols-2 gap-2" : "grid grid-cols-6 gap-2"}>
        {months.map((m) => (
          <div key={m.month} className={"rounded-lg border cd-border-c cd-surface-bg p-2 grid gap-1 " + (twoCol ? "grid-cols-[44px_140px_1fr] items-center" : "")}>
            <div className="text-[11px] font-semibold cd-text-muted flex items-center gap-1">
              {m.month}월
              {kind === "management_fee" && m.documentId && (
                <button
                  type="button"
                  className="cd-text-primary hover:opacity-70"
                  title={m.documentName ?? "관리비 명세서 보기"}
                  onClick={() => onOpenDocument?.(m)}
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {readOnly ? (
              <div className="cd-input tabular-nums text-right text-xs flex items-center justify-end min-h-[34px]">{m.amount != null ? formatAmount(m.amount) : "-"}</div>
            ) : (
              <AmountInput
                className="cd-input tabular-nums text-right text-xs"
                value={m.amount != null ? String(m.amount) : ""}
                onChange={(amount) => onChangeMonth(m.month, { amount })}
                placeholder={labels.amount}
                aria-label={`${m.month}월 ${labels.amount}`}
              />
            )}
            {twoCol &&
              (readOnly ? (
                <div className="text-xs cd-text truncate px-1" title={m.purpose}>{m.purpose || <span className="cd-text-faint">-</span>}</div>
              ) : (
                <input
                  className="cd-input text-xs"
                  value={m.purpose}
                  onChange={(e) => onChangeMonth(m.month, { purpose: e.target.value })}
                  placeholder="지출 목적 (예: LLM 분석량 증가)"
                  aria-label={`${m.month}월 지출 목적`}
                />
              ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">{footerLeft}{status && <span className="text-[11px] cd-text-faint">{status}</span>}</div>
        <div className="rounded-lg border cd-border-c px-3 py-2 text-right">
          <p className="text-[11px] cd-text-faint">{year}년 {labels.total}</p>
          <p className="text-sm font-semibold cd-text tabular-nums">{formatAmount(yearTotal) || "0"}원</p>
        </div>
      </div>

      <YearlyTrendChart title={labels.chart} totals={mergeCurrentYear(yearlyTotals, year, yearTotal)} theme={theme} />
    </div>
  );
}

/** 화면에서 편집 중인 올해 합계를 연도별 합계에 반영한다(저장 전에도 그래프가 따라오게). */
function mergeCurrentYear(totals: Array<{ year: number; total: number }>, year: number, yearTotal: number) {
  const map = new Map(totals.map((t) => [t.year, t.total]));
  map.set(year, yearTotal);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([y, total]) => ({ year: y, total }));
}

function YearlyTrendChart({ title, totals, theme }: { title: string; totals: Array<{ year: number; total: number }>; theme: CdTheme }) {
  const pal = chartPalette(theme);
  const options = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "40%", borderRadius: 4, borderRadiusApplication: "end" } },
      colors: [pal.primary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 0 } },
      xaxis: {
        categories: totals.map((t) => `${t.year}년`),
        labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { labels: { style: { colors: pal.faint, fontSize: "10px" }, formatter: (v: number) => fmtCompact(v) } },
      tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => fmtFull(v) } },
    }),
    [theme, pal.primary, pal.grid, pal.muted, pal.faint, totals]
  );
  const series = useMemo(() => [{ name: title, data: totals.map((t) => t.total) }], [title, totals]);
  return (
    <div className="rounded-lg border cd-border-c p-3">
      <p className="text-[11px] font-semibold cd-text-faint">{title}</p>
      {totals.length === 0 ? (
        <p className="text-xs cd-text-faint py-6 text-center">아직 금액이 없습니다.</p>
      ) : (
        // 연도 목록·테마가 바뀌면 리마운트(ApexCharts 축 눈금 잔상 방지)
        <ApexChart key={`${theme}-${totals.map((t) => t.year).join(",")}`} options={options} series={series} type="bar" height={160} />
      )}
    </div>
  );
}
