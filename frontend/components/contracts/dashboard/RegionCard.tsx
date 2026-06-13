"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection as TopoGeometryCollection } from "topojson-specification";
import { SIDO_LIST, shortenSido } from "@scraper/lib/ieps/region";
import { CardFrame, CardSkeleton } from "./CardFrame";
import { fmtFull, type CdTheme } from "./types";

const SVG_WIDTH = 420;
const SVG_HEIGHT = 460;

interface SidoFeatureProps {
  code: string;
  name: string;
}

/**
 * 지역별 수주현황 — 시도 단위 choropleth(단일 hue 오렌지) + 시도별 수주액 리스트.
 */
export function RegionCard({
  theme,
  regions,
  loading,
}: {
  theme: CdTheme;
  regions: Array<{ sido: string; amount: number }>;
  loading: boolean;
}) {
  const [fc, setFc] = useState<FeatureCollection<Geometry, SidoFeatureProps> | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/geo/sido.topojson.json", { cache: "force-cache" });
        if (!res.ok) throw new Error("지도 데이터 로드 실패");
        const topo = (await res.json()) as Topology;
        const key = Object.keys(topo.objects)[0];
        const collection = feature(
          topo,
          topo.objects[key] as TopoGeometryCollection
        ) as FeatureCollection<Geometry, SidoFeatureProps>;
        if (!cancelled) setFc(collection);
      } catch (err) {
        if (!cancelled) setMapError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // short 시도명 → 수주액
  const amountByShort = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of regions) {
      const key = shortenSido(r.sido) ?? r.sido;
      m.set(key, (m.get(key) ?? 0) + r.amount);
    }
    return m;
  }, [regions]);

  const maxAmount = useMemo(() => {
    let mx = 0;
    for (const v of amountByShort.values()) if (v > mx) mx = v;
    return mx;
  }, [amountByShort]);

  const projection = useMemo(() => {
    if (!fc) return null;
    const proj = geoMercator();
    proj.fitSize([SVG_WIDTH, SVG_HEIGHT], fc);
    return proj;
  }, [fc]);
  const path = projection ? geoPath(projection) : null;

  const baseFill = theme === "dark" ? "#1d2530" : "#ffffff";
  const fillFor = (amount: number): string => {
    if (amount <= 0 || maxAmount <= 0) return baseFill;
    const eased = Math.pow(Math.min(1, amount / maxAmount), 0.55);
    const alpha = 0.2 + eased * 0.72;
    return `rgba(250, 137, 107, ${alpha.toFixed(3)})`;
  };

  // 전체 시도 목록 (수주액 desc).
  // SIDO_LIST 에는 강원도/강원특별자치도, 전라북도/전북특별자치도처럼 동일 short 가
  // 중복 등록되어 있어 short 기준으로 dedupe 한다 (중복 행 + React key 충돌 방지).
  const listRows = useMemo(() => {
    const byShort = new Map<string, string>();
    for (const s of SIDO_LIST) byShort.set(s.short, s.full); // 마지막 항목(통용 명칭) 우선
    const rows = [...byShort.entries()].map(([short, label]) => ({
      short,
      label,
      amount: amountByShort.get(short) ?? 0,
    }));
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [amountByShort]);

  return (
    <CardFrame
      area="cd-a-region"
      icon={<Globe2 className="w-4 h-4" />}
      title="지역별 수주현황"
      delay={2}
      bodyClassName="gap-1.5"
    >
      {loading ? (
        <CardSkeleton lines={7} />
      ) : (
        <>
          <div className="relative flex-1 min-h-[230px] flex items-center justify-center">
            {mapError && (
              <p className="text-xs" style={{ color: "var(--cd-error)" }}>
                {mapError}
              </p>
            )}
            {!mapError && !fc && (
              <p className="text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                지도 로딩중…
              </p>
            )}
            {!mapError && fc && path && (
              <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="cd-region-svg w-[90%] h-auto" role="img" aria-label="시도별 수주액 분포 지도">
                {fc.features.map((f) => {
                  const short = shortenSido(f.properties.name) ?? f.properties.name;
                  const amount = amountByShort.get(short) ?? 0;
                  const d = path(f) ?? "";
                  if (!d) return null;
                  return (
                    <g key={f.properties.code}>
                      <title>
                        {f.properties.name} · {amount > 0 ? fmtFull(amount) : "-"}
                      </title>
                      <path className="cd-region" d={d} style={{ fill: fillFor(amount) }} />
                    </g>
                  );
                })}
              </svg>
            )}
            {/* 범례 */}
            <div className="absolute right-0 top-1 flex flex-col items-end gap-1">
              <span className="text-[10px] font-bold" style={{ color: "var(--cd-faint)" }}>
                수주액
              </span>
              <div
                className="w-2.5 h-20 rounded-full"
                style={{
                  background: `linear-gradient(to top, ${baseFill}, rgba(250,137,107,0.92))`,
                  border: "1px solid var(--cd-border)",
                }}
              />
              <span className="text-[9px] tabular-nums" style={{ color: "var(--cd-faint)" }}>
                {maxAmount > 0 ? fmtFull(maxAmount) : "0"}
              </span>
            </div>
          </div>

          {/* 시도별 수주현황 리스트 */}
          <div className="shrink-0">
            <p
              className="text-[11px] font-bold px-2 py-1.5 rounded-lg mb-1 inline-block"
              style={{ background: "var(--cd-accent-soft)", color: "var(--cd-accent)" }}
            >
              시도별 수주현황
            </p>
            <div className="grid grid-cols-2 gap-x-3 text-[11px]">
              {listRows.map((row) => (
                <div
                  key={row.short}
                  className="cd-row-hover grid grid-cols-[auto_1fr] gap-2 items-center px-2 py-1 rounded-md"
                >
                  <span className="font-bold" style={{ color: "var(--cd-muted)" }}>
                    {row.label}
                  </span>
                  <span
                    className="text-right tabular-nums font-bold"
                    style={{ color: row.amount > 0 ? "var(--cd-text)" : "var(--cd-faint)" }}
                  >
                    {row.amount > 0 ? fmtFull(row.amount) : "-"}
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
