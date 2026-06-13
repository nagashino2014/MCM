"use client";

import { SlidersHorizontal } from "lucide-react";
import { CardFrame } from "./CardFrame";
import { DASHBOARD_CATEGORIES } from "./types";

export function FilterCard({
  years,
  year,
  category,
  onYearChange,
  onCategoryChange,
}: {
  years: string[];
  year: string | null;
  category: string;
  onYearChange: (year: string) => void;
  onCategoryChange: (category: string) => void;
}) {
  return (
    <CardFrame
      area="cd-a-filter"
      icon={<SlidersHorizontal className="w-4 h-4" />}
      title="조건별 필터"
      delay={3}
    >
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-bold mb-1.5" style={{ color: "var(--cd-faint)" }}>
            용역분류
          </p>
          {/* 상호 배타적 단일 선택 (라디오 동작) */}
          <div className="flex flex-wrap gap-1.5">
            {DASHBOARD_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className="cd-chip cd-chip-sm"
                data-active={cat === category}
                onClick={() => onCategoryChange(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-bold mb-1.5" style={{ color: "var(--cd-faint)" }}>
            기준연도
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                className="cd-chip cd-chip-sm text-center"
                data-active={y === year}
                onClick={() => onYearChange(y)}
              >
                {y}년
              </button>
            ))}
            {years.length === 0 && (
              <span className="col-span-4 text-xs" style={{ color: "var(--cd-faint)" }}>
                연도 데이터 없음
              </span>
            )}
          </div>
        </div>
      </div>
    </CardFrame>
  );
}
