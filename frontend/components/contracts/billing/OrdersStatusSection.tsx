"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import { Globe2, ListOrdered, MapPin } from "lucide-react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection as TopoGeometryCollection } from "topojson-specification";
import { SIDO_LIST, shortenSido } from "@scraper/lib/ieps/region";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";
import { filterOrdersStatusRows } from "@/lib/ieps/orders-status-filter";
import type { ContractOrdersStatusRow, ContractOrdersYearlyEntry } from "@/lib/ieps/contracts";
import {
  CATEGORY_META,
  DASHBOARD_CATEGORIES,
  chartPalette,
  fmtCompact,
  fmtFull,
  softCategoryColor,
  type CdTheme,
} from "@/components/contracts/dashboard/types";
import { filenameFromDisposition } from "@/lib/client-download";
import { YearlyTrendCard } from "./YearlyTrendCard";

const SVG_WIDTH = 420;
const SVG_HEIGHT = 460;
const INTEGRATED_PERMIT_CATEGORY = "통합환경허가";
const SUBTYPE_DONUT_COLORS = [
  "#FF6B6B",
  "#F3C16F",
  "#FFF176",
  "#B7F59A",
  "#8FD476",
  "#B9D8FF",
  "#D5A9FF",
  "#E4B4FF",
];

interface SidoFeatureProps {
  code: string;
  name: string;
}

interface OrdersStatusPayload {
  year: string;
  availableYears: string[];
  rows: ContractOrdersStatusRow[];
  yearly: ContractOrdersYearlyEntry[];
}

/** 계약 상세로 이동 후 "돌아가기" 시 필터/선택 상태를 복원하기 위한 저장 키 */
const ORDERS_STATE_KEY = "mcm-billing-orders-state";

interface SavedOrdersState {
  year: string | null;
  category: string | null;
  industryId: string | null;
  sido: string | null;
  contractId: string | null;
}

function readSavedOrdersState(): SavedOrdersState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ORDERS_STATE_KEY);
    return raw ? (JSON.parse(raw) as SavedOrdersState) : null;
  } catch {
    return null;
  }
}

/** hex(#rrggbb) → rgba 문자열 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
}

/**
 * 수주 현황 — 용역/업종/연도 필터 + 시도 지도 컨트롤 + 수주 계약 리스트.
 * 지도에서 시도를 클릭하면 해당 지역으로 리스트가 필터링된다.
 */
