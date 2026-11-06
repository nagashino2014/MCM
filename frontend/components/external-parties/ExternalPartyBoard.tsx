"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Search, Upload } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { FacilityDetailPanel } from "@/components/facilities/FacilityDetailPanel";
import { useClientPaging } from "@/components/ui/PaginationControls";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { ORG_CATEGORIES } from "@/lib/directory-categories";
import "@/components/cdash/cdash.css";

interface PartyRow {
  facilityId: string; companyName: string; orgCategory: string | null; businessRegistrationNo: string | null; region: string | null; contactCount: number;
}
interface PartySummary {
  companyName: string; orgCategory: string | null; businessRegistrationNo: string | null; representativeName: string | null;
  address: string | null; phoneNumber: string | null; homepageUrl: string | null;
}
interface PartyContact { id: number; personName: string; title: string | null; department: string | null; officePhone: string | null; mobilePhone: string | null; email: string | null }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function ExternalPartyBoard() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

/** 기타 업체·기관 — 사업장 마스터에 두지 않는 곳. 항목과 상세는 사업장과 같고, 언제든 거래처로 승격한다. */
function Inner() {
  const { theme } = useCdashTheme();
  const toast = useToast();
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canViewFacility, setCanViewFacility] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ party: PartySummary; contacts: PartyContact[] } | null>(null);
  const [roles, setRoles] = useState<string[]>(["sales"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paging = useClientPaging(rows, "external-parties-page-size", loading);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, category });
      const data = await api<{ parties: PartyRow[]; canEdit: boolean; canDelete: boolean; canViewFacility: boolean }>(`/api/external-parties?${params}`);
      setRows(data.parties);
      setCanEdit(data.canEdit);
      setCanDelete(data.canDelete);
      setCanViewFacility(data.canViewFacility);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, category]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) setSelectedId(focus);
  }, []);
  // 사업장 조회 권한이 없으면 사업장 상세 대신 요약을 보여 준다.
  useEffect(() => {
    if (!selectedId || canViewFacility) {
      setSummary(null);
      return;
    }
    api<{ party: PartySummary; contacts: PartyContact[] }>(`/api/external-parties/${encodeURIComponent(selectedId)}`)
      .then(setSummary)
      .catch((e) => setError((e as Error).message));
  }, [selectedId, canViewFacility]);

  const move = (body: Record<string, unknown>, done: string) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    api(`/api/external-parties/${encodeURIComponent(selectedId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(async () => {
        setSelectedId(null);
        toast.show(done);
        await load();
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const selectRole = (role: string) => setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return (
    <div className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-lg h-full min-h-0" data-theme={theme}>
      <CdPageHeader
        title="기타 업체·기관"
        helpTopic="external-parties.list"
        meta={`${rows.length.toLocaleString()}곳`}
        actions={
          <>
            <Link href="/external-parties/import" className="cd-btn cd-btn-ghost cd-btn-sm"><Upload className="w-3.5 h-3.5" /> 연락처 가져오기</Link>
            {canEdit && <Link href="/facilities/new?kind=other" className="cd-btn cd-btn-primary cd-btn-sm"><Plus className="w-3.5 h-3.5" /> 직접 등록</Link>}
          </>
        }
      />
      {error && <div role="alert" className="cd-card p-3 cd-error-text">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)] lg:grid-rows-[minmax(0,1fr)] gap-5 flex-1 min-h-0">
        <section className="cd-card p-5 flex flex-col gap-3 min-h-0" aria-label="기타 업체·기관 목록">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint" aria-hidden />
              <input aria-label="이름·사업자번호·담당자 검색" placeholder="이름·사업자번호·담당자 검색" className="cd-input !w-56 !pl-8" value={q} onChange={(e) => { setQ(e.target.value); paging.resetPage(); }} />
            </label>
            <select aria-label="연락처 구분" className="cd-input !w-auto" value={category} onChange={(e) => { setCategory(e.target.value); paging.resetPage(); }}>
              <option value="">전체 구분</option>
              {ORG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-faint">
                  <th className="p-3">이름</th><th className="p-3">구분</th><th className="p-3">사업자번호</th><th className="p-3">지역</th><th className="p-3 text-right">담당자</th>
                </tr>
              </thead>
              <tbody>
                {!loading && rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center cd-text-faint">해당하는 곳이 없습니다.</td></tr>}
                {paging.pageRows.map((row) => (
                  <tr key={row.facilityId} className="border-t cd-border-c cd-text cursor-pointer" style={selectedId === row.facilityId ? { backgroundColor: "var(--cd-row-selected)" } : undefined} onClick={() => setSelectedId(row.facilityId)}>
                    <td className="p-3">
                      <button type="button" className="font-semibold text-left" onClick={(e) => { e.stopPropagation(); setSelectedId(row.facilityId); }}>{row.companyName}</button>
                    </td>
                    <td className="p-3 whitespace-nowrap">{row.orgCategory ?? "—"}</td>
                    <td className="p-3 whitespace-nowrap tabular-nums">{row.businessRegistrationNo ?? "—"}</td>
                    <td className="p-3 whitespace-nowrap">{row.region ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">{row.contactCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paging.pager}
        </section>

        <div className="flex flex-col gap-3 min-h-0">
          {selectedId && canEdit && (
            <div className="cd-card p-3 !flex-row flex-wrap items-center gap-2 text-sm cd-text" role="group" aria-label="목록 옮기기">
              <label className="flex items-center gap-1"><input type="checkbox" checked={roles.includes("sales")} onChange={() => selectRole("sales")} />매출</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={roles.includes("purchase")} onChange={() => selectRole("purchase")} />매입</label>
              <button type="button" disabled={busy || !roles.length} className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => move({ action: "promote", tradeRoles: roles }, "거래처로 승격했습니다. 이제 사업장 마스터에 나옵니다.")}>
                <ArrowRight className="w-3.5 h-3.5" /> 거래처로 승격
              </button>
              <button type="button" disabled={busy} className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => move({ action: "master" }, "사업장 마스터로 옮겼습니다.")}>
                사업장 마스터로
              </button>
            </div>
          )}
          {canViewFacility ? (
            <FacilityDetailPanel
              facilityId={selectedId}
              canEdit={canEdit}
              canDelete={canDelete}
              otherList
              onDeleted={() => { setSelectedId(null); void load(); toast.show("삭제했습니다."); }}
              onUpdated={() => { void load(); toast.show("정보가 갱신되었습니다."); }}
            />
          ) : (
            <section className="cd-card rounded-lg p-4 flex flex-col gap-3 text-sm cd-text" aria-label="상세">
              {!summary ? <p className="cd-text-faint">왼쪽에서 고르세요.</p> : (
                <>
                  <h2 className="font-semibold text-base">{summary.party.companyName}</h2>
                  <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1">
                    <dt className="cd-text-faint">구분</dt><dd>{summary.party.orgCategory ?? "—"}</dd>
                    <dt className="cd-text-faint">사업자번호</dt><dd>{summary.party.businessRegistrationNo ?? "—"}</dd>
                    <dt className="cd-text-faint">대표자</dt><dd>{summary.party.representativeName ?? "—"}</dd>
                    <dt className="cd-text-faint">대표전화</dt><dd>{summary.party.phoneNumber ?? "—"}</dd>
                    <dt className="cd-text-faint">주소</dt><dd>{summary.party.address ?? "—"}</dd>
                    <dt className="cd-text-faint">홈페이지</dt><dd>{summary.party.homepageUrl ?? "—"}</dd>
                  </dl>
                  <h3 className="font-semibold border-t cd-border-c pt-3">담당자 {summary.contacts.length}명</h3>
                  <ul className="flex flex-col gap-2">
                    {summary.contacts.map((p) => (
                      <li key={p.id}>
                        <div className="font-semibold">{p.personName}{p.title ? ` ${p.title}` : ""}{p.department ? <span className="font-normal cd-text-faint"> · {p.department}</span> : null}</div>
                        <div className="text-xs cd-text-faint">{[p.mobilePhone, p.officePhone, p.email].filter(Boolean).join(" · ") || "연락처 없음"}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
