"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, AlertTriangle, BarChart3 } from "lucide-react";
import { pie as d3pie, arc as d3arc } from "d3-shape";
import { cn } from "@/lib/utils";

interface TrendBucket {
  date: string;
  httpOk: number;
  playwrightOk: number;
  cacheOk: number;
  failed: number;
}

interface FailureReason {
  reason: string;
  count: number;
}

type Window = 1 | 7 | 30;

const WINDOWS: { id: Window; label: string }[] = [
  { id: 1, label: "24h" },
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
];

const SERIES_COLORS = {
  httpOk: "rgba(120, 113, 108, 0.85)",
  playwrightOk: "rgba(124, 58, 237, 0.85)",
  cacheOk: "rgba(14, 165, 233, 0.7)",
  failed: "rgba(220, 38, 38, 0.9)",
};

const REASON_PALETTE = [
  "#16a34a",
  "#0ea5e9",
  "#7c3aed",
  "#f59e0b",
  "#ef4444",
  "#84cc16",
  "#0891b2",
  "#a855f7",
  "#d97706",
  "#dc2626",
];

export function OperationsPanel() {
  const [days, setDays] = useState<Window>(7);
  const [trend, setTrend] = useState<TrendBucket[] | null>(null);
  const [reasons, setReasons] = useState<FailureReason[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [tRes, rRes] = await Promise.all([
          fetch(`/api/dashboard/download-trend?days=${days}`, {
            cache: "no-store",
            signal,
          }),
          fetch(`/api/dashboard/failure-reasons?days=${days}`, {
            cache: "no-store",
            signal,
          }),
        ]);
        if (!tRes.ok) throw new Error(`trend HTTP ${tRes.status}`);
        if (!rRes.ok) throw new Error(`reasons HTTP ${rRes.status}`);
        const tJson = (await tRes.json()) as { buckets: TrendBucket[] };
        const rJson = (await rRes.json()) as { reasons: FailureReason[] };
        setTrend(tJson.buckets);
        setReasons(rJson.reasons);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    reload(ctrl.signal);
    return () => ctrl.abort();
  }, [reload]);

  return (
    <div className="cd-card p-6 rounded-3xl flex flex-col gap-4 cd-reveal delay-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold cd-text-muted flex items-center gap-2">
          <Activity className="w-5 h-5 cd-text-primary" />
          운영 관측
        </h3>
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setDays(w.id)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-colors",
                days === w.id
                  ? "cd-fill-primary text-white"
                  : "cd-btn cd-btn-ghost cd-text-muted"
              )}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => reload()}
            className="cd-btn cd-btn-ghost rounded-xl px-3 py-1.5 text-xs font-bold cd-text-muted flex items-center gap-1"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border cd-border-c cd-surface-bg p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 cd-text-faint" />
            <div className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
              일별 다운로드 추이
            </div>
          </div>
          <TrendChart data={trend} loading={loading} />
          <Legend />
        </div>

        <div className="rounded-2xl border cd-border-c cd-surface-bg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 cd-text-faint" />
            <div className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
              실패 사유 Top 10
            </div>
          </div>
          <ReasonsDonut reasons={reasons} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="text-[11px] cd-error-text font-bold">로딩 실패: {error}</div>
      )}
    </div>
  );
}