export function OrdersStatusSection({ theme }: { theme: CdTheme }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 계약 상세의 "돌아가기"(?restore=1)로 진입한 경우 저장된 필터/선택 상태를 복원
  const [data, setData] = useState<OrdersStatusPayload | null>(null);
  // 저장된 필터/선택 상태(?restore=1)는 렌더 도중이 아니라 마운트 후 useEffect 에서 복원한다.
  // 렌더 중 sessionStorage 를 읽으면 서버 렌더(빈 값)와 클라이언트(복원값)가 달라져
  // 하이드레이션 불일치가 발생하므로, 초기값은 서버와 동일하게 비워 둔다.
  const [year, setYear] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [industryId, setIndustryId] = useState<string | null>(null);
  const [sido, setSido] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const scrollPendingRef = useRef<boolean>(false);
  const restoredRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [fc, setFc] = useState<FeatureCollection<Geometry, SidoFeatureProps> | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // ?restore=1 진입 시 저장된 필터/선택을 마운트 후 1회 복원 (하이드레이션 안전)
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (searchParams.get("restore") !== "1") return;
    const saved = readSavedOrdersState();
    if (!saved) return;
    if (saved.year != null) setYear(saved.year);
    if (saved.category != null) setCategory(saved.category);
    if (saved.industryId != null) setIndustryId(saved.industryId);
    if (saved.sido != null) setSido(saved.sido);
    if (saved.contractId != null) {
      setSelectedContractId(saved.contractId);
      scrollPendingRef.current = true;
    }
  }, [searchParams]);

  // 지도 데이터 로드
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

  // 수주 데이터 로드 (연도 변경 시)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    fetch(`/api/contracts/billing/orders?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
        }
        return (await res.json()) as OrdersStatusPayload;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setYear(json.year);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const handleCategory = (next: string | null) => {
    setCategory(next);
    if (next !== INTEGRATED_PERMIT_CATEGORY) setIndustryId(null);
  };

  // 지도/요약용: 지역 선택 전 단계 필터 (용역 + 업종)
  const baseRows = useMemo(
    () => filterOrdersStatusRows(data?.rows ?? [], { category, industryId }),
    [data, category, industryId]
  );
  // 리스트용: 지역 선택까지 반영
  const listRows = useMemo(
    () => filterOrdersStatusRows(baseRows, { sido }),
    [baseRows, sido]
  );

  // 상태 복원 시 선택된 계약이 보이도록 리스트를 스크롤
  useEffect(() => {
    if (!scrollPendingRef.current || !selectedContractId || listRows.length === 0) return;
    const el = document.getElementById(`cdb-order-row-${selectedContractId}`);
    if (el) {
      scrollPendingRef.current = false;
      el.scrollIntoView({ block: "center" });
    }
  }, [listRows, selectedContractId]);

  const amountByShort = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of baseRows) {
      const key = shortenSido(row.sido) ?? row.sido ?? "미상";
      m.set(key, (m.get(key) ?? 0) + row.amount);
    }
    return m;
  }, [baseRows]);

  const maxAmount = useMemo(() => {
    let mx = 0;
    for (const v of amountByShort.values()) if (v > mx) mx = v;
    return mx;
  }, [amountByShort]);

  const sidoFullByShort = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of SIDO_LIST) m.set(s.short, s.full); // 마지막 항목(통용 명칭) 우선
    return m;
  }, []);

  const projection = useMemo(() => {
    if (!fc) return null;
    const proj = geoMercator();
    proj.fitSize([SVG_WIDTH, SVG_HEIGHT], fc);
    return proj;
  }, [fc]);
  const path = projection ? geoPath(projection) : null;

  const baseFill = theme === "dark" ? "#1d2530" : "#ffffff";
  // 전체 용역 = 파랑, 개별 용역 선택 시 = 해당 용역 지정색
  const mapHex = category ? CATEGORY_META[category]?.color ?? "#5d87ff" : "#5d87ff";
  const fillFor = (amount: number): string => {
    if (amount <= 0 || maxAmount <= 0) return baseFill;
    const eased = Math.pow(Math.min(1, amount / maxAmount), 0.55);
    const alpha = 0.2 + eased * 0.72;
    return hexToRgba(mapHex, alpha);
  };

  const selectedAmount = useMemo(
    () => listRows.reduce((acc, r) => acc + r.amount, 0),
    [listRows]
  );

  // 인덱스 상단(총 수주액/용역별 도넛)은 용역 필터와 무관하게 선택 지역의 전체 용역을 집계한다.
  const summaryAllRows = useMemo(
    () => filterOrdersStatusRows(data?.rows ?? [], { sido }),
    [data, sido]
  );

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(format);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (category) params.set("category", category);
      if (industryId) params.set("industry", industryId);
      if (sido) params.set("sido", sido);
      params.set("format", format);
      const res = await fetch("/api/contracts/billing/orders/export?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `수주계약리스트_${stamp}.${format}`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바: 용역 선택 / 업종 선택 / 연도 선택 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-extrabold mr-1" style={{ color: "var(--cd-faint)" }}>
            용역 선택
          </span>
          <button
            type="button"
            className="cd-chip cd-chip-sm"
            data-active={category === null}
            onClick={() => handleCategory(null)}
          >
            전체 용역
          </button>
          {DASHBOARD_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className="cd-chip cd-chip-sm inline-flex items-center gap-1.5"
              data-active={category === cat}
              onClick={() => handleCategory(cat)}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: CATEGORY_META[cat]?.color ?? "var(--cd-faint)" }}
              />
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
            업종 선택
          </span>
          <select
            className="cd-input"
            style={{ width: "13rem", opacity: category === INTEGRATED_PERMIT_CATEGORY ? 1 : 0.45 }}
            disabled={category !== INTEGRATED_PERMIT_CATEGORY}
            value={industryId ?? ""}
            onChange={(e) => setIndustryId(e.target.value || null)}
            title={
              category === INTEGRATED_PERMIT_CATEGORY
                ? "통합허가 대상 업종으로 필터링"
                : "용역 선택에서 통합환경허가를 선택한 경우에만 활성화됩니다"
            }
          >
            <option value="">업종 전체</option>
            {INTEGRATED_PERMIT_INDUSTRIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
            기준 연도
          </span>
          <select
            className="cd-input"
            style={{ width: "7.5rem" }}
            value={year ?? ""}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="all">전체 기간</option>
            {(data?.availableYears ?? (year && year !== "all" ? [year] : [])).map((item) => (
              <option key={item} value={item}>
                {item}년
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p
          className="text-[11px] font-bold px-3 py-2 rounded-lg"
          style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}
        >
          불러오기 실패: {error}
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 items-stretch">
        {/* 지도 컨트롤 */}
        <div
          className="cdb-box p-4 min-h-[650px] h-full flex flex-col"
          onContextMenu={(e) => {
            e.preventDefault();
            setSido(null);
          }}
          title="우클릭하면 선택 지역이 해제되어 전국 상태로 돌아갑니다"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="cd-card-title">
              <span className="cd-title-icon">
                <Globe2 className="w-4 h-4" />
              </span>
              지역별 수주 분포
            </p>
            {sido && (
              <button type="button" className="cd-chip cd-chip-sm" onClick={() => setSido(null)}>
                선택 해제
              </button>
            )}
          </div>

          {/* 선택 지역 */}
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 text-[12px] font-extrabold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
            >
              <MapPin className="w-3.5 h-3.5" />
              {sido ? sidoFullByShort.get(sido) ?? sido : "전체 지역"}
            </span>
          </div>

          <div className="relative flex-1 min-h-0 flex items-start justify-center pt-2">
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
              <svg
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                className="cd-region-svg cdb-region-svg w-[68%] h-auto -translate-y-4"
                role="img"
                aria-label="시도별 수주액 분포 지도 (클릭하여 지역 선택)"
              >
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
                      <path
                        className="cd-region"
                        d={d}
                        data-selected={sido === short}
                        style={{ fill: fillFor(amount) }}
                        onClick={() => setSido((prev) => (prev === short ? null : short))}
                      />
                    </g>
                  );
                })}
              </svg>
            )}
            <OrdersMapSummary
              theme={theme}
              year={year}
              sido={sido}
              allRows={summaryAllRows}
              selectedRows={listRows}
              category={category}
            />
            {/* 범례 */}
            <div className="absolute right-0 top-1 flex flex-col items-end gap-1">
              <span className="text-[10px] font-bold" style={{ color: "var(--cd-faint)" }}>
                수주액
              </span>
              <div
                className="w-2.5 h-20 rounded-full"
                style={{
                  background: `linear-gradient(to top, ${baseFill}, ${hexToRgba(mapHex, 0.92)})`,
                  border: "1px solid var(--cd-border)",
                }}
              />
              <span className="text-[9px] tabular-nums" style={{ color: "var(--cd-faint)" }}>
                {maxAmount > 0 ? fmtFull(maxAmount) : "0"}
              </span>
            </div>
          </div>
        </div>

        {/* 수주 계약 리스트 + 연도별 추이 */}
        <div className="flex flex-col gap-4 min-w-0">
        <div className="cdb-box p-4 h-[486px] flex flex-col min-w-0">
          {/* 제목 · 요약 태그 · 다운로드 버튼을 한 행에 배치 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="cd-card-title">
              <span className="cd-title-icon">
                <ListOrdered className="w-4 h-4" />
              </span>
              수주 계약 리스트
            </p>
            <span
              className="ml-auto text-[11px] font-extrabold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--cd-surface)", color: "var(--cd-muted)", border: "1px solid var(--cd-border)" }}
            >
              총 수주 건수{" "}
              <span className="tabular-nums" style={{ color: "var(--cd-text)" }}>
                {listRows.length.toLocaleString()}건
              </span>
            </span>
            <span
              className="text-[11px] font-extrabold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--cd-surface)", color: "var(--cd-muted)", border: "1px solid var(--cd-border)" }}
            >
              총 수주 금액{" "}
              <span className="tabular-nums" style={{ color: "var(--cd-text)" }}>
                {selectedAmount > 0 ? `${fmtFull(selectedAmount)}원` : "-"}
              </span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleExport("xlsx")}
                disabled={exporting !== null || listRows.length === 0}
                title="현재 리스트를 엑셀로 다운로드"
                className="flex items-center justify-center disabled:opacity-40"
                style={{ width: 30, height: 30 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
              </button>
              <button
                type="button"
                onClick={() => handleExport("pdf")}
                disabled={exporting !== null || listRows.length === 0}
                title="현재 리스트를 PDF로 다운로드"
                className="flex items-center justify-center disabled:opacity-40"
                style={{ width: 30, height: 30 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
              </button>
            </div>
          </div>

          {/* 열 레이블 */}
          <div
            className="cdb-list-row !cursor-default text-[11px] font-extrabold"
            style={{ color: "var(--cd-faint)", background: "transparent" }}
          >
            <span>용역명</span>
            <span className="text-center">계약일</span>
            <span className="text-right">수주 금액</span>
          </div>

          <div className="h-[352px] shrink-0 overflow-y-auto scrollbar-hide">
            {loading && !data ? (
              <p className="py-10 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                수주 데이터를 불러오는 중…
              </p>
            ) : listRows.length === 0 ? (
              <p className="py-10 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
                조건에 맞는 수주 계약이 없습니다.
              </p>
            ) : (
              listRows.map((row) => (
                <div
                  key={row.contractId}
                  id={`cdb-order-row-${row.contractId}`}
                  className="cdb-list-row text-xs"
                  style={{ minHeight: 44 }}
                  data-selected={selectedContractId === row.contractId}
                  title="클릭하면 계약 관리에서 상세 정보를 확인합니다"
                  onClick={() => {
                    // 전체 기간 선택 시에는 계약일 기준 연도로 트리를 맞춘다
                    const treeYear =
                      year && /^\d{4}$/.test(year)
                        ? year
                        : row.contractDate?.slice(0, 4) ?? "";
                    setSelectedContractId(row.contractId);
                    // 돌아오기 위한 현재 필터/선택 상태 저장
                    try {
                      sessionStorage.setItem(
                        ORDERS_STATE_KEY,
                        JSON.stringify({
                          year,
                          category,
                          industryId,
                          sido,
                          contractId: row.contractId,
                        } satisfies SavedOrdersState)
                      );
                    } catch {
                      // sessionStorage 사용 불가 환경에서는 복원 없이 진행
                    }
                    router.push(
                      `/contracts?contract=${encodeURIComponent(row.contractId)}${treeYear ? `&year=${treeYear}` : ""}&from=billing-orders`
                    );
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold" style={{ color: "var(--cd-text)" }}>
                      {row.contractTitle}
                    </span>
                    <span className="block truncate text-[10px]" style={{ color: "var(--cd-faint)" }}>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                        style={{ background: CATEGORY_META[row.category]?.color ?? "var(--cd-faint)" }}
                      />
                      {row.counterpartyName || "-"}
                    </span>
                  </span>
                  <span className="text-center tabular-nums text-[11px]" style={{ color: "var(--cd-muted)" }}>
                    {row.contractDate ?? "-"}
                  </span>
                  <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                    {row.amount > 0 ? fmtFull(row.amount) : "-"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 연도별 수주 현황 추이 */}
        <YearlyTrendCard
          theme={theme}
          year={year}
          category={category}
          yearly={data?.yearly ?? []}
        />
        </div>
      </div>
    </div>
  );
}

function OrdersMapSummary({
  theme,
  year,
  sido,
  allRows,
  selectedRows,
  category,
}: {
  theme: CdTheme;
  year: string | null;
  sido: string | null;
  allRows: ContractOrdersStatusRow[];
  selectedRows: ContractOrdersStatusRow[];
  category: string | null;
}) {
  const pal = chartPalette(theme);
  const yearLabel = year === "all" ? "전체연도" : `${year ?? ""}년`;
  const regionLabel = sido ?? "전국";
  const totalAmount = allRows.reduce((acc, row) => acc + row.amount, 0);

  const categoryEntries = useMemo(() => {
    const countMap = new Map<string, number>();
    const amountMap = new Map<string, number>();
    for (const row of allRows) {
      countMap.set(row.category, (countMap.get(row.category) ?? 0) + 1);
      amountMap.set(row.category, (amountMap.get(row.category) ?? 0) + row.amount);
    }
    return DASHBOARD_CATEGORIES.map((cat) => ({
      label: cat,
      count: countMap.get(cat) ?? 0,
      amount: amountMap.get(cat) ?? 0,
      color: softCategoryColor(CATEGORY_META[cat]?.color ?? pal.faint, 0.12),
    })).filter((entry) => entry.count > 0 || entry.amount > 0);
  }, [allRows, pal.faint]);

  const subtypeEntries = useMemo(() => {
    if (!category) return [];
    const countMap = new Map<string, number>();
    const amountMap = new Map<string, number>();
    for (const row of selectedRows) {
      if (row.category !== category) continue;
      const label = row.serviceSubtype?.trim() || "기타";
      countMap.set(label, (countMap.get(label) ?? 0) + 1);
      amountMap.set(label, (amountMap.get(label) ?? 0) + row.amount);
    }
    return [...countMap.keys()]
      .map((label, idx) => ({
        label,
        count: countMap.get(label) ?? 0,
        amount: amountMap.get(label) ?? 0,
        color: softCategoryColor(SUBTYPE_DONUT_COLORS[idx % SUBTYPE_DONUT_COLORS.length], 0.08),
      }))
      .filter((entry) => entry.count > 0 || entry.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [selectedRows, category]);

  return (
    <div
      className="absolute right-4 bottom-4 w-[382px] rounded-3xl p-4 backdrop-blur-md"
      style={{
        background: theme === "dark" ? "rgba(29,37,48,0.84)" : "rgba(255,255,255,0.84)",
        border: "1px solid var(--cd-border)",
        boxShadow: theme === "dark" ? "0 8px 18px rgba(0,0,0,0.12)" : "0 8px 18px rgba(15,23,42,0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold tracking-[0.18em] uppercase" style={{ color: "var(--cd-primary)" }}>
            Orders Index
          </p>
          <p className="text-[15px] font-extrabold truncate" style={{ color: "var(--cd-text)" }}>
            {yearLabel} 수주 현황({regionLabel})
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-bold" style={{ color: "var(--cd-faint)" }}>
            총 수주액
          </p>
          <p className="text-[13px] font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>
            {totalAmount > 0 ? `${fmtCompact(totalAmount)}원` : "-"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniDonut
          theme={theme}
          title="용역별 수주 건수"
          labels={categoryEntries.map((entry) => entry.label)}
          legendLabels={categoryEntries.map((entry) => abbreviateCategory(entry.label))}
          series={categoryEntries.map((entry) => entry.count)}
          colors={categoryEntries.map((entry) => entry.color)}
          totalLabel={`${allRows.length.toLocaleString()}건`}
          tooltipSuffix="건"
        />
        <MiniDonut
          theme={theme}
          title="용역별 수주금액"
          labels={categoryEntries.map((entry) => entry.label)}
          legendLabels={categoryEntries.map((entry) => abbreviateCategory(entry.label))}
          series={categoryEntries.map((entry) => Math.round(entry.amount))}
          colors={categoryEntries.map((entry) => entry.color)}
          totalLabel={fmtCompact(totalAmount)}
          valueFormatter={(value) => fmtFull(value)}
        />
        <MiniDonut
          theme={theme}
          title="세분류별 수주 건수"
          labels={subtypeEntries.map((entry) => entry.label)}
          legendLabels={subtypeEntries.map((entry) => abbreviateSubtype(entry.label))}
          series={subtypeEntries.map((entry) => entry.count)}
          colors={subtypeEntries.map((entry) => entry.color)}
          totalLabel={
            category ? `${subtypeEntries.reduce((acc, entry) => acc + entry.count, 0).toLocaleString()}건` : "용역 선택"
          }
          tooltipSuffix="건"
          emptyLabel={category ? "데이터 없음" : "용역 선택 필요"}
        />
        <MiniDonut
          theme={theme}
          title="세분류별 수주금액"
          labels={subtypeEntries.map((entry) => entry.label)}
          legendLabels={subtypeEntries.map((entry) => abbreviateSubtype(entry.label))}
          series={subtypeEntries.map((entry) => Math.round(entry.amount))}
          colors={subtypeEntries.map((entry) => entry.color)}
          totalLabel={category ? fmtCompact(subtypeEntries.reduce((acc, entry) => acc + entry.amount, 0)) : "용역 선택"}
          valueFormatter={(value) => fmtFull(value)}
          emptyLabel={category ? "데이터 없음" : "용역 선택 필요"}
        />
      </div>
    </div>
  );
}

function MiniDonut({
  theme,
  title,
  labels,
  legendLabels,
  series,
  colors,
  totalLabel,
  tooltipSuffix,
  valueFormatter,
  emptyLabel = "데이터 없음",
}: {
  theme: CdTheme;
  title: string;
  labels: string[];
  legendLabels: string[];
  series: number[];
  colors: string[];
  totalLabel: string;
  tooltipSuffix?: string;
  valueFormatter?: (value: number) => string;
  emptyLabel?: string;
}) {
  const pal = chartPalette(theme);
  const total = series.reduce((acc, value) => acc + value, 0);
  const options = useMemo<ApexOptions>(
    () => ({
      chart: { type: "donut", fontFamily: "inherit", parentHeightOffset: 0, animations: { enabled: false } },
      labels,
      colors,
      stroke: { width: 2, colors: [theme === "dark" ? "#1d2530" : "#ffffff"] },
      fill: {
        type: "gradient",
        gradient: {
          shade: "light",
          type: "radial",
          shadeIntensity: 0.35,
          opacityFrom: 1,
          opacityTo: 0.78,
          stops: [0, 100],
        },
      },
      dataLabels: { enabled: false },
      legend: { show: false },
      plotOptions: {
        pie: {
          donut: {
            size: "72%",
            labels: {
              show: true,
              name: { show: false },
              value: {
                show: true,
                fontSize: "11px",
                fontWeight: 800,
                color: pal.text,
                formatter: () => totalLabel,
              },
              total: {
                show: true,
                showAlways: true,
                label: "",
                formatter: () => totalLabel,
              },
            },
          },
        },
      },
      tooltip: {
        theme: theme === "dark" ? "dark" : "light",
        y: {
          formatter: (value: number) =>
            valueFormatter ? valueFormatter(value) : `${Math.round(value).toLocaleString()}${tooltipSuffix ?? ""}`,
        },
      },
    }),
    [labels, colors, theme, pal.text, totalLabel, tooltipSuffix, valueFormatter]
  );

  return (
    <div className="rounded-2xl px-2 py-2" style={{ background: "var(--cd-surface)" }}>
      <p className="text-[10px] font-extrabold mb-1 truncate" style={{ color: "var(--cd-muted)" }}>
        {title}
      </p>
      {total <= 0 ? (
        <div className="h-[88px] flex items-center justify-center text-[10px] font-bold text-center px-2" style={{ color: "var(--cd-faint)" }}>
          {emptyLabel}
        </div>
      ) : (
        <div className="h-[88px] grid grid-cols-[74px_minmax(0,1fr)] items-center gap-1">
          <div className="-ml-1">
            <ApexChart
              key={`${theme}-${title}-${labels.join("|")}-${series.join("|")}`}
              options={options}
              series={series}
              type="donut"
              height={82}
            />
          </div>
          <div className="min-w-0 space-y-0.5">
            {legendLabels.slice(0, 5).map((label, idx) => {
              const pct = total > 0 ? Math.round((series[idx] / total) * 100) : 0;
              return (
                <div key={`${label}-${idx}`} className="flex items-center gap-1 min-w-0 text-[9px] leading-tight">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colors[idx] ?? "var(--cd-faint)" }} />
                  <span className="truncate font-bold" style={{ color: "var(--cd-muted)" }} title={labels[idx]}>
                    {label}
                  </span>
                  <span className="ml-auto tabular-nums font-bold" style={{ color: "var(--cd-faint)" }}>
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function abbreviateCategory(label: string): string {
  if (label.includes("통합")) return "통합";
  if (label.includes("장외") || label.includes("화관")) return "장외";
  if (label.includes("HAPs")) return "HAPs";
  if (label.includes("ESG") || label.includes("탄소")) return "ESG";
  return "기타";
}

function abbreviateSubtype(label: string): string {
  const normalized = label.replace(/\s+/g, "");
  const map: Array<[RegExp, string]> = [
    [/배출량조사/, "배출량"],
    [/배출저감계획/, "배출저감"],
    [/정기점검대응/, "정기점검"],
    [/HAPs연간|연간/, "연간"],
    [/변경허가|변경신고|변경/, "변경"],
    [/최초허가|최초/, "최초"],
    [/장외영향평가/, "장외"],
    [/설치검사/, "설치"],
    [/화관법기준/, "화관"],
    [/위해관리계획/, "위해"],
    [/영업허가/, "영업"],
    [/재검토/, "재검토"],
    [/안전진단/, "안전"],
    [/정기검사/, "정기"],
    [/판매업허가/, "판매"],
  ];
  for (const [pattern, short] of map) {
    if (pattern.test(normalized)) return short;
  }
  return Array.from(label.trim() || "기타").slice(0, 4).join("");
}
