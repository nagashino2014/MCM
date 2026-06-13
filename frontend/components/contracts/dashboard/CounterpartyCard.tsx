"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { Search, ScanSearch } from "lucide-react";
import Link from "next/link";
import ApexChart from "./ApexChart";
import { CardFrame } from "./CardFrame";
import { FacilityOrdersModal } from "@/components/facilities/FacilityOrdersModal";
import {
  chartPalette,
  fmtFull,
  type CdTheme,
  type CounterpartyDetail,
  type CounterpartySearchItem,
} from "./types";

/**
 * 발주처 상세 — 업체명 검색 → 연도별 수주/매출 추이 + 기준연도 현황 + 수주실적 목록.
 */
export function CounterpartyCard({ theme, year }: { theme: CdTheme; year: string | null }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CounterpartySearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<CounterpartyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordersModalOpen, setOrdersModalOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // 검색 디바운스
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contracts/dashboard/counterparty?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items: CounterpartySearchItem[] };
        setItems(json.items);
        setOpen(true);
      } catch {
        // 검색 실패는 조용히 무시 (입력 중 일시 오류)
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const loadDetail = async (facilityId: string) => {
    selectedIdRef.current = facilityId;
    setLoadingDetail(true);
    setError(null);
    try {
      const params = new URLSearchParams({ facilityId });
      if (year) params.set("year", year);
      const res = await fetch(`/api/contracts/dashboard/counterparty?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setDetail((await res.json()) as CounterpartyDetail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  // 기준연도 변경 시 선택된 업체 상세 재조회
  useEffect(() => {
    if (selectedIdRef.current) loadDetail(selectedIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const pal = chartPalette(theme);
  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "55%", borderRadius: 3, borderRadiusApplication: "end" } },
      colors: [pal.primary, pal.accent],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3, padding: { left: 4, right: 0 } },
      legend: {
        position: "bottom",
        fontSize: "11px",
        fontWeight: 600,
        labels: { colors: pal.muted },
        markers: { size: 5 },
        itemMargin: { horizontal: 8 },
      },
      xaxis: {
        categories: detail?.yearly.map((y) => `${y.year}년`) ?? [],
        labels: { style: { colors: pal.muted, fontSize: "10px", fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { labels: { show: false } },
      tooltip: { theme: theme === "dark" ? "dark" : "light", y: { formatter: (v: number) => fmtFull(v) } },
    }),
    [theme, pal, detail]
  );

  const chartSeries = useMemo(
    () => [
      { name: "매출", data: detail?.yearly.map((y) => y.sales) ?? [] },
      { name: "수주", data: detail?.yearly.map((y) => y.orders) ?? [] },
    ],
    [detail]
  );

  return (
    <>
    <CardFrame
      area="cd-a-cpty"
      icon={<ScanSearch className="w-4 h-4" />}
      title="발주처 상세"
      delay={2}
      bodyClassName="gap-3"
      extra={
        <button
          type="button"
          className="cd-chip inline-flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontSize: "0.6875rem", padding: "0.3rem 0.6rem" }}
          disabled={!detail || !selectedIdRef.current}
          onClick={() => setOrdersModalOpen(true)}
        >
          수주/매출 상세
        </button>
      }
    >
      {/* 업체명 검색 */}
      <div ref={boxRef} className="relative shrink-0">
        <div className="relative">
          <Search
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--cd-faint)" }}
          />
          <input
            className="cd-input"
            style={{ paddingLeft: "2rem" }}
            placeholder="업체명 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => items.length > 0 && setOpen(true)}
          />
        </div>
        {open && items.length > 0 && (
          <div
            className="absolute z-20 mt-1 w-full rounded-xl overflow-hidden border max-h-52 overflow-y-auto scrollbar-hide"
            style={{ background: "var(--cd-card)", borderColor: "var(--cd-border)", boxShadow: "var(--cd-shadow)" }}
          >
            {items.map((item) => (
              <button
                key={item.facilityId}
                type="button"
                className="cd-row-hover w-full text-left px-3 py-2 text-xs font-bold flex items-center justify-between gap-2"
                style={{ color: "var(--cd-text)" }}
                onClick={() => {
                  setOpen(false);
                  setQuery(item.name);
                  loadDetail(item.facilityId);
                }}
              >
                <span className="truncate">{item.name}</span>
                <span className="tabular-nums shrink-0" style={{ color: "var(--cd-faint)" }}>
                  {item.contractCount}건
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!detail && !loadingDetail && (
        <div
          className="flex-1 rounded-xl flex items-center justify-center text-xs font-semibold text-center px-4 py-10"
          style={{ background: "var(--cd-surface)", color: "var(--cd-faint)" }}
        >
          업체명을 검색해 발주처를 선택하면
          <br />
          연도별 수주·매출 추이가 표시됩니다.
        </div>
      )}
      {loadingDetail && (
        <div
          className="flex-1 rounded-xl flex items-center justify-center text-xs font-semibold py-10 animate-pulse"
          style={{ background: "var(--cd-surface)", color: "var(--cd-faint)" }}
        >
          발주처 데이터를 불러오는 중…
        </div>
      )}
      {error && !loadingDetail && (
        <div
          className="flex-1 rounded-xl flex items-center justify-center text-xs font-semibold py-10"
          style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}
        >
          조회 실패: {error}
        </div>
      )}

      {detail && !loadingDetail && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* 연도별 추이 */}
          <div>
            <p className="text-[11px] font-bold mb-1" style={{ color: "var(--cd-faint)" }}>
              연도별 수주/매출 추이
            </p>
            <ApexChart options={chartOptions} series={chartSeries} type="bar" height={170} />
          </div>

          {/* 기준연도 현황 */}
          <div className="text-[11px] flex flex-col gap-1">
            <p className="font-bold" style={{ color: "var(--cd-faint)" }}>
              수주/매출 현황({detail.current.year}년)
            </p>
            <InfoRow label="업체명" value={detail.name} />
            <div className="grid grid-cols-2 gap-1">
              <InfoRow label="수주액" value={fmtFull(detail.current.orderAmount)} />
              <InfoRow label="매출액" value={fmtFull(detail.current.salesAmount)} />
              <InfoRow label="수주건수" value={`${detail.current.orderCount}건`} />
              <InfoRow label="주거래품목" value={detail.current.topCategory ?? "-"} />
            </div>
          </div>

          {/* 수주실적 상세 */}
          <div className="flex-1 min-h-0 flex flex-col text-[11px]">
            <p className="font-bold mb-1" style={{ color: "var(--cd-faint)" }}>
              수주실적 상세({detail.current.year}년)
            </p>
            <div
              className="grid grid-cols-[64px_1fr_72px] gap-x-2 px-2 py-1.5 rounded-lg font-bold"
              style={{ background: "var(--cd-surface)", color: "var(--cd-muted)" }}
            >
              <span>계약일</span>
              <span>계약명</span>
              <span className="text-right">계약금액</span>
            </div>
            <div className="mt-1 flex-1 overflow-y-auto scrollbar-hide min-h-[60px]">
              {detail.contracts.map((c) => (
                <Link
                  key={c.contractId}
                  href={`/contracts?focus=${encodeURIComponent(c.contractId)}`}
                  className="cd-row-hover grid grid-cols-[64px_1fr_72px] gap-x-2 items-center px-2 py-1.5 rounded-lg"
                >
                  <span className="tabular-nums" style={{ color: "var(--cd-faint)" }}>
                    {c.contractDate?.slice(2) ?? "-"}
                  </span>
                  <span className="truncate font-bold" style={{ color: "var(--cd-text)" }} title={c.contractTitle}>
                    {c.contractTitle}
                  </span>
                  <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                    {fmtFull(c.amount)}
                  </span>
                </Link>
              ))}
              {detail.contracts.length === 0 && (
                <p className="px-2 py-4 text-center" style={{ color: "var(--cd-faint)" }}>
                  해당 연도 수주실적이 없습니다.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </CardFrame>

    {/* 사업장 상세의 수주 버튼과 동일한 수주 모달 — reveal transform 의 containing block 영향을
        받지 않도록 카드(section.reveal) 밖에 렌더링한다 */}
    {ordersModalOpen && detail && selectedIdRef.current && (
      <FacilityOrdersModal
        facilityId={selectedIdRef.current}
        facilityName={detail.name}
        onClose={() => setOrdersModalOpen(false)}
      />
    )}
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="grid grid-cols-[64px_1fr] gap-2 items-center px-2.5 py-1.5 rounded-lg"
      style={{ background: "var(--cd-surface)" }}
    >
      <span className="font-bold" style={{ color: "var(--cd-muted)" }}>
        {label}
      </span>
      <span className="text-right font-extrabold truncate tabular-nums" style={{ color: "var(--cd-text)" }}>
        {value}
      </span>
    </div>
  );
}