function TrendChart({
  data,
  loading,
}: {
  data: TrendBucket[] | null;
  loading: boolean;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="text-[12px] cd-text-faint italic h-40 flex items-center justify-center">
        {loading ? "로딩 중..." : "표시할 데이터가 없습니다."}
      </div>
    );
  }
  const max = Math.max(
    1,
    ...data.map((d) => d.httpOk + d.playwrightOk + d.cacheOk + d.failed)
  );
  const W = 600;
  const H = 160;
  const padding = { top: 8, right: 8, bottom: 22, left: 28 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const slot = innerW / data.length;
  const barW = Math.max(6, Math.min(28, slot * 0.55));

  const yTicks = [0, 0.5, 1].map((r) => Math.round(max * r));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44">
      {yTicks.map((t, i) => {
        const y = padding.top + innerH - (t / max) * innerH;
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={W - padding.right}
              y2={y}
              stroke="rgba(120,113,108,0.18)"
              strokeDasharray={i === 0 ? undefined : "2 3"}
            />
            <text
              x={padding.left - 4}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="rgba(87,83,78,0.7)"
            >
              {t}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padding.left + slot * i + (slot - barW) / 2;
        let yCursor = padding.top + innerH;
        const segs: { color: string; value: number }[] = [
          { color: SERIES_COLORS.httpOk, value: d.httpOk },
          { color: SERIES_COLORS.playwrightOk, value: d.playwrightOk },
          { color: SERIES_COLORS.cacheOk, value: d.cacheOk },
          { color: SERIES_COLORS.failed, value: d.failed },
        ];
        const total = segs.reduce((acc, s) => acc + s.value, 0);
        const showLabel =
          i === 0 || i === data.length - 1 || i === Math.floor((data.length - 1) / 2);
        return (
          <g key={d.date}>
            {segs.map((s, j) => {
              if (s.value <= 0) return null;
              const h = (s.value / max) * innerH;
              yCursor -= h;
              return (
                <rect
                  key={j}
                  x={x}
                  y={yCursor}
                  width={barW}
                  height={h}
                  fill={s.color}
                  rx={2}
                />
              );
            })}
            {showLabel && (
              <text
                x={x + barW / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="9"
                fill="rgba(87,83,78,0.85)"
              >
                {d.date.slice(5)}
              </text>
            )}
            {total > 0 && (
              <title>{`${d.date}\nHTTP ${d.httpOk} · Playwright ${d.playwrightOk} · Cache ${d.cacheOk} · 실패 ${d.failed}`}</title>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  const items: { label: string; color: string }[] = [
    { label: "HTTP", color: SERIES_COLORS.httpOk },
    { label: "Playwright", color: SERIES_COLORS.playwrightOk },
    { label: "캐시", color: SERIES_COLORS.cacheOk },
    { label: "실패", color: SERIES_COLORS.failed },
  ];
  return (
    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] cd-text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function ReasonsDonut({
  reasons,
  loading,
}: {
  reasons: FailureReason[] | null;
  loading: boolean;
}) {
  const total = useMemo(
    () => (reasons ? reasons.reduce((acc, r) => acc + r.count, 0) : 0),
    [reasons]
  );

  const arcs = useMemo(() => {
    if (!reasons || total <= 0) return [];
    const pie = d3pie<FailureReason>()
      .value((r) => r.count)
      .sort(null);
    return pie(reasons);
  }, [reasons, total]);

  const arcGen = useMemo(
    () =>
      d3arc<{ startAngle: number; endAngle: number }>()
        .innerRadius(36)
        .outerRadius(70),
    []
  );

  if (!reasons || reasons.length === 0) {
    return (
      <div className="text-[12px] cd-text-faint italic h-40 flex items-center justify-center">
        {loading ? "로딩 중..." : "실패 기록이 없습니다."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox="-80 -80 160 160" className="w-full h-40">
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arcGen(arc) ?? undefined}
            fill={REASON_PALETTE[i % REASON_PALETTE.length]}
            stroke="white"
            strokeWidth={1.2}
          >
            <title>{`${reasons[i].reason} — ${reasons[i].count}건`}</title>
          </path>
        ))}
        <text
          x={0}
          y={-2}
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="rgba(41,37,36,0.85)"
        >
          {total}
        </text>
        <text
          x={0}
          y={11}
          textAnchor="middle"
          fontSize="8"
          fill="rgba(120,113,108,0.85)"
        >
          실패 합계
        </text>
      </svg>
      <ul className="flex flex-col gap-1 text-[11px]">
        {reasons.map((r, i) => (
          <li key={r.reason + i} className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: REASON_PALETTE[i % REASON_PALETTE.length] }}
            />
            <span className="flex-1 truncate cd-text-muted" title={r.reason}>
              {r.reason}
            </span>
            <span className="font-bold cd-text">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
