"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSignature,
  MapPin,
  Phone,
  Search,
  Smartphone,
  X,
} from "lucide-react";
import { Empty, ErrorBox, Loading, MobileSheet, SheetRow } from "./mobile-shared";

// 모바일 사업장 탐색 (C안 하이브리드):
// - 초기 화면: 검색창 + 최근 본 사업장(localStorage) + 관계 카드(용역/영업 진행 중) + 업종별 카운트 그리드
// - 검색/필터 모드: 필터 칩([업종][지역][관계] 바텀시트 멀티선택) + N곳 헤더 + 리스트 + 더보기(30건)

const PAGE_SIZE = 30;
const RECENT_KEY = "mcm-recent-facilities";
const RECENT_MAX = 5;

interface FacilityItem {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
  phoneNumber: string | null;
  industryName: string | null;
  representativeName: string | null;
  airClass: number | null;
  waterClass: number | null;
}

interface ContactPerson {
  id: number;
  personName: string;
  title: string | null;
  departmentName?: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  status: string;
}

interface BrowseStats {
  industries: { id: string; label: string; count: number }[];
  contractActive: number;
  salesActive: number;
}

interface RecentFacility {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
}

interface Filters {
  industries: string[];
  sidos: string[];
  engagement: ("contract" | "sales")[];
}

const EMPTY_FILTERS: Filters = { industries: [], sidos: [], engagement: [] };
const ENGAGEMENT_LABEL: Record<string, string> = { contract: "용역 진행 중", sales: "영업 진행 중" };

