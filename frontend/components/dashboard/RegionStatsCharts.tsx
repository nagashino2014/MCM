"use client";

import { useMemo } from "react";
import { arc as d3arc, pie as d3pie } from "d3-shape";

export interface Slice {
  label: string;
  count: number;
}

export const AIR_PALETTE = [
  "rgba(91, 155, 213, 0.95)",
  "rgba(91, 155, 213, 0.78)",
  "rgba(91, 155, 213, 0.58)",
  "rgba(91, 155, 213, 0.4)",
  "rgba(91, 155, 213, 0.24)",
  "rgba(120, 113, 108, 0.45)",
];

export const WATER_PALETTE = [
  "rgba(112, 173, 71, 0.95)",
  "rgba(112, 173, 71, 0.78)",
  "rgba(112, 173, 71, 0.58)",
  "rgba(112, 173, 71, 0.4)",
  "rgba(112, 173, 71, 0.24)",
  "rgba(120, 113, 108, 0.45)",
];

export const SERVICE_PALETTE = ["#F4B084", "#FFD966", "#A9D08E", "#9BC2E6", "#BFBFBF"];

export const SIZE_PALETTE = [
  "rgba(68, 114, 196, 0.78)",
  "rgba(112, 173, 71, 0.78)",
  "rgba(165, 165, 165, 0.78)",
  "rgba(237, 125, 49, 0.78)",
  "rgba(255, 192, 0, 0.72)",
  "rgba(91, 155, 213, 0.62)",
];

export function bucketsToSlices(
  buckets: { class: number; count: number }[],
  unitLabel: string
): Slice[] {
  return buckets.map((b) => ({
    label: b.class === 0 ? "미상" : `${b.class}${unitLabel}`,
    count: b.count,
  }));
}

export function dummyServiceMix(total: number, seed: number): Slice[] {
  const labels = ["통합허가", "화관법", "HAPs", "ESG", "기타"];
  if (total <= 0) return labels.map((l) => ({ label: l, count: 0 }));
  const base = [0.48, 0.22, 0.14, 0.1, 0.06];
  let rem = total;
  const out: Slice[] = [];
  for (let i = 0; i < labels.length; i++) {
    const wob = ((seed * (i + 13)) % 17) / 100 - 0.08;
    const r = Math.max(0.03, base[i] + wob);
    const c = i === labels.length - 1 ? rem : Math.min(rem, Math.max(0, Math.round(total * r)));
    out.push({ label: labels[i], count: c });
    rem -= c;
  }
  return out;
}

export function dummySizeMix(total: number, seed: number): Slice[] {
  const labels = ["국가기관", "지자체", "공기업", "대기업", "중견기업", "중소기업"];
  if (total <= 0) return labels.map((l) => ({ label: l, count: 0 }));
  const base = [0.04, 0.08, 0.1, 0.12, 0.24, 0.42];
  let rem = total;
  const out: Slice[] = [];
  for (let i = 0; i < labels.length; i++) {
    const wob = ((seed * (i + 23)) % 19) / 100 - 0.09;
    const r = Math.max(0.05, base[i] + wob);
    const c = i === labels.length - 1 ? rem : Math.min(rem, Math.max(0, Math.round(total * r)));
    out.push({ label: labels[i], count: c });
    rem -= c;
  }
  return out;
}

export function PieCard({
  title,
  icon,
  slices,
  kind,
  palette,
  conceptNote,
  compact = false,
}: {
  title: string;
  icon: React.ReactNode;
  slices: Slice[];
  kind: "real" | "concept";
  palette: string[];
  conceptNote?: string;
  compact?: boolean;
}) {
  const total = slices.reduce((acc, b) => acc + b.count, 0);

  const arcs = useMemo(() => {
    if (total <= 0) return [];
    const pie = d3pie<Slice>()
      .value((b) => b.count)
      .sort(null);
    return pie(slices);
  }, [slices, total]);

  const arcGen = useMemo(
    () =>
      d3arc<{ startAngle: number; endAngle: number }>()
        .innerRadius(compact ? 18 : 22)
        .outerRadius(compact ? 38 : 46),
    [compact]
  );

  const isConcept = kind === "concept";

  return (
    <div
      className={
        "rounded-xl border " +
        (compact ? "p-2.5 " : "p-3 ") +
        (isConcept
          ? "bg-white/55 border-white/60 concept-hatched"
          : "bg-white/70 border-white/70")
      }
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-700">
          {icon}
          {title}
        </div>
        {isConcept ? (
          <span className="status-pill status-pill--warn">CONCEPT</span>
        ) : (
          <span className="status-pill status-pill--success">실측</span>
        )}
      </div>

      {total <= 0 ? (
        <div className="h-[88px] flex items-center justify-center text-[11px] text-stone-400">
          데이터 없음
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <svg viewBox="-50 -50 100 100" className={(compact ? "w-[78px] h-[78px]" : "w-[92px] h-[92px]") + " flex-shrink-0"}>
            {arcs.map((a, i) => (
              <path
                key={i}
                d={arcGen({ startAngle: a.startAngle, endAngle: a.endAngle }) ?? ""}
                fill={palette[i % palette.length]}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1}
              />
            ))}
            <text
              x={0}
              y={2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12"
              fontWeight="800"
              fill={isConcept ? "#a8a29e" : "#1c1917"}
            >
              {total.toLocaleString()}
            </text>
          </svg>

          <div className="flex-1 grid grid-cols-1 gap-0.5 text-[10px] min-w-0">
            {slices.map((s, i) => {
              const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ background: palette[i % palette.length] }}
                  />
                  <span className="font-bold text-stone-700 truncate">{s.label}</span>
                  <span className="text-stone-500 ml-auto whitespace-nowrap">
                    {s.count.toLocaleString()}
                    <span className="text-stone-400 ml-1">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isConcept && conceptNote && (
        <div className="text-[9px] text-stone-400 mt-2">※ {conceptNote}</div>
      )}
    </div>
  );
}
