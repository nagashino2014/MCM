"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CdDropdown } from "@/components/cdash/CdDropdown";
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

/**
 * 필터 칩 — 비활성은 글라스 칩, 선택되면 그라데이션 채움 + × (해제).
 * 드롭다운 트리거로 쓸 때는 onClick 없이(부모 CdDropdown 이 클릭을 받음) 라벨만 바꾼다.
 */
function FilterChip({
  label,
  active,
  onClick,
  onClear,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  onClear?: () => void;
}) {
  return (
    <span className="cd-chip cd-chip-sm shrink-0" data-active={active || undefined} onClick={onClick} role="button">
      <span className="truncate max-w-[150px]">{label}</span>
      {onClear ? (
        <X
          className="w-3 h-3 opacity-80 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          aria-label={`${label} 필터 해제`}
        />
      ) : (
        !onClick && <ChevronDown className="w-3 h-3 opacity-50" />
      )}
    </span>
  );
}

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

  // 지역은 칩 다중 선택으로 통일 — "복수 지역 선택" 체크박스 + 읽기전용 슬롯 input 조합을
  // 폐지하고 sidos 배열을 직접 다룬다(선택하면 칩 추가, × 로 제거).
  const MAX_REGIONS = 5;
  const selectedSidos = useMemo(
    () => (filter.sidos ?? []).filter(Boolean).concat(filter.sido ? [filter.sido] : []),
    [filter.sidos, filter.sido]
  );

  const applySidos = (next: string[]) => {
    const sidos = Array.from(new Set(next.filter(Boolean))).slice(0, MAX_REGIONS);
    onFilterChange({ ...filter, sidos, sido: "", sigungu: "", offset: 0 });
  };

  const toggleIntegratedMode = () => {
    setIntegratedMode((v) => !v);
    onFilterChange({ ...filter, industryCode: "", industryCategory: "", offset: 0 });
  };

  const industryLabel = integratedMode
    ? INTEGRATED_PERMIT_INDUSTRIES.find((c) => c.id === filter.industryCategory)?.label
    : filterOptions?.industries.find((i) => String(i.code) === filter.industryCode)?.code;

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

      {/* 필터 = 검색 + 필터 칩(선택 시 그라데이션 채움 + ×).
          select 나열 + 체크박스 조합은 앱에서 가장 노후한 표면이었다(분석 §2 /facilities). */}
      <div className="flex flex-col gap-2.5 mb-4">
        <div className="flex items-center gap-2 rounded-xl border cd-line-c cd-surface-bg px-3 py-1.5">
          <Search className="w-4 h-4 cd-text-faint shrink-0" />
          <input
            type="text"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] cd-text placeholder:text-[color:var(--cd-faint)]"
            placeholder="상호 / 사업자등록번호 / 주소 검색"
            value={filter.q ?? ""}
            onChange={(e) => onFilterChange({ ...filter, q: e.target.value, offset: 0 })}
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 지역 — 최대 5개 다중 선택, 각 선택은 개별 칩. */}
          {selectedSidos.map((s) => (
            <FilterChip key={s} active label={s} onClear={() => applySidos(selectedSidos.filter((v) => v !== s))} />
          ))}
          {selectedSidos.length < MAX_REGIONS && (
            <CdDropdown
              align="left"
              menuWidthClass="w-56"
              trigger={() => <FilterChip label={selectedSidos.length ? "지역 추가" : "지역"} />}
              items={(filterOptions?.sidos ?? [])
                .filter((s) => !selectedSidos.includes(s.value))
                .map((s) => ({
                  key: s.value,
                  label: `${s.value} (${s.count})`,
                  onSelect: () => applySidos([...selectedSidos, s.value]),
                }))}
            />
          )}

          {/* 업종 — 통합허가 기준 토글에 따라 20개 카테고리 / 원본 코드. */}
          <CdDropdown
            align="left"
            menuWidthClass="w-64"
            trigger={() => (
              <FilterChip
                active={!!industryLabel}
                label={industryLabel ?? "업종"}
                onClear={
                  industryLabel
                    ? () => onFilterChange({ ...filter, industryCode: "", industryCategory: "", offset: 0 })
                    : undefined
                }
              />
            )}
            items={
              integratedMode
                ? INTEGRATED_PERMIT_INDUSTRIES.map((c) => ({
                    key: c.id,
                    label: `${c.label} (${categoryCounts.get(c.id) ?? 0})`,
                    onSelect: () => onFilterChange({ ...filter, industryCategory: c.id, industryCode: "", offset: 0 }),
                  }))
                : (filterOptions?.industries ?? []).slice(0, 50).map((i) => ({
                    key: String(i.code),
                    label: `${i.code} ${i.name ?? ""} (${i.count})`,
                    onSelect: () =>
                      onFilterChange({ ...filter, industryCode: String(i.code), industryCategory: "", offset: 0 }),
                  }))
            }
          />
          <FilterChip active={integratedMode} label="통합허가 기준" onClick={toggleIntegratedMode} />

          {/* 종 규모 · 출처 */}
          <CdDropdown
            align="left"
            menuWidthClass="w-40"
            trigger={() => (
              <FilterChip
                active={filter.airClass != null}
                label={filter.airClass != null ? `대기 ${filter.airClass}종` : "대기 종"}
                onClear={filter.airClass != null ? () => onFilterChange({ ...filter, airClass: undefined, offset: 0 }) : undefined}
              />
            )}
            items={[1, 2, 3, 4, 5].map((c) => ({
              key: String(c),
              label: `대기 ${c}종`,
              onSelect: () => onFilterChange({ ...filter, airClass: c, offset: 0 }),
            }))}
          />
          <CdDropdown
            align="left"
            menuWidthClass="w-40"
            trigger={() => (
              <FilterChip
                active={filter.waterClass != null}
                label={filter.waterClass != null ? `수질 ${filter.waterClass}종` : "수질 종"}
                onClear={
                  filter.waterClass != null ? () => onFilterChange({ ...filter, waterClass: undefined, offset: 0 }) : undefined
                }
              />
            )}
            items={[1, 2, 3, 4, 5].map((c) => ({
              key: String(c),
              label: `수질 ${c}종`,
              onSelect: () => onFilterChange({ ...filter, waterClass: c, offset: 0 }),
            }))}
          />
          <CdDropdown
            align="left"
            menuWidthClass="w-48"
            trigger={() => (
              <FilterChip
                active={!!filter.source}
                label={filter.source ? SOURCE_LABELS[filter.source] ?? filter.source : "출처"}
                onClear={filter.source ? () => onFilterChange({ ...filter, source: "", offset: 0 }) : undefined}
              />
            )}
            items={(filterOptions?.sources ?? []).map((s) => ({
              key: s.value,
              label: `${SOURCE_LABELS[s.value] ?? s.value} (${s.count})`,
              onSelect: () => onFilterChange({ ...filter, source: s.value, offset: 0 }),
            }))}
          />

          {/* 내보내기 — 수주/수금/발행 현황 리스트와 같은 엑셀·PDF 아이콘 2개(30px). */}
          <div className="ml-auto shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleExport("xlsx")}
              disabled={exporting !== null}
              title="현재 검색 결과를 엑셀로 다운로드"
              className={cn("flex items-center justify-center disabled:opacity-40", exporting !== null && "cursor-wait")}
              style={{ width: 30, height: 30 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
            </button>
            <button
              type="button"
              onClick={() => handleExport("pdf")}
              disabled={exporting !== null}
              title="현재 검색 결과를 PDF로 다운로드"
              className={cn("flex items-center justify-center disabled:opacity-40", exporting !== null && "cursor-wait")}
              style={{ width: 30, height: 30 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
            </button>
          </div>
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
            {/* 3층 제한(Soft Glass Ink): 태그 / 상호 / 지역·업종.
                주소·별칭·허가건수·사업자번호 5층 적재는 밀도만 높고 위계가 없었다(분석 §2 /facilities).
                가려진 값은 title 툴팁으로 남긴다. */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1 mb-1">
                  {(f.serviceCategories.length ? f.serviceCategories : ["integrated" as FacilityServiceCategory]).map((category) => (
                    <span
                      key={category}
                      className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                      style={{
                        background: `color-mix(in srgb, ${FACILITY_SERVICE_COLORS[category]} 55%, transparent)`,
                        color: "var(--cd-body)",
                      }}
                    >
                      {FACILITY_SERVICE_LABELS[category]}
                    </span>
                  ))}
                </div>
                <div
                  className="flex min-w-0 items-center gap-1.5 text-[14.5px] font-extrabold tracking-[-0.01em]"
                  style={{ color: "var(--cd-text)" }}
                  title={f.siteAddress ?? undefined}
                >
                  <span className="min-w-0 truncate">{formatCompanyName(f.companyName)}</span>
                  {f.isClosed && (
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-3 cd-error-bg cd-error-text">
                      폐업
                    </span>
                  )}
                </div>
                <div className="text-[11.5px] truncate mt-0.5" style={{ color: "var(--cd-faint)" }}>
                  {f.regionSido || "—"} {f.regionSigungu ?? ""}{" · "}
                  {f.industryCode || "—"} {f.industryName ?? ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="flex items-center gap-1">
                  {f.airClass != null && (
                    <span className="cd-pill cd-pill-secondary text-[10px]">대기 {f.airClass}종</span>
                  )}
                  {f.waterClass != null && (
                    <span className="cd-pill cd-pill-info text-[10px]">수질 {f.waterClass}종</span>
                  )}
                </span>
                {f.decisionNo && <span className="text-[10px] cd-text-faint tabular-nums">{f.decisionNo}</span>}
              </div>
            </div>
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