function loadRecent(): RecentFacility[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as RecentFacility[]) : [];
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(f: RecentFacility) {
  try {
    const list = [f, ...loadRecent().filter((x) => x.facilityId !== f.facilityId)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // localStorage 불가 환경은 조용히 무시
  }
}

export function MobileFacilities() {
  const [q, setQ] = useState(""); // 입력값
  const [appliedQ, setAppliedQ] = useState(""); // 검색 실행된 값
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [items, setItems] = useState<FacilityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FacilityItem | null>(null);

  const [stats, setStats] = useState<BrowseStats | null>(null);
  const [recent, setRecent] = useState<RecentFacility[]>([]);
  const [sidoOptions, setSidoOptions] = useState<{ value: string; count: number }[]>([]);
  const [sheetKind, setSheetKind] = useState<"industry" | "region" | "engagement" | null>(null);

  const browseMode = !appliedQ && !filters.industries.length && !filters.sidos.length && !filters.engagement.length;
  const offsetRef = useRef(0);

  // 초기 데이터 — 브라우즈 카운트 + 최근 본 + 지역 옵션(필터 시트용, 1회)
  useEffect(() => {
    setRecent(loadRecent());
    (async () => {
      try {
        const [statsRes, filtersRes] = await Promise.all([
          fetch("/api/facilities/browse-stats", { cache: "no-store" }),
          fetch("/api/facilities?limit=1&includeFilters=1", { cache: "no-store" }),
        ]);
        if (statsRes.ok) setStats((await statsRes.json()) as BrowseStats);
        if (filtersRes.ok) {
          const data = await filtersRes.json();
          setSidoOptions(Array.isArray(data.filters?.sidos) ? data.filters.sidos : []);
        }
      } catch {
        // 카운트 실패해도 검색은 동작
      }
    })();
  }, []);

  const buildParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort });
      if (appliedQ) params.set("q", appliedQ);
      if (filters.industries.length) params.set("industryCategories", filters.industries.join(","));
      if (filters.sidos.length) params.set("sidos", filters.sidos.join(","));
      if (filters.engagement.length) params.set("engagement", filters.engagement.join(","));
      return params;
    },
    [appliedQ, filters, sort]
  );

  // 검색/필터/정렬 변경 시 첫 페이지 로드
  useEffect(() => {
    if (browseMode) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      offsetRef.current = 0;
      try {
        const res = await fetch(`/api/facilities?${buildParams(0)}`, { cache: "no-store" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total ?? 0));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [browseMode, buildParams]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = offsetRef.current + PAGE_SIZE;
      const res = await fetch(`/api/facilities?${buildParams(next)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      offsetRef.current = next;
      setItems((prev) => [...prev, ...(Array.isArray(data.items) ? data.items : [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const openFacility = (f: FacilityItem) => {
    setSelected(f);
    pushRecent({ facilityId: f.facilityId, companyName: f.companyName, siteAddress: f.siteAddress });
    setRecent(loadRecent());
  };

  const openRecent = async (r: RecentFacility) => {
    // 최근 항목은 요약 필드가 없어 검색으로 최신 정보를 가져와 시트를 연다
    try {
      const res = await fetch(`/api/facilities?q=${encodeURIComponent(r.companyName)}&limit=5`, { cache: "no-store" });
      const data = await res.json();
      const hit = (data.items as FacilityItem[] | undefined)?.find((x) => x.facilityId === r.facilityId);
      if (hit) {
        openFacility(hit);
        return;
      }
    } catch {
      // 폴백으로 최소 정보 시트
    }
    setSelected({
      facilityId: r.facilityId, companyName: r.companyName, siteAddress: r.siteAddress,
      phoneNumber: null, industryName: null, representativeName: null, airClass: null, waterClass: null,
    });
  };

  const resetAll = () => {
    setQ("");
    setAppliedQ("");
    setFilters(EMPTY_FILTERS);
    setItems([]);
    setTotal(0);
  };

  const filterChipLabel = (kind: "industry" | "region" | "engagement"): string => {
    if (kind === "industry") {
      if (!filters.industries.length) return "업종";
      const first = stats?.industries.find((i) => i.id === filters.industries[0])?.label ?? filters.industries[0];
      return filters.industries.length > 1 ? `${first} 외 ${filters.industries.length - 1}` : first;
    }
    if (kind === "region") {
      if (!filters.sidos.length) return "지역";
      return filters.sidos.length > 1 ? `${filters.sidos[0]} 외 ${filters.sidos.length - 1}` : filters.sidos[0];
    }
    if (!filters.engagement.length) return "관계";
    return filters.engagement.map((e) => ENGAGEMENT_LABEL[e]).join("·");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 검색 */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQ(q.trim());
        }}
      >
        <input
          className="cd-input flex-1"
          style={{ height: 42 }}
          placeholder="사업장명·주소 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="cd-btn cd-btn-primary shrink-0" style={{ height: 42 }} aria-label="검색">
          <Search className="w-4 h-4" />
        </button>
      </form>

      {error && <ErrorBox message={error} />}

      {browseMode ? (
        /* ── 초기(브라우즈) 화면 ─────────────────────────── */
        <>
          {recent.length > 0 && (
            <section>
              <h2 className="cd-text-muted text-xs font-bold mb-1.5 px-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> 최근 본 사업장
              </h2>
              <div className="flex flex-col gap-1.5">
                {recent.map((r) => (
                  <button key={r.facilityId} className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-2.5 flex items-center gap-2 text-left" onClick={() => openRecent(r)}>
                    <div className="flex-1 min-w-0">
                      <div className="cd-text text-sm font-bold truncate">{r.companyName}</div>
                      <div className="cd-text-faint text-xs truncate">{r.siteAddress ?? "—"}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 관계 상태 바로가기 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-left"
              onClick={() => setFilters({ ...EMPTY_FILTERS, engagement: ["contract"] })}
            >
              <FileSignature className="w-4.5 h-4.5 cd-text-primary shrink-0" style={{ width: 18, height: 18 }} />
              <div className="min-w-0">
                <div className="cd-text text-sm font-bold">용역 진행 중</div>
                <div className="cd-text-faint text-xs">{stats ? `${stats.contractActive}곳` : "…"}</div>
              </div>
            </button>
            <button
              className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-left"
              onClick={() => setFilters({ ...EMPTY_FILTERS, engagement: ["sales"] })}
            >
              <Briefcase className="w-4.5 h-4.5 cd-text-primary shrink-0" style={{ width: 18, height: 18 }} />
              <div className="min-w-0">
                <div className="cd-text text-sm font-bold">영업 진행 중</div>
                <div className="cd-text-faint text-xs">{stats ? `${stats.salesActive}곳` : "…"}</div>
              </div>
            </button>
          </div>

          {/* 업종별 그리드 */}
          <section>
            <h2 className="cd-text-muted text-xs font-bold mb-1.5 px-1">업종별 보기</h2>
            {!stats ? (
              <Loading />
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {stats.industries
                  .filter((i) => i.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .map((i) => (
                    <button
                      key={i.id}
                      className="cd-card-bg border cd-border-c rounded-xl px-3 py-2.5 flex items-center justify-between text-left"
                      onClick={() => setFilters({ ...EMPTY_FILTERS, industries: [i.id] })}
                    >
                      <span className="cd-text text-sm font-bold truncate">{i.label}</span>
                      <span className="cd-text-faint text-xs tabular-nums shrink-0 ml-1.5">{i.count}</span>
                    </button>
                  ))}
              </div>
            )}
          </section>
        </>
      ) : (
        /* ── 검색/필터 결과 화면 ─────────────────────────── */
        <>
          {/* 필터 칩 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["industry", "region", "engagement"] as const).map((kind) => {
              const active =
                kind === "industry" ? filters.industries.length > 0 :
                kind === "region" ? filters.sidos.length > 0 : filters.engagement.length > 0;
              return (
                <button
                  key={kind}
                  className={`cd-pill ${active ? "cd-pill-info" : "cd-pill-outline"} inline-flex items-center gap-0.5`}
                  style={{ paddingTop: 6, paddingBottom: 6 }}
                  onClick={() => setSheetKind(kind)}
                >
                  {filterChipLabel(kind)} <ChevronDown className="w-3 h-3" />
                </button>
              );
            })}
            <button className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={resetAll}>
              <X className="w-3.5 h-3.5" /> 초기화
            </button>
          </div>

          {/* 결과 헤더 + 정렬 */}
          <div className="flex items-center justify-between px-1">
            <span className="cd-text-muted text-xs font-bold">{loading ? "검색 중…" : `${total.toLocaleString()}곳`}</span>
            <button
              className="cd-text-faint text-xs font-bold"
              onClick={() => setSort((s) => (s === "name" ? "recent" : "name"))}
            >
              {sort === "name" ? "이름순" : "최근 등록순"} ▾
            </button>
          </div>

          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <Empty label="조건에 맞는 사업장이 없습니다." />
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((f) => (
                <button
                  key={f.facilityId}
                  className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-left"
                  onClick={() => openFacility(f)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="cd-text text-sm font-bold truncate">{f.companyName}</div>
                    <div className="cd-text-faint text-xs truncate">
                      {[f.siteAddress, f.industryName].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <ClassPills air={f.airClass} water={f.waterClass} />
                  <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />
                </button>
              ))}
              {items.length < total && (
                <button className="cd-btn cd-btn-soft cd-btn-block justify-center" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "불러오는 중…" : `더보기 (${items.length}/${total.toLocaleString()})`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {selected && <FacilitySheet facility={selected} onClose={() => setSelected(null)} />}

      {/* 필터 바텀시트 */}
      {sheetKind === "industry" && stats && (
        <FilterSheet
          title="업종 선택"
          options={stats.industries.filter((i) => i.count > 0).map((i) => ({ value: i.id, label: i.label, count: i.count }))}
          selected={filters.industries}
          onApply={(v) => {
            setFilters((s) => ({ ...s, industries: v }));
            setSheetKind(null);
          }}
          onClose={() => setSheetKind(null)}
        />
      )}
      {sheetKind === "region" && (
        <FilterSheet
          title="지역 선택"
          options={sidoOptions.map((s) => ({ value: s.value, label: s.value, count: s.count }))}
          selected={filters.sidos}
          onApply={(v) => {
            setFilters((s) => ({ ...s, sidos: v }));
            setSheetKind(null);
          }}
          onClose={() => setSheetKind(null)}
        />
      )}
      {sheetKind === "engagement" && (
        <FilterSheet
          title="관계 상태"
          options={[
            { value: "contract", label: "용역 진행 중", count: stats?.contractActive },
            { value: "sales", label: "영업 진행 중", count: stats?.salesActive },
          ]}
          selected={filters.engagement}
          onApply={(v) => {
            setFilters((s) => ({ ...s, engagement: v as ("contract" | "sales")[] }));
            setSheetKind(null);
          }}
          onClose={() => setSheetKind(null)}
        />
      )}
    </div>
  );
}

/** 멀티선택 필터 바텀시트 — 카운트 표시 + 적용/해제. */
function FilterSheet({
  title,
  options,
  selected,
  onApply,
  onClose,
}: {
  title: string;
  options: { value: string; label: string; count?: number }[];
  selected: string[];
  onApply: (values: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const toggle = (v: string) =>
    setPicked((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  return (
    <MobileSheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-1.5 mb-3">
        {options.map((o) => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 text-left ${on ? "cd-tint-primary" : "cd-border-c"}`}
              style={on ? { borderColor: "var(--cd-primary)" } : undefined}
              onClick={() => toggle(o.value)}
            >
              <span
                className="rounded-md flex items-center justify-center shrink-0"
                style={{
                  width: 18, height: 18,
                  background: on ? "var(--cd-primary)" : "transparent",
                  border: on ? "none" : "1.5px solid var(--cd-border)",
                }}
              >
                {on && <Check className="w-3 h-3 text-white" />}
              </span>
              <span className="cd-text text-sm font-bold flex-1">{o.label}</span>
              {o.count != null && <span className="cd-text-faint text-xs tabular-nums">{o.count}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        {picked.length > 0 && (
          <button className="cd-btn cd-btn-ghost shrink-0" onClick={() => setPicked([])}>전체 해제</button>
        )}
        <button className="cd-btn cd-btn-primary flex-1 justify-center" style={{ height: 44 }} onClick={() => onApply(picked)}>
          적용{picked.length > 0 ? ` (${picked.length})` : ""}
        </button>
      </div>
    </MobileSheet>
  );
}

function ClassPills({ air, water }: { air: number | null; water: number | null }) {
  if (air == null && water == null) return null;
  return (
    <span className="flex flex-col gap-0.5 shrink-0">
      {air != null && <span className="cd-pill cd-pill-info text-[10px]">대기 {air}종</span>}
      {water != null && <span className="cd-pill cd-pill-secondary text-[10px]">수질 {water}종</span>}
    </span>
  );
}

function FacilitySheet({ facility: f, onClose }: { facility: FacilityItem; onClose: () => void }) {
  const [people, setPeople] = useState<ContactPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/facilities/${encodeURIComponent(f.facilityId)}/contacts`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setPeople(
            (Array.isArray(data.people) ? (data.people as ContactPerson[]) : []).filter((p) => p.status !== "inactive")
          );
        }
      } finally {
        setPeopleLoading(false);
      }
    })();
  }, [f.facilityId]);

  const mapUrl = f.siteAddress ? `https://map.naver.com/p/search/${encodeURIComponent(f.siteAddress)}` : null;

  return (
    <MobileSheet title={f.companyName} onClose={onClose}>
      <div className="rounded-xl border cd-border-c px-3 py-1.5">
        <SheetRow
          label="주소"
          value={
            f.siteAddress ? (
              <span className="inline-flex items-start gap-1.5">
                <span>{f.siteAddress}</span>
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noreferrer" className="cd-text-primary shrink-0" aria-label="지도앱 열기">
                    <MapPin className="w-4 h-4" />
                  </a>
                )}
              </span>
            ) : (
              "—"
            )
          }
        />
        <SheetRow
          label="대표번호"
          value={f.phoneNumber ? <a href={`tel:${f.phoneNumber}`} className="cd-text-primary font-bold">{f.phoneNumber}</a> : "—"}
        />
        <SheetRow label="대표자" value={f.representativeName ?? "—"} />
        <SheetRow label="업종" value={f.industryName ?? "—"} />
        <SheetRow
          label="종규모"
          value={
            f.airClass == null && f.waterClass == null
              ? "—"
              : [f.airClass != null ? `대기 ${f.airClass}종` : null, f.waterClass != null ? `수질 ${f.waterClass}종` : null]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
      </div>

      <h4 className="cd-text-muted text-xs font-bold mt-4 mb-1.5 px-1">담당자</h4>
      {peopleLoading ? (
        <Loading />
      ) : people.length === 0 ? (
        <Empty label="등록된 담당자가 없습니다." />
      ) : (
        <div className="flex flex-col gap-2">
          {people.map((p) => (
            <div key={p.id} className="rounded-xl border cd-border-c px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="cd-text text-sm font-bold truncate">
                  {p.personName}
                  {p.title && <span className="cd-text-muted font-normal ml-1.5 text-xs">{p.title}</span>}
                </div>
                <div className="cd-text-faint text-xs truncate">{p.mobilePhone ?? p.officePhone ?? p.email ?? "—"}</div>
              </div>
              {(p.mobilePhone ?? p.officePhone) && (
                <a
                  href={`tel:${p.mobilePhone ?? p.officePhone}`}
                  className="cd-btn cd-btn-soft cd-btn-sm shrink-0"
                  aria-label="전화"
                >
                  <Phone className="w-4 h-4" />
                </a>
              )}
              {p.mobilePhone && (
                <a href={`sms:${p.mobilePhone}`} className="cd-btn cd-btn-soft cd-btn-sm shrink-0" aria-label="문자">
                  <Smartphone className="w-4 h-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </MobileSheet>
  );
}
