"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Map as MapIcon, RefreshCw, X } from "lucide-react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection as TopoGeometryCollection } from "topojson-specification";
import { shortenSido } from "@scraper/lib/ieps/region";
import { RegionDrillPopover } from "./RegionDrillPopover";
import { RegionSidoSummaryCard } from "./RegionSidoSummaryCard";

/**
 * 라운드 2B — 지역 드릴다운 SVG 지도.
 * - 단계: '전국 시도' → 시도 클릭 시 시군구 zoom-in → 시군구 클릭 시 인라인 팝오버 표시
 * - 색상: 단일 hue 오렌지(#ED7D31) choropleth (사업장 카운트 0 → 흰색, max → 진한 오렌지)
 * - 시군구 단계에서 마우스 우클릭 시 전국 지도로 즉시 복귀
 * - 외부 키 / 결제 불필요 (SVG + topojson)
 */

const KOSTAT_SIDO_TO_SHORT: Record<string, string> = {
  "11": "서울",
  "21": "부산",
  "22": "대구",
  "23": "인천",
  "24": "광주",
  "25": "대전",
  "26": "울산",
  "29": "세종",
  "31": "경기",
  "32": "강원",
  "33": "충북",
  "34": "충남",
  "35": "전북",
  "36": "전남",
  "37": "경북",
  "38": "경남",
  "39": "제주",
};

interface RegionDistribution {
  bySido: { sido: string; count: number }[];
  bySigungu: { sido: string | null; sigungu: string; count: number }[];
  total: number;
  unassigned: number;
}

interface SidoFeatureProps {
  code: string; // 2-digit kostat
  name: string; // 정식 명칭
  short: string; // 약식
}
interface SigunguFeatureProps {
  code: string; // 5-digit kostat
  name: string; // 원본 (e.g. 수원시장안구, 강남구)
  primary: string; // DB region_sigungu 매칭 키 (수원시, 강남구)
  sidoShort: string; // 매칭용 시도 약식
}

interface MapData {
  sido: FeatureCollection<Geometry, SidoFeatureProps>;
  sigungu: FeatureCollection<Geometry, SigunguFeatureProps>;
}

interface Props {
  refreshKey?: number;
}

const SVG_WIDTH = 720;
const SVG_HEIGHT = 540;

/** 팝오버 폭 — 위치 클램핑 계산용 (RegionDrillPopover 의 width 와 동기화) */
const POPOVER_WIDTH = 520;
/** 팝오버가 차지하는 대략적 최대 높이 — 위치 클램핑 계산용 */
const POPOVER_HEIGHT_HINT = 560;
/** 클릭 지점과 팝오버 간 간격 */
const POPOVER_GAP = 12;

/** 수원시장안구 / 성남시중원구 처럼 "OO시 + OO구" 합쳐진 이름을 DB region_sigungu(`수원시`)에 매칭 가능한 primary 로 분리 */
function splitCompoundSigungu(rawName: string): string {
  const m = /^([가-힣]+시)([가-힣]+구)$/.exec(rawName);
  if (m) return m[1];
  return rawName;
}

/** topojson 정식 sido 명칭 → 약식 (강원도 → 강원). region.ts shortenSido 와 동일 로직, 코드 기반 폴백 포함. */
function topoSidoToShort(name: string, code: string): string {
  const s = shortenSido(name);
  if (s) return s;
  return KOSTAT_SIDO_TO_SHORT[code] ?? name;
}

