"use client";

import { cn } from "@/lib/utils";
import type { FacilityListItem } from "@/lib/ieps/types-facility";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { formatCompanyName } from "@/lib/ieps/formatters";
import { FACILITY_SERVICE_COLORS, FACILITY_SERVICE_LABELS, type FacilityServiceCategory } from "@/lib/ieps/facility-service";

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
}: Props) {
  return (
    <section className="glass-panel rounded-3xl p-6 reveal delay-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-stone-700">
          사업장 ({total}건)
        </h3>
        <span className="text-[11px] text-stone-400 font-medium">
          표시 {items.length} / 전체 {total}
        </span>
      </div>

      {error && (
        <div className="text-red-600 text-sm font-bold mb-3">조회 실패: {error}</div>
      )}

      {loading && (
        <div className="text-stone-400 text-sm py-10 text-center">로딩 중…</div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="text-stone-400 text-sm py-10 text-center">
          조건에 맞는 사업장이 없습니다.
        </div>
      )}

      <div className="flex flex-col gap-1.5 max-h-[calc(100vh-380px)] overflow-y-auto">
        {items.map((f) => (
          <button
            key={f.facilityId}
            type="button"
            onClick={() => onSelect(f.facilityId)}
            className={cn(
              "text-left p-3 rounded-xl border transition-colors",
              selectedId === f.facilityId
                ? "bg-primary/10 border-primary/30"
                : "bg-white/40 hover:bg-white/70 border-white/50"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1 mb-1">
                  {(f.serviceCategories.length ? f.serviceCategories : ["integrated" as FacilityServiceCategory]).map((category) => (
                    <span
                      key={category}
                      className="rounded-full px-2 py-0.5 text-[9px] font-bold text-stone-800 border border-white/70"
                      style={{ background: FACILITY_SERVICE_COLORS[category] }}
                    >
                      {FACILITY_SERVICE_LABELS[category]}
                    </span>
                  ))}
                </div>
                <div className="text-sm font-bold text-stone-800 truncate flex items-center gap-2">
                  {formatCompanyName(f.companyName)}
                </div>
                <div className="text-[11px] text-stone-500 truncate mt-0.5">
                  {f.regionSido || "—"} {f.regionSigungu ?? ""}{" · "}
                  {f.industryCode || "—"} {f.industryName ?? ""}
                </div>
                <div className="text-[11px] text-stone-400 truncate mt-0.5">
                  {f.siteAddress ?? "주소 없음"}
                </div>
                {f.aliases[0] && (
                  <div className="text-[11px] text-stone-500 truncate mt-0.5">
                    별칭: {f.aliases[0].alias}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {f.decisionNo && (
                  <span className="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-full">
                    {f.decisionNo}
                  </span>
                )}
                <span className="text-[10px] text-stone-400">{f.permitsCount}건 허가</span>
              </div>
            </div>
            {(f.airClass != null || f.waterClass != null) && (
              <div className="flex items-center gap-2 mt-2 text-[10px] font-bold">
                {f.airClass != null && (
                  <span className="bg-stone-100 text-stone-700 px-2 py-0.5 rounded">
                    대기 {f.airClass}종
                  </span>
                )}
                {f.waterClass != null && (
                  <span className="bg-stone-100 text-stone-700 px-2 py-0.5 rounded">
                    수질 {f.waterClass}종
                  </span>
                )}
                {f.businessRegistrationNo && (
                  <span className="text-stone-400 ml-auto">{f.businessRegistrationNo}</span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
      <div className="pt-4 mt-3 border-t border-white/50">
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
