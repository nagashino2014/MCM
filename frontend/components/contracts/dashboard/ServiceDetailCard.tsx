"use client";

import { PieChart } from "lucide-react";
import { CardFrame, CardSkeleton } from "./CardFrame";
import { CATEGORY_META, fmtFull } from "./types";

const TABLE_ROWS = 5;

/**
 * 용역별 수주 상세 — 선택 분류 내 세부 용역유형별 건수·금액.
 * 좌측: 분류명 + 총 수주 건수(기준연도), 우측: 5행 고정 테이블 2개 (엑셀 원본 구조).
 */
export function ServiceDetailCard({
  year,
  category,
  totalCount,
  rows,
  loading,
}: {
  year: string | null;
  category: string | null;
  totalCount: number;
  rows: Array<{ label: string; count: number; amount: number }>;
  loading: boolean;
}) {
  const left = rows.slice(0, TABLE_ROWS);
  const right = rows.slice(TABLE_ROWS, TABLE_ROWS * 2);

  return (
    <CardFrame
      area="cd-a-svc"
      icon={<PieChart className="w-4 h-4" />}
      title="용역별 수주 상세"
      delay={2}
    >
      {loading ? (
        <CardSkeleton lines={5} />
      ) : (
        <div className="grid grid-cols-[104px_1fr_1fr] gap-3 flex-1 min-h-0">
          {/* 좌측 요약 — 표 열 레이블과 동일한 surface/muted 톤 */}
          <div className="flex flex-col gap-2">
            {/* 선택된 용역분류 강조 — 흰 배경 + 용역 아이콘 색 테두리 */}
            <div
              className="rounded-xl px-2 py-2 text-center text-[13px] font-extrabold"
              style={{
                background: "var(--cd-card)",
                color: "var(--cd-muted)",
                border: `2px solid ${(category && CATEGORY_META[category]?.color) || "var(--cd-border)"}`,
              }}
            >
              {category ?? "-"}
            </div>
            <div
              className="rounded-xl px-2 py-2.5 text-center flex-1 flex flex-col items-center justify-center gap-3"
              style={{ background: "var(--cd-surface)", color: "var(--cd-muted)" }}
            >
              <span className="text-[12px] font-extrabold leading-tight">
                총 수주 건수
                <br />
                <span className="text-[10px] font-bold opacity-90">({year}년)</span>
              </span>
              <span className="text-3xl font-extrabold tabular-nums" style={{ color: "#FFC000" }}>
                {totalCount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* 세부유형 테이블 ×2 (5행 고정, 좌측 우선 채움) */}
          <DetailTable rows={left} />
          <DetailTable rows={right} />
        </div>
      )}
    </CardFrame>
  );
}

function DetailTable({ rows }: { rows: Array<{ label: string; count: number; amount: number }> }) {
  const padded = [...rows];
  while (padded.length < TABLE_ROWS) padded.push({ label: "", count: 0, amount: 0 });

  return (
    <div className="min-w-0 flex flex-col text-[11px]">
      <div
        className="grid grid-cols-[1fr_36px_1fr] gap-x-1.5 px-2 py-1.5 rounded-lg font-bold"
        style={{ background: "var(--cd-surface)", color: "var(--cd-muted)" }}
      >
        <span>용역분류</span>
        <span className="text-right">건수</span>
        <span className="text-right">금액</span>
      </div>
      <div className="mt-1 flex flex-col">
        {padded.map((row, idx) => (
          <div
            key={row.label || `empty-${idx}`}
            className="cd-row-hover grid grid-cols-[1fr_36px_1fr] gap-x-1.5 items-center px-2 py-1 rounded-lg"
          >
            <span className="font-bold truncate" style={{ color: "var(--cd-text)" }} title={row.label}>
              {row.label || "-"}
            </span>
            <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-muted)" }}>
              {row.label ? row.count.toLocaleString() : "-"}
            </span>
            <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
              {row.label ? fmtFull(row.amount) : "-"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