export function RegionMap({ refreshKey }: Props) {
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [dist, setDist] = useState<RegionDistribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"sido" | "sigungu">("sido");
  const [selectedSido, setSelectedSido] = useState<{ short: string; full: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const sidoSummaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidoSummaryRef = useRef<HTMLDivElement | null>(null);
  const [showSidoSummary, setShowSidoSummary] = useState(false);
  const [popover, setPopover] = useState<{
    x: number;
    y: number;
    sidoFull: string;
    sidoShort: string;
    sigungu: string;
  } | null>(null);

  // ----------------- 데이터 로드 -----------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sidoRes, sigunguRes] = await Promise.all([
          fetch("/geo/sido.topojson.json", { cache: "force-cache" }),
          fetch("/geo/sigungu.topojson.json", { cache: "force-cache" }),
        ]);
        if (!sidoRes.ok || !sigunguRes.ok) throw new Error("topojson 로드 실패");
        const sidoTopo = (await sidoRes.json()) as Topology;
        const sigunguTopo = (await sigunguRes.json()) as Topology;

        const sidoKey = Object.keys(sidoTopo.objects)[0];
        const sigunguKey = Object.keys(sigunguTopo.objects)[0];
        const sidoFc = feature(
          sidoTopo,
          sidoTopo.objects[sidoKey] as TopoGeometryCollection
        ) as FeatureCollection<Geometry, { code: string; name: string }>;
        const sigunguFcRaw = feature(
          sigunguTopo,
          sigunguTopo.objects[sigunguKey] as TopoGeometryCollection
        ) as FeatureCollection<Geometry, { code: string; name: string }>;

        const sidoFcEnriched: FeatureCollection<Geometry, SidoFeatureProps> = {
          type: "FeatureCollection",
          features: sidoFc.features.map((f) => ({
            ...f,
            properties: {
              code: f.properties.code,
              name: f.properties.name,
              short: topoSidoToShort(f.properties.name, f.properties.code),
            },
          })),
        };
        const sigunguFcEnriched: FeatureCollection<Geometry, SigunguFeatureProps> = {
          type: "FeatureCollection",
          features: sigunguFcRaw.features.map((f) => ({
            ...f,
            properties: {
              code: f.properties.code,
              name: f.properties.name,
              primary: splitCompoundSigungu(f.properties.name),
              sidoShort: KOSTAT_SIDO_TO_SHORT[f.properties.code.slice(0, 2)] ?? "",
            },
          })),
        };
        if (!cancelled) {
          setMapData({ sido: sidoFcEnriched, sigungu: sigunguFcEnriched });
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadDist = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/regions", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = (await res.json()) as RegionDistribution;
      setDist(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadDist();
  }, [refreshKey]);

  useEffect(() => {
    if (!showSidoSummary) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sidoSummaryRef.current?.contains(target)) return;
      if (sidoSummaryButtonRef.current?.contains(target)) return;
      setShowSidoSummary(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showSidoSummary]);

  // ----------------- 카운트 매핑 -----------------
  const sidoCounts: Map<string, number> = useMemo(() => {
    const m = new Map<string, number>();
    if (!dist) return m;
    for (const r of dist.bySido) {
      const k = shortenSido(r.sido) ?? r.sido;
      m.set(k, (m.get(k) ?? 0) + r.count);
    }
    return m;
  }, [dist]);

  const sigunguCounts: Map<string, number> = useMemo(() => {
    // key = sidoShort + '|' + sigungu primary
    const m = new Map<string, number>();
    if (!dist) return m;
    for (const r of dist.bySigungu) {
      const sidoShort = shortenSido(r.sido) ?? "";
      const k = sidoShort + "|" + r.sigungu;
      m.set(k, (m.get(k) ?? 0) + r.count);
    }
    return m;
  }, [dist]);

  // ----------------- 투영 -----------------
  const sidoProjection = useMemo(() => {
    if (!mapData) return null;
    const proj = geoMercator();
    proj.fitSize([SVG_WIDTH, SVG_HEIGHT], mapData.sido);
    return proj;
  }, [mapData]);

  const sigunguProjection = useMemo(() => {
    if (!mapData || !selectedSido) return null;
    const target = mapData.sigungu.features.filter(
      (f) => f.properties.sidoShort === selectedSido.short
    );
    if (!target.length) return null;
    const fc: FeatureCollection<Geometry, SigunguFeatureProps> = {
      type: "FeatureCollection",
      features: target,
    };
    const proj = geoMercator();
    proj.fitSize([SVG_WIDTH, SVG_HEIGHT], fc);
    return proj;
  }, [mapData, selectedSido]);

  // ----------------- choropleth 스케일 -----------------
  const sidoMax = useMemo(() => {
    let mx = 0;
    for (const v of sidoCounts.values()) if (v > mx) mx = v;
    return mx;
  }, [sidoCounts]);

  const sigunguMax = useMemo(() => {
    if (!selectedSido) return 0;
    let mx = 0;
    for (const [k, v] of sigunguCounts.entries()) {
      if (k.startsWith(selectedSido.short + "|") && v > mx) mx = v;
    }
    return mx;
  }, [sigunguCounts, selectedSido]);

  const fillFor = (count: number, max: number): string => {
    if (count <= 0 || max <= 0) return "rgba(255,255,255,0.78)";
    // 0.18 ~ 0.88 alpha 단조 증가 (단일 hue 오렌지 #ED7D31)
    const ratio = Math.min(1, count / max);
    const eased = Math.pow(ratio, 0.6); // 작은 값도 시각적으로 보이도록 감마 보정
    const alpha = 0.18 + eased * 0.7;
    return `rgba(237, 125, 49, ${alpha.toFixed(3)})`;
  };

  // ----------------- 핸들러 -----------------
  const handleSidoClick = (props: SidoFeatureProps) => {
    setSelectedSido({ short: props.short, full: props.name });
    setPhase("sigungu");
    setPopover(null);
    setShowSidoSummary(false);
  };

  const handleBackToNation = () => {
    setSelectedSido(null);
    setPhase("sido");
    setPopover(null);
    setShowSidoSummary(false);
  };

  /** 시군구 영역 클릭 → 클릭 위치 기준으로 인라인 팝오버 표시. */
  const handleSigunguClick = (props: SigunguFeatureProps, event: React.MouseEvent) => {
    if (!selectedSido) return;
    const wrap = mapWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    // 컨테이너 기준 클릭 좌표
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    // 팝오버는 클릭 지점의 우측 + 아래에 표시 — 컨테이너 경계를 벗어날 경우 반대편으로 뒤집기.
    let x = cx + POPOVER_GAP;
    if (x + POPOVER_WIDTH > rect.width - 8) {
      x = Math.max(8, cx - POPOVER_WIDTH - POPOVER_GAP);
    }
    let y = cy + POPOVER_GAP;
    if (y + POPOVER_HEIGHT_HINT > rect.height - 8) {
      y = Math.max(8, cy - POPOVER_HEIGHT_HINT - POPOVER_GAP);
    }
    setPopover({
      x,
      y,
      sidoFull: selectedSido.full,
      sidoShort: selectedSido.short,
      sigungu: props.primary,
    });
  };

  /** 시군구 단계에서 SVG 위 우클릭 → 전국 지도로 즉시 복귀. */
  const handleMapContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    if (phase !== "sigungu") return;
    e.preventDefault();
    handleBackToNation();
  };

  // ----------------- 렌더 -----------------
  const pathSido = sidoProjection ? geoPath(sidoProjection) : null;
  const pathSigungu = sigunguProjection ? geoPath(sigunguProjection) : null;

  const isReady = !!mapData && !!dist && !error;

  return (
    <section ref={containerRef} className="cd-card p-6 rounded-3xl cd-reveal delay-2 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-bold cd-text-muted flex items-center gap-2">
          <MapIcon className="w-5 h-5 cd-text-primary" />
          지역 분포
          <span className="text-[10px] font-bold cd-text-faint ml-1">
            (시도 → 시군구 드릴다운)
          </span>
        </h3>
        <div className="flex items-center gap-3">
          <Legend />
          <button
            type="button"
            onClick={reloadDist}
            className="cd-btn cd-btn-ghost rounded-xl px-3 py-1.5 text-xs font-bold cd-text-muted flex items-center gap-1"
          >
            <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
            새로고침
          </button>
        </div>
      </div>

      <Breadcrumb
        phase={phase}
        selectedSidoFull={selectedSido?.full ?? null}
        onBack={handleBackToNation}
      />

      <div ref={mapWrapRef} className="relative mt-3 flex-1 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="region-svg"
          role="img"
          aria-label={phase === "sido" ? "전국 시도 분포 지도" : `${selectedSido?.full} 시군구 분포 지도`}
          onContextMenu={handleMapContextMenu}
        >
          {/* 부드러운 배경 그라디언트 */}
          <defs>
            <linearGradient id="region-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(237,125,49,0.04)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#region-bg)" />

          {phase === "sido" && pathSido && mapData &&
            mapData.sido.features.map((f) => {
              const props = f.properties;
              const cnt = sidoCounts.get(props.short) ?? 0;
              const d = pathSido(f) ?? "";
              if (!d) return null;
              return (
                <g key={props.code}>
                  <title>
                    {props.name} · {cnt.toLocaleString()}건
                  </title>
                  <path
                    className="region"
                    d={d}
                    style={{ fill: fillFor(cnt, sidoMax) }}
                    data-empty={cnt === 0}
                    onClick={() => handleSidoClick(props)}
                  />
                </g>
              );
            })}

          {phase === "sigungu" && pathSigungu && mapData && selectedSido &&
            mapData.sigungu.features
              .filter((f) => f.properties.sidoShort === selectedSido.short)
              .map((f) => {
                const props = f.properties;
                const k = selectedSido.short + "|" + props.primary;
                const cnt = sigunguCounts.get(k) ?? 0;
                const d = pathSigungu(f) ?? "";
                if (!d) return null;
                return (
                  <g key={props.code}>
                    <title>
                      {props.primary === props.name ? props.name : `${props.name} (${props.primary})`} · {cnt.toLocaleString()}건
                    </title>
                    <path
                      className="region"
                      d={d}
                      style={{ fill: fillFor(cnt, sigunguMax) }}
                      data-empty={cnt === 0}
                      onClick={(e) => handleSigunguClick(props, e)}
                    />
                  </g>
                );
              })}
        </svg>

        {!isReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs cd-text-faint cd-surface-bg backdrop-blur-sm rounded-2xl">
            지도 로딩중…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs cd-error-text cd-surface-bg backdrop-blur-sm rounded-2xl">
            지도 로드 실패: {error}
          </div>
        )}

        {phase === "sigungu" && selectedSido && (
          <>
            <button
              ref={sidoSummaryButtonRef}
              type="button"
              className="region-summary-toggle cd-btn cd-btn-ghost"
              aria-expanded={showSidoSummary}
              onClick={(e) => {
                e.stopPropagation();
                setShowSidoSummary((v) => !v);
              }}
            >
              역내 사업장 현황
            </button>
            {showSidoSummary && (
              <div ref={sidoSummaryRef}>
                <RegionSidoSummaryCard sidoFull={selectedSido.full} sidoShort={selectedSido.short} />
              </div>
            )}
          </>
        )}

        {popover && (
          <RegionDrillPopover
            x={popover.x}
            y={popover.y}
            sidoFull={popover.sidoFull}
            sidoShort={popover.sidoShort}
            sigungu={popover.sigungu}
            onClose={() => setPopover(null)}
          />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] cd-text-faint font-medium">
        <span>
          누적 {dist?.total.toLocaleString() ?? "—"}건
          {dist?.unassigned ? ` · 지역 미상 ${dist.unassigned.toLocaleString()}건` : null}
        </span>
        <span className="cd-text-faint text-right">
          {phase === "sido"
            ? "시도 클릭 → 시군구 단계로 진입"
            : "역내 사업장 현황 버튼 · 시군구 클릭 → 분포 팝오버 표시"}
        </span>
      </div>
    </section>
  );
}

