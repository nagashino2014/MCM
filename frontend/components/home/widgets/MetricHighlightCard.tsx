"use client";

// 홈 위젯 — 데이터 지표 하이라이트(SW-P3 이월분).
// 조회 가능한 지표(공개범위는 서버 필터) 중 하나를 골라 상위 그룹을 미니 가로 바로 보여준다.
// 선택한 지표는 홈 레이아웃(widgetConfig, 서버 저장)에 함께 저장되어 기기와 무관하게 유지된다.
// 권한(approval.view) 없거나 조회 가능한 지표가 없으면 카드가 스스로 숨는다(홈 위젯 관례).

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { formatMetricValue, type MetricItem, type MetricResult } from "@/lib/analytics/metric-types";

const TOP_N = 6;

export function MetricHighlightCard({
  metricKey,
  onSelect,
}: {
  /** 저장된 선택(layout.widgetConfig.metrics.metricKey) — 없으면 목록 첫 지표 */
  metricKey?: string;
  onSelect?: (metricKey: string) => void;
}) {
  const [metrics, setMetrics] = useState<MetricItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [result, setResult] = useState<MetricResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/approval/analytics", { cache: "no-store" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          if (alive) setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (alive && d) setMetrics(d.metrics ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const activeKey = metricKey && metrics?.some((m) => m.metricKey === metricKey) ? metricKey : metrics?.[0]?.metricKey;

  useEffect(() => {
    if (!activeKey) {
      if (metrics) setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/approval/analytics?run=${encodeURIComponent(activeKey)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b?.error ?? "실행 실패")))))
      .then((d) => {
        if (alive) setResult(d.result ?? null);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeKey, metrics]);

  if (forbidden || (metrics && metrics.length === 0)) return null;

  // 시간축 지표는 최신 기간의 행만 하이라이트(미니 카드에서 추이까지는 무리 — 보드 딥링크로 유도)
  let rows = result?.rows.filter((r) => r.value != null) ?? [];
  let periodNote: string | null = null;
  if (result?.hasTime && rows.length) {
    const times = [...new Set(rows.map((r) => r.time).filter(Boolean))].sort();
    const last = times[times.length - 1];
    rows = rows.filter((r) => r.time === last);
    periodNote = last ?? null;
  }
  rows = [...rows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, TOP_N);
  const max = rows.reduce((a, r) => Math.max(a, r.value ?? 0), 0);

  return (
    <HomeCard
      icon={<BarChart3 className="w-4 h-4" />}
      title="데이터 지표"
      href="/approval/analytics"
      loading={loading && !metrics}
      error={error ?? undefined}
      empty={!loading && !error && rows.length === 0}
      emptyText="아직 계산된 값이 없습니다 — 데이터가 쌓이면 채워집니다."
      headerActions={
        metrics && metrics.length > 0 ? (
          <select
            className="cd-select text-[11px]"
            style={{ width: 170, height: 26, padding: "0 6px" }}
            value={activeKey ?? ""}
            onChange={(e) => onSelect?.(e.target.value)}
          >
            {metrics.map((m) => (
              <option key={m.metricKey} value={m.metricKey}>
                {m.label}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1.5">
        {periodNote && <p className="text-[10.5px] cd-text-faint">최근 기간({periodNote}) 기준 상위 {rows.length}</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[12px] cd-text truncate" style={{ width: "42%" }} title={r.groupLabel}>
              {r.groupLabel}
            </span>
            <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--cd-hover)" }}>
              <span
                className="block h-full rounded-full"
                style={{ width: `${max > 0 ? Math.max(4, ((r.value ?? 0) / max) * 100) : 0}%`, background: "var(--cd-primary)" }}
              />
            </span>
            <span className="text-[11.5px] font-bold cd-text tabular-nums shrink-0">
              {result ? formatMetricValue(r.value, result.format) : "-"}
            </span>
          </div>
        ))}
      </div>
    </HomeCard>
  );
}
