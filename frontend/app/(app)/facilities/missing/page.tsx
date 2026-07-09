"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  MapPin,
  Phone,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  User,
  Wrench,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { FacilityDetailPanel } from "@/components/facilities/FacilityDetailPanel";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import { cn } from "@/lib/utils";
import type {
  FacilityListItem,
  FacilityMissingField,
  FacilityMissingStats,
} from "@/lib/ieps/types-facility";

const PAGE_SIZE = 10;

const MISSING_FIELDS: {
  key: FacilityMissingField;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "brn", label: "사업자등록번호", icon: <Building2 className="w-3.5 h-3.5" /> },
  { key: "representative", label: "대표자명", icon: <User className="w-3.5 h-3.5" /> },
  { key: "phone", label: "전화번호", icon: <Phone className="w-3.5 h-3.5" /> },
  { key: "address", label: "소재지", icon: <MapPin className="w-3.5 h-3.5" /> },
  { key: "industry", label: "업종코드·업종명", icon: <Wrench className="w-3.5 h-3.5" /> },
];

const MISSING_LABELS: Record<FacilityMissingField, string> = {
  brn: "사업자번호",
  representative: "대표자명",
  phone: "전화번호",
  address: "소재지",
  industry: "업종",
};

interface EnrichCandidate {
  facilityId: string;
  companyName: string;
  field: string;
  fieldLabel: string;
  value: string;
  source: string;
  verified: boolean;
  note: string | null;
}

/** 리스트 아이템에서 항목별 누락 여부 계산 (서버 판정과 동일 기준). */
function missingFieldsOf(item: FacilityListItem): FacilityMissingField[] {
  const out: FacilityMissingField[] = [];
  if (!item.businessRegistrationNo?.trim()) out.push("brn");
  if (!item.representativeName?.trim()) out.push("representative");
  if (!item.phoneNumber?.trim()) out.push("phone");
  if (!item.siteAddress?.trim()) out.push("address");
  if (!item.industryCode?.trim() || !item.industryName?.trim()) out.push("industry");
  return out;
}

