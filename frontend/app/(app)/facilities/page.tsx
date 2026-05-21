"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Factory, Plus, GitMerge, RefreshCw, Search, Filter as FilterIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { FacilityListPanel } from "@/components/facilities/FacilityListPanel";
import { FacilityDetailPanel } from "@/components/facilities/FacilityDetailPanel";
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

  const [filter, setFilter] = useState<FacilityListFilter>({
    q: "",
    sido: "",
    sigungu: "",
    industryCode: "",
    airClass: undefined,
    waterClass: undefined,
    source: "",
    sort: "recent",
    limit: 50,
    offset: 0,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.q) params.set("q", filter.q);
      if (filter.sido) params.set("sido", filter.sido);
      if (filter.sigungu) params.set("sigungu", filter.sigungu);
      if (filter.industryCode) params.set("industryCode", filter.industryCode);
      if (filter.airClass != null) params.set("airClass", String(filter.airClass));
      if (filter.waterClass != null) params.set("waterClass", String(filter.waterClass));
      if (filter.source) params.set("source", filter.source);
      if (filter.sort) params.set("sort", filter.sort);
      params.set("limit", String(filter.limit ?? 50));
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

  const sigunguOptionsForSido = useMemo(() => {
    if (!filters || !filter.sido) return filters?.sigungus ?? [];
    return filters.sigungus.filter((s) => s.sido === filter.sido);
  }, [filters, filter.sido]);

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
              <Factory className="w-7 h-7 text-primary" />
              사업장 마스터
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              IEPS 검토결과서에서 추출되거나 수동 등록된 사업장 마스터를 검색·열람·편집합니다.
              상세 패널에서 허가/종 규모/생산품/원본 첨부를 함께 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={reload}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
            >
              <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
            {canEdit && (
              <>
                <Link
                  href="/facilities/merge"
                  className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
                >
                  <GitMerge className="w-3.5 h-3.5" /> 중복 병합
                </Link>
                <Link
                  href="/facilities/new"
                  className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> 수동 등록
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      <section className="glass-card rounded-2xl p-4 reveal delay-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-stone-400" />
            <input
              type="text"
              className="input-field"
              placeholder="상호 / 사업자등록번호 / 주소 검색"
              value={filter.q ?? ""}
              onChange={(e) => setFilter({ ...filter, q: e.target.value, offset: 0 })}
            />
          </div>

          <FilterIcon className="w-4 h-4 text-stone-400 ml-2" />

          <select
            className="ui-select text-xs w-32"
            value={filter.sido ?? ""}
            onChange={(e) =>
              setFilter({ ...filter, sido: e.target.value, sigungu: "", offset: 0 })
            }
          >
            <option value="">전체 시도</option>
            {filters?.sidos.map((s) => (
              <option key={s.value} value={s.value}>
                {s.value} ({s.count})
              </option>
            ))}
          </select>

          <select
            className="ui-select text-xs w-32"
            value={filter.sigungu ?? ""}
            onChange={(e) => setFilter({ ...filter, sigungu: e.target.value, offset: 0 })}
            disabled={!filter.sido}
          >
            <option value="">전체 시군구</option>
            {sigunguOptionsForSido?.map((s) => (
              <option key={s.value + (s.sido ?? "")} value={s.value}>
                {s.value} ({s.count})
              </option>
            ))}
          </select>

          <select
            className="ui-select text-xs w-36"
            value={filter.industryCode ?? ""}
            onChange={(e) => setFilter({ ...filter, industryCode: e.target.value, offset: 0 })}
          >
            <option value="">전체 업종</option>
            {filters?.industries.slice(0, 50).map((i) => (
              <option key={i.code} value={i.code}>
                {i.code} {i.name ?? ""} ({i.count})
              </option>
            ))}
          </select>

          <select
            className="ui-select text-xs w-28"
            value={Number.isFinite(filter.airClass) ? filter.airClass : ""}
            onChange={(e) =>
              setFilter({
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
            className="ui-select text-xs w-28"
            value={Number.isFinite(filter.waterClass) ? filter.waterClass : ""}
            onChange={(e) =>
              setFilter({
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
            className="ui-select text-xs w-24"
            value={filter.source ?? ""}
            onChange={(e) => setFilter({ ...filter, source: e.target.value, offset: 0 })}
          >
            <option value="">출처</option>
            {filters?.sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.value === "ieps" ? "IEPS" : "수동"} ({s.count})
              </option>
            ))}
          </select>

          <select
            className="ui-select text-xs w-28"
            value={filter.sort ?? "recent"}
            onChange={(e) =>
              setFilter({ ...filter, sort: e.target.value as "recent" | "name", offset: 0 })
            }
          >
            <option value="recent">최신순</option>
            <option value="name">이름순</option>
          </select>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1.6fr] gap-6">
        <FacilityListPanel
          items={items}
          total={total}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          limit={filter.limit ?? 50}
          offset={filter.offset ?? 0}
          onPageChange={(nextOffset) => setFilter({ ...filter, offset: nextOffset })}
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
