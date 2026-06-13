"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  FacilityFilterOptions,
  FacilityListFilter,
  FacilityListItem,
} from "@/lib/ieps/types-facility";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { formatCompanyName } from "@/lib/ieps/formatters";
import { FACILITY_SERVICE_COLORS, FACILITY_SERVICE_LABELS, type FacilityServiceCategory } from "@/lib/ieps/facility-service";
import {
  INTEGRATED_PERMIT_INDUSTRIES,
  industryCodeMatchesCategory,
} from "@/lib/ieps/integrated-permit-industries";
import { filenameFromDisposition } from "@/lib/client-download";

const SOURCE_LABELS: Record<string, string> = {
  ieps: "IEPS",
  manual: "수동 등록",
  legal_entity: "계약현황",
};

interface Props {
  items: FacilityListItem[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  limit: number;
  offset: number;
  onPageChange: (offset: number) => void;
  filter: FacilityListFilter;
  filterOptions: FacilityFilterOptions | null;
  onFilterChange: (next: FacilityListFilter) => void;
}

export function FacilityListPanel({
  items,
  total,
  loading,
  error,
  selectedId,
  onSelect,
  limit,
  offset,
  onPageChange,
  filter,
  filterOptions,
  onFilterChange,
}: Props) {
  const [multiRegion, setMultiRegion] = useState(false);
  const [regionSlots, setRegionSlots] = useState<string[]>([""]);
  const [activeSlotIdx, setActiveSlotIdx] = useState(0);
  const [integratedMode, setIntegratedMode] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  // 통합허가 20개 업종별 사업장 수: 필터 옵션의 코드별 건수를 카테고리에 합산.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of filterOptions?.industries ?? []) {
      const codes = String(entry.code)
        .split(/[\n,/]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      for (const category of INTEGRATED_PERMIT_INDUSTRIES) {
        if (codes.some((code) => industryCodeMatchesCategory(code, category))) {
          counts.set(category.id, (counts.get(category.id) ?? 0) + entry.count);
        }
      }
    }
    return counts;
  }, [filterOptions]);

  const applyRegionSlots = (slots: string[]) => {
    const sidos = Array.from(new Set(slots.map((s) => s.trim()).filter(Boolean)));
    onFilterChange({ ...filter, sidos, sido: "", sigungu: "", offset: 0 });
  };

  const toggleMultiRegion = (checked: boolean) => {
    setMultiRegion(checked);
    if (checked) {
      const slots = filter.sido ? [filter.sido] : [""];
      setRegionSlots(slots);
      setActiveSlotIdx(slots.length - 1);
      applyRegionSlots(slots);
    } else {
      setRegionSlots([""]);
      setActiveSlotIdx(0);
      onFilterChange({ ...filter, sidos: [], sido: "", sigungu: "", offset: 0 });
    }
  };

  const handleSidoSelect = (value: string) => {
    if (!multiRegion) {
      onFilterChange({ ...filter, sido: value, sigungu: "", offset: 0 });
      return;
    }
    // 비어 있는 박스가 있으면 왼쪽부터 채우고, 모두 차 있으면 현재 선택된 박스를 교체한다.
    const emptyIdx = regionSlots.findIndex((slot) => !slot.trim());
    const targetIdx = emptyIdx !== -1 ? emptyIdx : activeSlotIdx;
    const slots = regionSlots.map((slot, idx) => (idx === targetIdx ? value : slot));
    setRegionSlots(slots);
    setActiveSlotIdx(targetIdx);
    applyRegionSlots(slots);
  };

  const MAX_REGION_SLOTS = 5;

  const addRegionSlot = () => {
    if (regionSlots.length >= MAX_REGION_SLOTS) return;
    const slots = [...regionSlots, ""];
    setRegionSlots(slots);
    setActiveSlotIdx(slots.length - 1);
  };

  const removeRegionSlot = (idx: number) => {
    const slots = regionSlots.filter((_, slotIdx) => slotIdx !== idx);
    const next = slots.length ? slots : [""];
    setRegionSlots(next);
    setActiveSlotIdx(Math.min(activeSlotIdx, next.length - 1));
    applyRegionSlots(next);
  };

  const toggleIntegratedMode = (checked: boolean) => {
    setIntegratedMode(checked);
    onFilterChange({ ...filter, industryCode: "", industryCategory: "", offset: 0 });
  };

  const activeSidoValue = multiRegion ? regionSlots[activeSlotIdx] ?? "" : filter.sido ?? "";

  const buildExportParams = (format: "xlsx" | "pdf") => {
    const params = new URLSearchParams();
    if (filter.q) params.set("q", filter.q);
    const sidoList = (filter.sidos ?? []).filter(Boolean);
    if (sidoList.length > 0) {
      params.set("sidos", sidoList.join(","));
    } else if (filter.sido) {
      params.set("sido", filter.sido);
    }
    if (filter.industryCategory) {
      params.set("industryCategory", filter.industryCategory);
    } else if (filter.industryCode) {
      params.set("industryCode", filter.industryCode);
    }
    if (filter.airClass != null) params.set("airClass", String(filter.airClass));
    if (filter.waterClass != null) params.set("waterClass", String(filter.waterClass));
    if (filter.source) params.set("source", filter.source);
    if (filter.sort) params.set("sort", filter.sort);
    params.set("format", format);
    return params;
  };

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(format);
    try {
      const res = await fetch("/api/facilities/export?" + buildExportParams(format).toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `사업장목록_${stamp}.${format}`);
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
    <section className="cd-card p-5 cd-reveal flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="cd-card-title">사업장 ({total}건)</h3>
        <span className="text-[11px] cd-text-faint font-medium">
          표시 {items.length} / 전체 {total}
        </span>
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 cd-text-faint shrink-0" />
          <input
            type="text"
            className="cd-input"
            placeholder="상호 / 사업자등록번호 / 주소 검색"
            value={filter.q ?? ""}
            onChange={(e) => onFilterChange({ ...filter, q: e.target.value, offset: 0 })}
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <select
            className="cd-select text-xs shrink-0"
            style={{ width: 170 }}
            value={activeSidoValue}
            onChange={(e) => handleSidoSelect(e.target.value)}
          >
            <option value="">전체 시도</option>
            {filterOptions?.sidos.map((s) => (
              <option key={s.value} value={s.value}>
                {s.value} ({s.count})
              </option>
            ))}
          </select>

          <label
            className="flex items-center gap-1 text-[11px] font-bold cd-text-muted select-none shrink-0"
            style={{ width: 110 }}
          >
            <input
              type="checkbox"
              checked={multiRegion}
              onChange={(e) => toggleMultiRegion(e.target.checked)}
            />
            복수 지역 선택
          </label>

          {multiRegion && (
            <>
              {regionSlots.map((slot, idx) => (
                <input
                  key={idx}
                  type="text"
                  readOnly
                  value={slot}
                  placeholder="지역 선택"
                  title="우클릭으로 삭제"
                  onClick={() => setActiveSlotIdx(idx)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    removeRegionSlot(idx);
                  }}
                  className="cd-input text-xs cursor-pointer shrink-0"
                  style={{
                    width: 104,
                    borderColor: idx === activeSlotIdx ? "var(--cd-primary)" : "var(--cd-border)",
                    boxShadow: idx === activeSlotIdx ? "0 0 0 2px rgba(93,135,255,0.25)" : "none",
                    color: idx === activeSlotIdx ? "var(--cd-text)" : "var(--cd-muted)",
                  }}
                />
              ))}
              {regionSlots.length < MAX_REGION_SLOTS && (
                <button
                  type="button"
                  onClick={addRegionSlot}
                  title="검색 지역 추가"
                  className="cd-btn cd-btn-ghost cd-btn-sm shrink-0"
                  style={{ padding: "0.45rem" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          {!integratedMode ? (
            <select
              className="cd-select text-xs shrink-0"
              style={{ width: 170 }}
              value={filter.industryCode ?? ""}
              onChange={(e) =>
                onFilterChange({ ...filter, industryCode: e.target.value, industryCategory: "", offset: 0 })
              }
            >
              <option value="">전체 업종</option>
              {filterOptions?.industries.slice(0, 50).map((i) => (
                <option key={i.code} value={i.code}>
                  {i.code} {i.name ?? ""} ({i.count})
                </option>
              ))}
            </select>
          ) : (
            <select
              className="cd-select text-xs shrink-0"
              style={{ width: 170 }}
              value={filter.industryCategory ?? ""}
              onChange={(e) =>
                onFilterChange({ ...filter, industryCategory: e.target.value, industryCode: "", offset: 0 })
              }
            >
              <option value="">전체 업종</option>
              {INTEGRATED_PERMIT_INDUSTRIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label} ({categoryCounts.get(category.id) ?? 0})
                </option>
              ))}
            </select>
          )}

          <label
            className="flex items-center gap-1 text-[11px] font-bold cd-text-muted select-none shrink-0"
            style={{ width: 110 }}
          >
            <input
              type="checkbox"
              checked={integratedMode}
              onChange={(e) => toggleIntegratedMode(e.target.checked)}
            />
            통합허가 기준
          </label>

          <select
            className="cd-select text-xs shrink-0"
            style={{ width: 96 }}
            value={Number.isFinite(filter.airClass) ? filter.airClass : ""}
            onChange={(e) =>
              onFilterChange({
                ...filter,
                airClass: e.target.value ? Number(e.target.value) : undefined,
                offset: 0,
              })
            }
          >
            <option value="">대기 종</option>
            {[1, 2, 3, 4, 5].map((c) => (
              <option key={c} value={c}>
                대기 {c}종
              </option>
            ))}
          </select>

          <select
            className="cd-select text-xs shrink-0"
            style={{ width: 96 }}
            value={Number.isFinite(filter.waterClass) ? filter.waterClass : ""}
            onChange={(e) =>
              onFilterChange({
                ...filter,
                waterClass: e.target.value ? Number(e.target.value) : undefined,
                offset: 0,
              })
            }
          >
            <option value="">수질 종</option>
            {[1, 2, 3, 4, 5].map((c) => (
              <option key={c} value={c}>
                수질 {c}종
              </option>
            ))}
          </select>

          <select
            className="cd-select text-xs shrink-0"
            style={{ width: 130 }}
            value={filter.source ?? ""}
            onChange={(e) => onFilterChange({ ...filter, source: e.target.value, offset: 0 })}
          >
            <option value="">출처</option>
            {filterOptions?.sources.map((s) => (
              <option key={s.value} value={s.value}>
                {SOURCE_LABELS[s.value] ?? s.value} ({s.count})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => handleExport("xlsx")}
            disabled={exporting !== null}
            title="현재 검색 결과를 엑셀로 다운로드"
            className={cn(
              "shrink-0 flex items-center justify-center ml-auto",
              exporting !== null && "opacity-50 cursor-wait"
            )}
            style={{ width: 44, height: 44 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
          </button>
          <button
            type="button"
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
            title="현재 검색 결과를 PDF로 다운로드"
            className={cn(
              "shrink-0 flex items-center justify-center",
              exporting !== null && "opacity-50 cursor-wait"
            )}
            style={{ width: 44, height: 44 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm font-bold mb-3" style={{ color: "var(--cd-error)" }}>
          조회 실패: {error}
        </div>
      )}

      {loading && (
        <div className="cd-text-faint text-sm py-10 text-center">로딩 중…</div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="cd-text-faint text-sm py-10 text-center">
          조건에 맞는 사업장이 없습니다.
        </div>
      )}

      <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {items.map((f) => (
          <button
            key={f.facilityId}
            type="button"
            onClick={() => onSelect(f.facilityId)}
            className="text-left p-3 rounded-xl cd-listitem"
            data-active={selectedId === f.facilityId}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1 mb-1">
                  {(f.serviceCategories.length ? f.serviceCategories : ["integrated" as FacilityServiceCategory]).map((category) => (
                    <span
                      key={category}
                      className="rounded-full px-2 py-0.5 text-[9px] font-bold text-stone-800 border border-black/5"
                      style={{ background: FACILITY_SERVICE_COLORS[category] }}
                    >
                      {FACILITY_SERVICE_LABELS[category]}
                    </span>
                  ))}
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold" style={{ color: "var(--cd-text)" }}>
                  <span className="min-w-0 truncate">{formatCompanyName(f.companyName)}</span>
                  {f.isClosed && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-3 text-white"
                      style={{ backgroundColor: "#FF7979" }}
                    >
                      폐업사업장
                    </span>
                  )}
                </div>
                <div className="text-[11px] cd-text-muted truncate mt-0.5">
                  {f.regionSido || "—"} {f.regionSigungu ?? ""}{" · "}
                  {f.industryCode || "—"} {f.industryName ?? ""}
                </div>
                <div className="text-[11px] cd-text-faint truncate mt-0.5">
                  {f.siteAddress ?? "주소 없음"}
                </div>
                {f.aliases[0] && (
                  <div className="text-[11px] cd-text-muted truncate mt-0.5">
                    별칭: {f.aliases[0].alias}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {f.decisionNo && (
                  <span className="cd-pill cd-pill-info">{f.decisionNo}</span>
                )}
                <span className="text-[10px] cd-text-faint">{f.permitsCount}건 허가</span>
              </div>
            </div>
            {(f.airClass != null || f.waterClass != null) && (
              <div className="flex items-center gap-2 mt-2 text-[10px] font-bold">
                {f.airClass != null && (
                  <span className="cd-pill cd-pill-outline">대기 {f.airClass}종</span>
                )}
                {f.waterClass != null && (
                  <span className="cd-pill cd-pill-outline">수질 {f.waterClass}종</span>
                )}
                {f.businessRegistrationNo && (
                  <span className="cd-text-faint ml-auto">{f.businessRegistrationNo}</span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
      <div className="pt-4 mt-3 border-t shrink-0" style={{ borderColor: "var(--cd-border)" }}>
        <PaginationControls
          total={total}
          limit={limit}
          offset={offset}
          loading={loading}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}