export default function FacilityMissingPage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const toast = useToast();
  const { theme } = useCdashTheme();

  const [selectedFields, setSelectedFields] = useState<FacilityMissingField[]>(
    MISSING_FIELDS.map((f) => f.key)
  );
  const [stats, setStats] = useState<FacilityMissingStats | null>(null);
  const [items, setItems] = useState<FacilityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [candidates, setCandidates] = useState<EnrichCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  const reloadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/facilities/missing-stats", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { stats: FacilityMissingStats };
      setStats(json.stats);
    } catch {
      /* 배지 숫자는 보조 정보 — 실패해도 리스트는 동작 */
    }
  }, []);

  const reload = useCallback(async () => {
    if (selectedFields.length === 0) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("missing", selectedFields.join(","));
      params.set("sort", "name");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch("/api/facilities?" + params.toString(), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { items: FacilityListItem[]; total: number };
      setItems(json.items || []);
      setTotal(json.total || 0);
      setSelectedId((prev) => {
        if (prev && (json.items || []).some((it) => it.facilityId === prev)) return prev;
        return json.items?.[0]?.facilityId ?? null;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedFields, offset]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    reloadStats();
  }, [reloadStats]);

  const toggleField = (key: FacilityMissingField) => {
    setOffset(0);
    setSelectedFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const runEnrich = async () => {
    if (items.length === 0) return;
    setEnriching(true);
    try {
      const res = await fetch("/api/facilities/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facilityIds: items.map((it) => it.facilityId) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { candidates: EnrichCandidate[] };
      setCandidates(json.candidates);
      // 강검증(사업자번호 일치) 후보만 기본 선택
      setChecked(new Set(json.candidates.map((c, i) => (c.verified ? i : -1)).filter((i) => i >= 0)));
    } catch (err) {
      toast.show("자동 보완 조회 실패: " + (err as Error).message, "error");
    } finally {
      setEnriching(false);
    }
  };

  const applyChecked = async () => {
    if (!candidates) return;
    const items_ = candidates.filter((_, i) => checked.has(i));
    if (items_.length === 0) return;
    setApplying(true);
    try {
      const res = await fetch("/api/facilities/enrich/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items_.map((c) => ({ facilityId: c.facilityId, field: c.field, value: c.value })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { applied: number; skipped: number };
      toast.show(`${json.applied}개 항목을 반영했습니다.` + (json.skipped ? ` (건너뜀 ${json.skipped})` : ""));
      setCandidates(null);
      reload();
      reloadStats();
    } catch (err) {
      toast.show("반영 실패: " + (err as Error).message, "error");
    } finally {
      setApplying(false);
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
          <p className="text-sm cd-text-faint">누락 항목 점검은 편집자 이상 권한이 필요합니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        eyebrow="Facility Data Quality"
        title="사업장 누락 항목 점검"
        subtitle="주요 항목이 비어 있는 사업장을 항목별로 모아 확인하고, 우측 상세 패널에서 바로 보완 편집합니다. 항목 태그는 복수 선택할 수 있으며 선택된 항목 중 하나라도 누락된 사업장이 표시됩니다."
        actions={
          <>
            <Link href="/facilities" className="cd-btn cd-btn-ghost cd-btn-sm">
              <ArrowLeft className="w-3.5 h-3.5" /> 사업장 마스터
            </Link>
            <button
              type="button"
              onClick={() => {
                reload();
                reloadStats();
              }}
              className="cd-btn cd-btn-ghost cd-btn-sm"
            >
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} /> 새로고침
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)] lg:grid-rows-[minmax(0,1fr)] gap-5 flex-1 min-h-0">
        <section className="cd-card rounded-3xl p-6 flex flex-col gap-4 min-h-0 overflow-hidden">
          <div>
            <h3 className="font-bold cd-text-muted mb-3">누락 항목 선택</h3>
            <div className="flex flex-wrap gap-2">
              {MISSING_FIELDS.map((f) => {
                const active = selectedFields.includes(f.key);
                const count = stats?.[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleField(f.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold border transition-colors",
                      active
                        ? "cd-fill-primary text-white border-[color:var(--cd-primary)] shadow-sm"
                        : "border cd-border-c cd-text-muted hover:border-[color:var(--cd-primary)] hover:text-[color:var(--cd-primary)]"
                    )}
                  >
                    {f.icon}
                    {f.label}
                    {count != null && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                          active
                            ? "bg-white/20 text-white"
                            : "bg-[var(--cd-error-soft)] text-[color:var(--cd-error)]"
                        )}
                      >
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="font-bold cd-text-muted">
              누락 사업장 <span className="cd-text-primary">{total.toLocaleString()}</span>
            </h3>
            {selectedFields.length === 0 ? (
              <span className="text-xs cd-text-faint">항목을 하나 이상 선택하세요</span>
            ) : (
              <button
                type="button"
                onClick={runEnrich}
                disabled={enriching || loading || items.length === 0}
                className="cd-btn cd-btn-primary cd-btn-sm disabled:opacity-50"
                title="현재 페이지의 사업장을 DART에서 조회해 누락 항목 후보를 제안합니다"
              >
                <Sparkles className={"w-3.5 h-3.5 " + (enriching ? "animate-pulse" : "")} />
                {enriching ? "조회 중…" : "자동 보완 (현재 페이지)"}
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
            {error && <div className="cd-error-text text-sm font-bold">조회 실패: {error}</div>}
            {loading && <div className="cd-text-faint text-sm py-10 text-center">로딩 중…</div>}
            {!loading && !error && items.length === 0 && selectedFields.length > 0 && (
              <div className="cd-text-faint text-sm py-10 text-center">
                선택한 항목이 누락된 사업장이 없습니다.
              </div>
            )}
            {!loading &&
              items.map((item) => {
                const missing = missingFieldsOf(item);
                const active = item.facilityId === selectedId;
                return (
                  <button
                    key={item.facilityId}
                    type="button"
                    onClick={() => setSelectedId(item.facilityId)}
                    className={cn(
                      "text-left rounded-2xl px-4 py-3 border transition-colors",
                      active
                        ? "border-[color:var(--cd-primary)] cd-tint-primary"
                        : "border cd-border-c hover:border-[color:var(--cd-primary)]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold cd-text text-sm truncate">{item.companyName}</span>
                      <span className="text-[11px] cd-text-faint shrink-0">
                        {item.source === "manual" || item.source === "group_company" ? "수동 등록" : "IEPS"}
                      </span>
                    </div>
                    <div className="text-xs cd-text-faint truncate mt-0.5">
                      {item.siteAddress || "소재지 미입력"}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {missing.map((k) => (
                        <span
                          key={k}
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[var(--cd-error-soft)] text-[color:var(--cd-error)]"
                        >
                          {MISSING_LABELS[k]} 누락
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
          </div>

          <PaginationControls
            total={total}
            limit={PAGE_SIZE}
            offset={offset}
            loading={loading}
            onPageChange={(nextOffset) => setOffset(nextOffset)}
          />
        </section>

        <FacilityDetailPanel
          facilityId={selectedId}
          canEdit={canEdit}
          onDeleted={() => {
            setSelectedId(null);
            setOffset(0);
            reload();
            reloadStats();
            toast.show("사업장을 삭제했습니다.");
          }}
          onUpdated={() => {
            reload();
            reloadStats();
            toast.show("사업장 정보가 갱신되었습니다.");
          }}
        />
      </div>

      {candidates !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="cd-card rounded-3xl p-6 w-full max-w-3xl max-h-[85vh] flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold cd-text">
                자동 보완 후보 <span className="cd-text-primary">{candidates.length}</span>
                <span className="text-xs font-normal cd-text-faint ml-2">
                  사업자번호 일치로 검증된 후보만 기본 선택되어 있습니다
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setCandidates(null)}
                className="cd-btn cd-btn-ghost cd-btn-sm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {candidates.length === 0 && (
                <div className="cd-text-faint text-sm py-10 text-center">
                  DART에서 매칭되는 후보를 찾지 못했습니다. (비외감 중소기업·관공서 시설은 커버리지 밖입니다)
                </div>
              )}
              {candidates.map((c, i) => (
                <label
                  key={i}
                  className={cn(
                    "flex items-start gap-3 rounded-xl px-3.5 py-2.5 border cursor-pointer transition-colors",
                    checked.has(i) ? "border-[color:var(--cd-primary)] cd-tint-primary" : "border cd-border-c"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    className="mt-1 accent-[var(--cd-primary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold cd-text text-sm">{c.companyName}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[var(--cd-primary-soft)] text-[color:var(--cd-primary)]">
                        {c.fieldLabel}
                      </span>
                      {c.verified ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[var(--cd-success-soft)] text-[color:var(--cd-success)]">
                          검증됨
                        </span>
                      ) : (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[var(--cd-warning-soft)] text-[color:var(--cd-warning)]">
                          확인 필요
                        </span>
                      )}
                    </div>
                    <div className="text-sm cd-text mt-0.5 whitespace-pre-line break-all">{c.value}</div>
                    <div className="text-[11px] cd-text-faint mt-0.5">
                      {c.source}
                      {c.note ? ` · ${c.note}` : ""}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setCandidates(null)} className="cd-btn cd-btn-ghost cd-btn-sm">
                닫기
              </button>
              <button
                type="button"
                onClick={applyChecked}
                disabled={applying || checked.size === 0}
                className="cd-btn cd-btn-primary cd-btn-sm disabled:opacity-50"
              >
                {applying ? "반영 중…" : `선택 ${checked.size}건 반영`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
