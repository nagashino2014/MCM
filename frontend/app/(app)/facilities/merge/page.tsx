"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  CheckCircle2,
  GitMerge,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import { cn } from "@/lib/utils";
import { formatCompanyName } from "@/lib/ieps/formatters";
import {
  FACILITY_MERGE_REASON_LABELS,
  type FacilityMergeReason,
} from "@/lib/ieps/facility-legacy";

type MatchType = "brn" | "company" | "address";
type ActiveSelection =
  | { kind: "auto"; groupIdx: number; matchIdx: number }
  | { kind: "manual" }
  | null;

interface CandidateFacility {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  source: string;
  permitsCount: number;
  createdAt: string;
}

interface CandidateMatch {
  matchType: MatchType;
  matchValue: string;
  facilityIds: string[];
}

interface CandidateGroup {
  id: string;
  matches: CandidateMatch[];
  facilities: CandidateFacility[];
}

interface FullFacility extends CandidateFacility {
  phoneNumber: string | null;
  industryCode: string | null;
  industryName: string | null;
  memo: string | null;
}

interface FacilitySearchItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  source: string;
  permitsCount: number;
  createdAt: string;
}

const MATCH_LABEL: Record<MatchType, string> = {
  brn: "사업자번호 일치",
  company: "상호 일치",
  address: "사업장 소재지 일치",
};

const MERGE_REASONS = Object.entries(FACILITY_MERGE_REASON_LABELS) as [
  FacilityMergeReason,
  string,
][];

const MERGEABLE_FIELDS = [
  { key: "company_name", label: "상호" },
  { key: "business_registration_no", label: "사업자등록번호" },
  { key: "site_address", label: "소재지" },
  { key: "phone_number", label: "전화번호" },
  { key: "industry_code", label: "업종 코드" },
  { key: "industry_name", label: "업종명" },
  { key: "memo", label: "메모" },
];

const FIELD_TO_DETAIL_KEY: Record<string, keyof FullFacility> = {
  company_name: "companyName",
  business_registration_no: "businessRegistrationNo",
  site_address: "siteAddress",
  phone_number: "phoneNumber",
  industry_code: "industryCode",
  industry_name: "industryName",
  memo: "memo",
};

