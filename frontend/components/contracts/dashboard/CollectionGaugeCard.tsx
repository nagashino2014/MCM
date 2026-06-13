"use client";

import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import { Gauge } from "lucide-react";
import ApexChart from "./ApexChart";
import { CardFrame, CardSkeleton } from "./CardFrame";
import { CATEGORY_META, chartPalette, fmtFull, type CdTheme, type DashboardData } from "./types";

/**
 * 용역 수금 현황 — 좌측 레이블/금액 분리 태그 + radialBar 게이지 2개(선택 분류 / 전체).
 * 수금액 = 기준연도 계약의 수금 완료액, 게이지 = 수금액 / 기준연도 수주액 (엑셀 산식).
 * 수금액 태그 = 필터 활성 버튼색, D-1 태그 = 그보다 연한 색.
 */
export function CollectionGaugeCard({
  theme,
  year,
  category,
  collection,
  loading,
}: {
  theme: CdTheme;
  year: string | null;
  category: string | null;
  collection: DashboardData["collection"] | null;
  loading: boolean;
}) {
  const short = (category && CATEGORY_META[category]?.short) || "분류";

  return (
    <CardFrame area="cd-a-gauge" icon={<Gauge className="w-4 h-4" />} title="용역 수금 현황" delay={3}>
      {loading || !collection ? (
        <CardSkeleton lines={4} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(220px,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center flex-1 min-w-0">
          {/* 레이블/금액 분리 태그 */}
          <div className="text-[11px] flex flex-col gap-1">
            <AmountRow label="수금액(총액)" value={collection.collectedTotal} />
            <AmountRow label={`수금액(${short})`} value={collection.collectedCategory} />
            <AmountRow label="D-1 Year(총액)" value={collection.prevCollectedTotal} />
            <AmountRow label={`D-1 Year(${short})`} value={collection.prevCollectedCategory} />
            <p className="mt-0.5 px-1 text-[10px]" style={{ color: "var(--cd-faint)" }}>
              {year}년 계약 기준 수금 완료액
            </p>
          </div>
          <GaugeChart theme={theme} label={`용역 수금율(${short})`} value={collection.rateCategory} tone="success" />
          <GaugeChart theme={theme} label="용역 수금율(전체)" value={collection.rateTotal} tone="accent" />
        </div>
      )}
    </CardFrame>
  );
}

function AmountRow({ label, value }: { label: string; value: number }) {
  // 조건별 필터 비활성 칩과 동일한 톤 (surface 배경 + muted 폰트 + 보더)
  const tagStyle = {
    background: "var(--cd-surface)",
    color: "var(--cd-muted)",
    border: "1px solid var(--cd-border)",
  } as const;
  return (
    <div className="grid grid-cols-[118px_1fr] gap-1.5 items-stretch">
      <span className="flex items-center px-2.5 py-1 rounded-lg font-bold whitespace-nowrap" style={tagStyle}>
        {label}
      </span>
      <span
        className="flex items-center justify-end px-2.5 py-1 rounded-lg tabular-nums font-extrabold whitespace-nowrap"
        style={tagStyle}
      >
        {fmtFull(value)}
      </span>
    </div>
  );
}

function GaugeChart({
  theme,
  label,
  value,
  tone,
}: {
  theme: CdTheme;
  label: string;
  value: number;
  tone: "success" | "accent";
}) {
  const pal = chartPalette(theme);
  const color = tone === "success" ? pal.success : pal.accent;
  const clamped = Math.max(0, Math.min(100, value));

  const options = useMemo<ApexOptions>(
    () => ({
      chart: { type: "radialBar", fontFamily: "inherit", parentHeightOffset: 0, sparkline: { enabled: true } },
      plotOptions: {
        radialBar: {
          startAngle: -110,
          endAngle: 110,
          hollow: { size: "58%" },
          track: { background: theme === "dark" ? "#232c39" : "#ebf1f6", strokeWidth: "100%" },
          dataLabels: {
            name: { show: false },
            value: {
              offsetY: 4,
              fontSize: "20px",
              fontWeight: 800,
              color: pal.text,
              formatter: (v: number) => `${Math.round(v * 10) / 10}%`,
            },
          },
        },
      },
      fill: {
        type: "gradient",
        gradient: {
          shade: theme === "dark" ? "dark" : "light",
          type: "horizontal",
          gradientToColors: [color],
          stops: [0, 100],
          opacityFrom: 0.65,
          opacityTo: 1,
        },
      },
      colors: [color],
      stroke: { lineCap: "round" },
    }),
    [theme, color, pal.text]
  );

  return (
    // 고정 폭 차트로 셀 밖 오버플로우 방지
    <div className="flex flex-col items-center min-w-0 overflow-hidden">
      <ApexChart options={options} series={[clamped]} type="radialBar" height={148} width={162} />
      <span className="text-[11px] font-bold -mt-2 whitespace-nowrap" style={{ color: "var(--cd-muted)" }}>
        {label}
      </span>
    </div>
  );
}
