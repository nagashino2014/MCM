"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Factory, Plus, GitMerge, ClipboardList, RefreshCw } from "lucide-react";
import { useSession } from "next-auth/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { FacilityListPanel } from "@/components/facilities/FacilityListPanel";
import { FacilityDetailPanel } from "@/components/facilities/FacilityDetailPanel";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import type {
  FacilityListItem,
  FacilityFilterOptions,
  FacilityListFilter,
} from "@/lib/ieps/types-facility";

export default function FacilitiesPage() {
  return (
    <ToastProvider>
      <Suspense fallback={<div className="p-6 text-stone-400 text-sm">불러오는 중…</div>}>
        <Inner />
      </Suspense>
    </ToastProvider>
  );
}

function Inner() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";

  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const [items, setItems] = useState<FacilityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FacilityFilterOptions | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const focusAppliedRef = useRef<string | null>(null);
  const toast = useToast();
  const { theme, toggleTheme } = useCdashTheme();

  const [filter, setFilter] = useState<FacilityListFilter>({
    q: "",
    sido: "",
    sidos: [],
    sigungu: "",
    industryCode: "",
    industryCategory: "",
    airClass: undefined,
    waterClass: undefined,
    source: "",
    sort: "recent",
    limit: 10,
    offset: 0,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.q) params.set("q", filter.q);
      const sidoList = (filter.sidos ?? []).filter(Boolean);
      if (sidoList.length > 0) {
        params.set("sidos", sidoList.join(","));
      } else {
        if (filter.sido) params.set("sido", filter.sido);
        if (filter.sigungu) params.set("sigungu", filter.sigungu);
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
      params.set("limit", String(filter.limit ?? 10));
      params.set("offset", String(filter.offset ?? 0));
      params.set("includeFilters", "1");
      const res = await fetch("/api/facilities?" + params.toString(), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as {
        items: FacilityListItem[];
        total: number;
        filters?: FacilityFilterOptions;
      };
      setItems(json.items || []);
      setTotal(json.total || 0);
      if (json.filters) setFilters(json.filters);
      if (selectedId && !(json.items || []).some((item) => item.facilityId === selectedId)) {
        setSelectedId(json.items?.[0]?.facilityId ?? null);
      } else if (!selectedId && (json.items?.length ?? 0) > 0) {
        setSelectedId(json.items[0].facilityId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, selectedId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ?focus=<id> 가 새로 들어오면 selectedId 를 강제 갱신 (모달 → /facilities 진입)
  useEffect(() => {
    if (!focusId) return;
    if (focusAppliedRef.current === focusId) return;
    focusAppliedRef.current = focusId;
    setSelectedId(focusId);
  }, [focusId]);

  return (
    <div
      className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl h-full min-h-0"
      data-theme={theme}
    >
      <CdPageHeader
        icon={<Factory className="w-5 h-5" />}
        eyebrow="Facility Master"
        title="사업장 마스터"
        subtitle="IEPS 검토결과서에서 추출되거나 수동 등록된 사업장 마스터를 검색·열람·편집합니다. 상세 패널에서 허가/종 규모/생산품/원본 첨부를 함께 확인할 수 있습니다."
        actions={
          <>
            <button
              type="button"
              onClick={reload}
              className="cd-btn cd-btn-ghost cd-btn-sm"
            >
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
            {canEdit && (
              <>
                <Link href="/facilities/missing" className="cd-btn cd-btn-ghost cd-btn-sm">
                  <ClipboardList className="w-3.5 h-3.5" /> 누락 점검
                </Link>
                <Link href="/facilities/merge" className="cd-btn cd-btn-ghost cd-btn-sm">
                  <GitMerge className="w-3.5 h-3.5" /> 중복 병합
                </Link>
                <Link href="/facilities/new" className="cd-btn cd-btn-primary cd-btn-sm">
                  <Plus className="w-3.5 h-3.5" /> 수동 등록
                </Link>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)] lg:grid-rows-[minmax(0,1fr)] gap-5 flex-1 min-h-0">
        <FacilityListPanel
          items={items}
          total={total}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          limit={filter.limit ?? 10}
          offset={filter.offset ?? 0}
          onPageChange={(nextOffset) => setFilter({ ...filter, offset: nextOffset })}
          filter={filter}
          filterOptions={filters}
          onFilterChange={(next) => setFilter(next)}
        />
        <FacilityDetailPanel
          facilityId={selectedId}
          canEdit={canEdit}
          onDeleted={() => {
            setSelectedId(null);
            setFilter({ ...filter, offset: 0 });
            reload();
            toast.show("사업장을 삭제했습니다.");
          }}
          onUpdated={() => {
            reload();
            toast.show("사업장 정보가 갱신되었습니다.");
          }}
        />
      </div>
    </div>
  );
}