export default function FacilityMergePage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === "admin" || role === "editor";
  const { theme, toggleTheme } = useCdashTheme();
  const toast = useToast();

  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveSelection>(null);
  const [selectedMatchType, setSelectedMatchType] = useState<MatchType>("brn");
  const [details, setDetails] = useState<Record<string, FullFacility>>({});
  const [targetId, setTargetId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [mergeReason, setMergeReason] = useState<FacilityMergeReason>("deduplication");
  const [merging, setMerging] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [excludingSingle, setExcludingSingle] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResults, setManualResults] = useState<CandidateFacility[]>([]);
  const [manualSelected, setManualSelected] = useState<CandidateFacility[]>([]);

  const fetchDetails = useCallback(
    async (facilities: CandidateFacility[]) => {
      for (const facility of facilities) {
        if (details[facility.facilityId]) continue;
        try {
          const res = await fetch("/api/facilities/" + facility.facilityId, { cache: "no-store" });
          if (!res.ok) continue;
          const json = (await res.json()) as {
            facilityId: string;
            companyName: string;
            businessRegistrationNo: string | null;
            siteAddress: string | null;
            phoneNumber: string | null;
            industryCode: string | null;
            industryName: string | null;
            memo: string | null;
            source: string;
            createdAt: string;
            permits: { permitId: string }[];
          };
          setDetails((prev) => ({
            ...prev,
            [json.facilityId]: {
              facilityId: json.facilityId,
              companyName: formatCompanyName(json.companyName) ?? json.companyName,
              businessRegistrationNo: json.businessRegistrationNo,
              siteAddress: json.siteAddress,
              phoneNumber: json.phoneNumber,
              industryCode: json.industryCode,
              industryName: json.industryName,
              memo: json.memo,
              source: json.source,
              permitsCount: json.permits?.length ?? 0,
              createdAt: json.createdAt,
            },
          }));
        } catch {
          // 상세 정보 보강 실패는 병합 후보 표시를 막지 않는다.
        }
      }
    },
    [details]
  );

  const setActiveFacilities = useCallback(
    (selection: ActiveSelection, facilities: CandidateFacility[]) => {
      setActive(selection);
      setOverrides({});
      const sorted = [...facilities].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setTargetId(sorted[0]?.facilityId ?? null);
      void fetchDetails(facilities);
    },
    [fetchDetails]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActive(null);
    setTargetId(null);
    setOverrides({});
    try {
      const res = await fetch("/api/facilities/merge/candidates", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { groups: CandidateGroup[] };
      setGroups(json.groups || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") reload();
  }, [reload, sessionStatus]);

  const selectAutoMatch = useCallback(
    (groupIdx: number, matchIdx: number) => {
      const group = groups[groupIdx];
      const match = group?.matches[matchIdx];
      if (!group || !match) return;
      const selectedIds = new Set(match.facilityIds);
      const facilities = group.facilities.filter((facility) => selectedIds.has(facility.facilityId));
      setActiveFacilities({ kind: "auto", groupIdx, matchIdx }, facilities);
    },
    [groups, setActiveFacilities]
  );

  const candidateMatches = useMemo(
    () =>
      groups.flatMap((group, groupIdx) =>
        group.matches.map((match, matchIdx) => ({ group, groupIdx, match, matchIdx }))
      ),
    [groups]
  );
  const matchCounts = useMemo(
    () =>
      candidateMatches.reduce<Record<MatchType, number>>(
        (acc, item) => {
          acc[item.match.matchType] += 1;
          return acc;
        },
        { brn: 0, company: 0, address: 0 }
      ),
    [candidateMatches]
  );
  const selectedCandidateMatches = useMemo(
    () => candidateMatches.filter((item) => item.match.matchType === selectedMatchType),
    [candidateMatches, selectedMatchType]
  );

  const activeGroup = active?.kind === "auto" ? groups[active.groupIdx] : null;
  const activeMatch = active?.kind === "auto" ? activeGroup?.matches[active.matchIdx] ?? null : null;
  const activeFacilities = useMemo(() => {
    if (active?.kind === "manual") return manualSelected;
    if (!activeGroup || !activeMatch) return [];
    const selectedIds = new Set(activeMatch.facilityIds);
    return activeGroup.facilities.filter((facility) => selectedIds.has(facility.facilityId));
  }, [active, activeGroup, activeMatch, manualSelected]);

  const facsWithDetails = useMemo(
    () => activeFacilities.map((facility) => details[facility.facilityId] ?? null),
    [activeFacilities, details]
  );

  const searchManualFacilities = async () => {
    const query = manualQuery.trim();
    if (query.length < 2) {
      toast.show("상호 검색어를 2글자 이상 입력하세요.", "error");
      return;
    }
    setManualLoading(true);
    try {
      const params = new URLSearchParams({ q: query, limit: "20", sort: "name" });
      const res = await fetch("/api/facilities?" + params.toString(), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { items: FacilitySearchItem[] };
      setManualResults(
        (json.items || []).map((item) => ({
          facilityId: item.facilityId,
          companyName: item.companyName,
          businessRegistrationNo: item.businessRegistrationNo,
          siteAddress: item.siteAddress,
          source: item.source,
          permitsCount: item.permitsCount,
          createdAt: item.createdAt,
        }))
      );
    } catch (err) {
      toast.show("검색 실패: " + (err as Error).message, "error");
    } finally {
      setManualLoading(false);
    }
  };

  const toggleManualSelected = (facility: CandidateFacility) => {
    setManualSelected((prev) => {
      const exists = prev.some((item) => item.facilityId === facility.facilityId);
      const next = exists
        ? prev.filter((item) => item.facilityId !== facility.facilityId)
        : [...prev, facility];
      if (next.length >= 2) {
        setActiveFacilities({ kind: "manual" }, next);
      } else if (active?.kind === "manual") {
        setActive(null);
        setTargetId(null);
      }
      return next;
    });
  };

  const clearManualSelection = () => {
    setManualSelected([]);
    if (active?.kind === "manual") {
      setActive(null);
      setTargetId(null);
      setOverrides({});
    }
  };

  const handleMerge = async () => {
    if (activeFacilities.length < 2 || !targetId) return;
    const sourceIds = activeFacilities
      .map((facility) => facility.facilityId)
      .filter((id) => id !== targetId);
    if (sourceIds.length === 0) return;
    setMerging(true);
    try {
      const res = await fetch("/api/facilities/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId, sourceIds, fieldOverrides: overrides, mergeReason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("병합이 완료되었습니다.");
      setManualSelected([]);
      setManualResults([]);
      reload();
    } catch (err) {
      toast.show("병합 실패: " + (err as Error).message, "error");
    } finally {
      setMerging(false);
    }
  };

  const handleExcludeActiveCandidate = async () => {
    if (active?.kind !== "auto" || !activeMatch || activeFacilities.length < 2) return;
    const ok = window.confirm(
      "이 후보 조합을 병합 대상 목록에서 제외할까요? 제외 후 자동 후보 목록에 다시 표시되지 않습니다."
    );
    if (!ok) return;
    setExcluding(true);
    try {
      const res = await fetch("/api/facilities/merge/exclusions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchType: activeMatch.matchType,
          matchValue: activeMatch.matchValue,
          facilityIds: activeFacilities.map((facility) => facility.facilityId),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("병합 후보 목록에서 제외했습니다.");
      reload();
    } catch (err) {
      toast.show("후보 제외 실패: " + (err as Error).message, "error");
    } finally {
      setExcluding(false);
    }
  };

  const handleExcludeSelectedFacility = async () => {
    if (active?.kind !== "auto" || !targetId) return;
    const selectedFacility = activeFacilities.find((facility) => facility.facilityId === targetId);
    const selectedName = selectedFacility
      ? formatCompanyName(selectedFacility.companyName) ?? selectedFacility.companyName
      : targetId;
    const ok = window.confirm(
      `"${selectedName}" 업체만 중복 병합 후보에서 제외할까요? 제외 후 자동 후보 목록에 다시 표시되지 않습니다.`
    );
    if (!ok) return;
    setExcludingSingle(true);
    try {
      const res = await fetch("/api/facilities/merge/exclusions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchType: "facility",
          matchValue: selectedName,
          facilityIds: [targetId],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("선택 업체를 병합 후보 목록에서 제외했습니다.");
      reload();
    } catch (err) {
      toast.show("개별 업체 제외 실패: " + (err as Error).message, "error");
    } finally {
      setExcludingSingle(false);
    }
  };

  if (sessionStatus === "loading") {
    return <div className="cdash p-8 cd-text-faint text-sm" data-theme={theme}>세션 확인 중…</div>;
  }
  if (!canEdit) {
    return (
      <div className="cdash p-8 flex items-center justify-center" data-theme={theme}>
        <div className="cd-card rounded-3xl p-10 text-center max-w-md">
          <ShieldAlert className="w-10 h-10 cd-error-text mx-auto mb-3" />
          <h2 className="text-lg font-bold cd-text mb-1">권한이 없습니다</h2>
          <p className="text-sm cd-text-faint">사업장 병합은 편집자 이상 권한이 필요합니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full" data-theme={theme}>
      <CdPageHeader
        icon={<GitMerge className="w-5 h-5" />}
        eyebrow="Facility Merge"
        title="사업장 중복 병합"
        subtitle="사업자번호·상호·사업장 소재지 일치 후보를 카테고리별로 확인하고, 직접 상호 검색으로 병합 대상도 구성할 수 있습니다."
        actions={
          <>
            <Link href="/facilities" className="cd-btn cd-btn-ghost cd-btn-sm">
              <ArrowLeft className="w-3.5 h-3.5" /> 사업장 마스터
            </Link>
            <button type="button" onClick={reload} className="cd-btn cd-btn-ghost cd-btn-sm">
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} /> 다시 검색
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:h-[calc(100vh-260px)] lg:min-h-[520px]">
        <section className="cd-card rounded-3xl p-6 cd-reveal delay-1 flex flex-col gap-5 min-h-0 overflow-hidden">
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            <h3 className="font-bold cd-text-muted mb-3">중복 후보 그룹 ({groups.length})</h3>
            {error && <div className="cd-error-text text-sm font-bold mb-3">조회 실패: {error}</div>}
            {loading && <div className="cd-text-faint text-sm py-10 text-center">로딩 중…</div>}
            {!loading && groups.length === 0 && !error && (
              <div className="cd-text-faint text-sm py-10 text-center flex flex-col items-center gap-2">
                <CheckCircle2 className="w-10 h-10 cd-text-primary/60" />
                자동으로 검출된 중복 후보가 없습니다.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-[195px_1fr] gap-3 min-h-0 flex-1">
              <div className="cd-card-bg/35 border cd-border-c rounded-2xl p-3 flex flex-col gap-2">
                {(["brn", "company", "address"] as const).map((matchType) => (
                  <button
                    key={matchType}
                    type="button"
                    onClick={() => setSelectedMatchType(matchType)}
                    className={cn(
                      "text-left rounded-xl px-3.5 py-2.5 border transition-colors",
                      selectedMatchType === matchType
                        ? "cd-fill-primary text-white border-[color:var(--cd-primary)] shadow-sm"
                        : "cd-surface-bg cd-text-muted cd-border-c hover:bg-[color:var(--cd-card)]"
                    )}
                  >
                    <span className="block text-xs font-bold">{MATCH_LABEL[matchType]}</span>
                    <span className="block text-[11px] opacity-80 mt-0.5">
                      {matchCounts[matchType]}개 그룹
                    </span>
                  </button>
                ))}
              </div>
              <div className="cd-card-bg/35 border cd-border-c rounded-2xl p-3 min-h-0 overflow-y-auto scrollbar-hide">
                <div className="flex flex-col gap-2">
                  {selectedCandidateMatches.length === 0 && !loading && (
                    <div className="cd-text-faint text-sm py-10 text-center">
                      {MATCH_LABEL[selectedMatchType]} 후보가 없습니다.
                    </div>
                  )}
                  {selectedCandidateMatches.map(({ group, groupIdx, match, matchIdx }) => {
                    const selected =
                      active?.kind === "auto" &&
                      active.groupIdx === groupIdx &&
                      active.matchIdx === matchIdx;
                    const selectedIds = new Set(match.facilityIds);
                    const facilities = group.facilities.filter((facility) =>
                      selectedIds.has(facility.facilityId)
                    );
                    return (
                      <button
                        key={group.id + match.matchType + match.matchValue}
                        type="button"
                        onClick={() => selectAutoMatch(groupIdx, matchIdx)}
                        className={cn(
                          "text-left p-3 rounded-xl border transition-colors",
                          selected
                            ? "cd-tint-primary border-[color:var(--cd-primary)]"
                            : "cd-surface-bg hover:bg-[color:var(--cd-surface)] cd-border-c"
                        )}
                      >
                        <div className="text-sm font-bold cd-text truncate">
                          {match.matchValue || "(빈 값)"}
                        </div>
                        <div className="text-[11px] cd-text-faint mt-1">
                          {facilities.length}건 후보 ·{" "}
                          {facilities
                            .map(
                              (facility) =>
                                formatCompanyName(facility.companyName) ?? facility.companyName
                            )
                            .slice(0, 3)
                            .join(" / ")}
                          {facilities.length > 3 ? " …" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t cd-border-c/70 pt-5 shrink-0">
            <h3 className="font-bold cd-text-muted mb-2">직접 검색 병합</h3>
            <div className="flex gap-2">
              <input
                className="cd-input text-sm min-w-0 flex-1"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchManualFacilities();
                }}
                placeholder="상호로 검색"
              />
              <button
                type="button"
                onClick={searchManualFacilities}
                disabled={manualLoading}
                className="rounded-xl min-w-[64px] px-3 py-2 text-xs font-bold text-white cd-fill-primary shadow-sm flex shrink-0 items-center justify-center gap-1 whitespace-nowrap disabled:opacity-60"
              >
                <Search className="w-3.5 h-3.5" />
                {manualLoading ? "검색 중…" : "검색"}
              </button>
            </div>
            {manualSelected.length > 0 && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs cd-text-faint">
                <span>선택 {manualSelected.length}건</span>
                <button
                  type="button"
                  onClick={clearManualSelection}
                  className="font-bold cd-text-faint hover:cd-error-text flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> 선택 해제
                </button>
              </div>
            )}
            <div className="flex flex-col gap-1.5 mt-3 max-h-40 overflow-y-auto scrollbar-hide">
              {manualResults.map((facility) => {
                const checked = manualSelected.some((item) => item.facilityId === facility.facilityId);
                return (
                  <label
                    key={facility.facilityId}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-lg border cursor-pointer",
                      checked ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-surface-bg cd-border-c"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleManualSelected(facility)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold cd-text truncate">
                        {formatCompanyName(facility.companyName) ?? facility.companyName}
                      </span>
                      <span className="block text-[11px] cd-text-faint truncate">
                        {facility.businessRegistrationNo ?? "BRN 없음"} · {facility.siteAddress ?? "주소 없음"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <section className="cd-card rounded-3xl p-6 cd-reveal delay-2 min-h-0 overflow-y-auto scrollbar-hide">
          {activeFacilities.length < 2 && (
            <div className="cd-text-faint text-sm py-10 text-center">
              좌측에서 자동 후보 태그를 선택하거나 직접 검색으로 2개 이상 선택하세요.
            </div>
          )}
          {activeFacilities.length >= 2 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold cd-text-muted">
                    병합 대상 선택 ({activeFacilities.length}건)
                  </h3>
                  <p className="text-xs cd-text-faint mt-0.5">
                    {active?.kind === "manual"
                      ? "직접 선택한 사업장입니다."
                      : activeMatch
                      ? `${MATCH_LABEL[activeMatch.matchType]} · ${activeMatch.matchValue}`
                      : "선택한 후보입니다."}{" "}
                    유지할 facility(target)를 선택하세요.
                  </p>
                </div>
                {active?.kind === "auto" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExcludeSelectedFacility}
                      disabled={excludingSingle || !targetId}
                      className="rounded-xl px-3 py-2 text-xs font-bold text-amber-700 cd-warn-bg hover:bg-amber-100 border border-amber-200 disabled:opacity-60"
                    >
                      {excludingSingle ? "제외 중…" : "개별 업체 제외"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExcludeActiveCandidate}
                      disabled={excluding}
                      className="rounded-xl px-3 py-2 text-xs font-bold cd-error-text cd-error-bg hover:cd-error-bg border cd-error-border disabled:opacity-60"
                    >
                      {excluding ? "제외 중…" : "전체 업체 제외"}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {activeFacilities.map((facility) => {
                  const detail = details[facility.facilityId];
                  const isTarget = targetId === facility.facilityId;
                  return (
                    <label
                      key={facility.facilityId}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                        isTarget
                          ? "cd-tint-primary border-[color:var(--cd-primary)]"
                          : "cd-surface-bg hover:bg-[color:var(--cd-surface)] cd-border-c"
                      )}
                    >
                      <input
                        type="radio"
                        name="targetFacility"
                        checked={isTarget}
                        onChange={() => setTargetId(facility.facilityId)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold cd-text flex items-center gap-2 truncate">
                          {formatCompanyName(facility.companyName) ?? facility.companyName}
                          <span className="text-[9px] font-bold uppercase tracking-wide cd-surface-bg cd-text-muted px-1.5 py-0.5 rounded">
                            {facility.source}
                          </span>
                          {isTarget && (
                            <span className="text-[9px] font-bold uppercase tracking-wide cd-fill-primary text-white px-1.5 py-0.5 rounded">
                              TARGET
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] cd-text-faint truncate mt-0.5">
                          {facility.businessRegistrationNo ?? "BRN 없음"} ·{" "}
                          {facility.siteAddress ?? "주소 없음"}
                        </div>
                        <div className="text-[11px] cd-text-faint truncate mt-0.5">
                          허가 {facility.permitsCount}건 · 등록 {facility.createdAt?.slice(0, 10)}
                          {detail?.phoneNumber && " · " + detail.phoneNumber}
                          {detail?.industryCode && " · " + detail.industryCode}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold cd-text-muted">병합 이유</span>
                <select
                  className="cd-select text-xs"
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value as FacilityMergeReason)}
                >
                  {MERGE_REASONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <h4 className="font-bold cd-text-muted text-sm">필드별 우선순위</h4>
                <p className="text-xs cd-text-faint mt-0.5">
                  각 필드를 어느 facility 의 값으로 채울지 선택합니다. 미선택 시 target 의 현재 값을 유지합니다.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                {MERGEABLE_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="flex items-center gap-3 cd-surface-bg border cd-border-c rounded-xl p-3"
                  >
                    <span className="text-xs font-bold cd-text-muted w-32 shrink-0">
                      {field.label}
                    </span>
                    <select
                      className="cd-select text-xs flex-1"
                      value={overrides[field.key] ?? "target"}
                      onChange={(e) =>
                        setOverrides((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    >
                      <option value="target">target 유지</option>
                      {facsWithDetails.map((facility, i) => {
                        if (!facility) return null;
                        const fid = activeFacilities[i].facilityId;
                        if (fid === targetId) return null;
                        const detailKey = FIELD_TO_DETAIL_KEY[field.key];
                        const value = detailKey ? facility[detailKey] : null;
                        return (
                          <option key={fid} value={fid}>
                            {formatCompanyName(facility.companyName) ?? facility.companyName} ·{" "}
                            {String(value ?? "—")}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t cd-border-c/70">
                <button
                  type="button"
                  onClick={() => {
                    setActive(null);
                    setTargetId(null);
                    setOverrides({});
                  }}
                  className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={!targetId || merging}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm flex items-center gap-1 disabled:opacity-50"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  {merging ? "병합 중…" : "병합 실행"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
