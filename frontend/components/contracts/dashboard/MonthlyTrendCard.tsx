"use client";

import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { ReactNode } from "react";
import ApexChart from "./ApexChart";
import { CardFrame, CardSkeleton, ServiceIcon } from "./CardFrame";
import { CATEGORY_META, chartPalette, fmtCompact, fmtFull, pctDiff, type CdTheme, type MonthlyBlock } from "./types";

const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

/**
 * 매출 현황 / 수주 현황 공용 카드.
 * 상단: 월별 막대 차트, 하단: 용역분류별 D-2/D-1 비교 + 점유율 테이블.
 */
export function MonthlyTrendCard({
  area,
  icon,
  title,
  totalLabel,
  variant,
  theme,
  year,
  block,
  loading,
  delay,
}: {
  area: string;
  icon: ReactNode;
  title: string;
  /** 좌측 헤더 셀 라벨: "매출현황" | "수주총액" */
  totalLabel: string;
  variant: "blue" | "orange";
  theme: CdTheme;
  year: string | null;
  block: MonthlyBlock | null;
  loading: boolean;
  delay?: 1 | 2 | 3 | 4 | 5;
}) {
  const pal = chartPalette(theme);
  const barColor = variant === "blue" ? pal.primary : pal.accent;
  const totalColor = variant === "blue" ? "var(--cd-primary-strong)" : "var(--cd-accent-strong)";

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: "inherit",
        animations: { speed: 450 },
        parentHeightOffset: 0,
      },
      plotOptions: {
        bar: { columnWidth: "46%", borderRadius: 5, borderRadiusApplication: "end" },
      },
      fill: {
        type: "gradient",
        gradient: {
          shade: theme === "dark" ? "dark" : "light",
          type: "vertical",
          shadeIntensity: 0.3,
          opacityFrom: 1,
          opacityTo: 0.75,
        },
      },
      colors: [barColor],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 6, right: 0 } },
      xaxis: {
        categories: MONTH_LABELS,
        labels: { style: { colors: pal.muted, fontSize: "11px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: pal.faint, fontSize: "10px" },
          formatter: (v: number) => fmtCompact(v),
        },
      },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: { formatter: (v: number) => fmtFull(v) },
      },
      states: { hover: { filter: { type: "lighten" } } },
    }),
    [theme, barColor, pal.grid, pal.muted, pal.faint]
  );

  const series = useMemo(
    () => [{ name: title, data: block?.monthly ?? new Array(12).fill(0) }],
    [title, block]
  );

  return (
    <CardFrame area={area} icon={icon} title={title} delay={delay}>
      {loading || !block ? (
        <CardSkeleton lines={6} />
      ) : (
        <>
          <div className="-mx-1">
            {/* key 로 연도 변경 시 차트를 리마운트 — updateSeries 만으로는 y축 눈금
                레이블이 이전 연도 스케일로 남는 ApexCharts 버그가 있다 */}
            <ApexChart key={`${variant}-${year}`} options={options} series={series} type="bar" height={190} />
          </div>

          {/* 비교 테이블 */}
          <div className="mt-3 text-[11px] leading-tight">
            <div
              className="grid grid-cols-[minmax(76px,0.9fr)_1fr_1.15fr_1.15fr_46px] gap-x-2 items-center px-2 py-2 rounded-lg font-bold"
              style={{ background: "var(--cd-surface)", color: "var(--cd-muted)" }}
            >
              <span>{year}년 {totalLabel}</span>
              <span className="text-right font-extrabold" style={{ color: totalColor }}>
                {fmtFull(block.total)}
              </span>
              <span className="text-right">D-2 Year</span>
              <span className="text-right">D-1 Year</span>
              <span className="text-right">점유율</span>
            </div>
            <div className="mt-1 flex flex-col">
              {block.byCategory.map((row) => (
                <div
                  key={row.category}
                  className="cd-row-hover grid grid-cols-[minmax(76px,0.9fr)_1fr_1.15fr_1.15fr_46px] gap-x-2 items-center px-2 py-1.5 rounded-lg"
                >
                  <span className="font-bold truncate inline-flex items-center gap-1.5" style={{ color: "var(--cd-muted)" }}>
                    {CATEGORY_META[row.category] && (
                      <ServiceIcon
                        color={CATEGORY_META[row.category].color}
                        iconSrc={CATEGORY_META[row.category].iconSrc}
                        size={13}
                      />
                    )}
                    {row.category}
                  </span>
                  <span className="text-right font-bold tabular-nums" style={{ color: "var(--cd-text)" }}>
                    {fmtFull(row.current)}
                  </span>
                  <CompareCell current={row.current} base={row.d2} />
                  <CompareCell current={row.current} base={row.d1} />
                  <span className="text-right font-extrabold tabular-nums" style={{ color: barColor }}>
                    {row.share > 0 ? `${Math.round(row.share)}%` : "-"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </CardFrame>
  );
}

function CompareCell({ current, base }: { current: number; base: number }) {
  const pct = pctDiff(current, base);
  return (
    // 금액 / 증감율을 별도 칼럼으로 분리 — -100% 같이 넓은 비율에도 정렬이 유지된다.
    <span
      className="grid grid-cols-[1fr_44px] gap-x-1.5 items-center tabular-nums"
      style={{ color: "var(--cd-faint)" }}
    >
      <span className="text-right">{fmtFull(base)}</span>
      <span
        className="text-right font-extrabold"
        style={{ color: pct == null ? undefined : pct < 0 ? "var(--cd-error)" : "var(--cd-success)" }}
      >
        {pct != null ? `${pct > 0 ? "+" : ""}${pct}%` : ""}
      </span>
    </span>
  );
}