function Breadcrumb({
  phase,
  selectedSidoFull,
  onBack,
}: {
  phase: "sido" | "sigungu";
  selectedSidoFull: string | null;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs font-bold">
      <button
        type="button"
        onClick={onBack}
        className={
          "px-2.5 py-1 rounded-lg transition " +
          (phase === "sido"
            ? "cd-tint-primary cd-text-primary cursor-default"
            : "cd-text-muted hover:bg-[color:var(--cd-surface)]")
        }
      >
        전국
      </button>
      {phase === "sigungu" && (
        <>
          <ChevronRight className="w-3 h-3 cd-text-faint" />
          <span className="px-2.5 py-1 rounded-lg cd-tint-primary cd-text-primary inline-flex items-center gap-1">
            {selectedSidoFull}
            <button
              type="button"
              onClick={onBack}
              className="ml-1 inline-flex w-4 h-4 items-center justify-center rounded-full hover:bg-[var(--cd-primary-soft)]"
              aria-label="전국으로 돌아가기"
              title="전국"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        </>
      )}
    </div>
  );
}

function Legend() {
  const ramp = [0.08, 0.22, 0.4, 0.6, 0.85];
  return (
    <div className="region-legend">
      <span>적음</span>
      {ramp.map((a, i) => (
        <span
          key={i}
          className="swatch"
          style={{ background: `rgba(237, 125, 49, ${a})` }}
        />
      ))}
      <span>많음</span>
    </div>
  );
}
