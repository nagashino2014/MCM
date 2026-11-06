"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Save, Search, Trash2, Upload, X } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { useClientPaging } from "@/components/ui/PaginationControls";
import { ORG_CATEGORIES } from "@/lib/directory-categories";
import "@/components/cdash/cdash.css";

interface OrgRow {
  kind: "organization" | "facility"; orgId: string; orgName: string; orgCategory: string | null; businessRegistrationNo: string | null; address: string | null;
  region: string | null; phoneNumber: string | null; homepageUrl: string | null; contactCount: number;
}
interface OrgDetail {
  orgId: string; orgName: string; orgCategory: string | null; businessRegistrationNo: string | null; corporateRegistrationNo: string | null;
  address: string | null; phoneNumber: string | null; homepageUrl: string | null; memo: string | null; source: string;
}
interface OrgContact { id: number; personName: string; title: string | null; department: string | null; officePhone: string | null; mobilePhone: string | null; faxNumber: string | null; email: string | null }

const EMPTY_ORG = { orgName: "", orgCategory: "민간기업", businessRegistrationNo: "", corporateRegistrationNo: "", address: "", phoneNumber: "", homepageUrl: "", memo: "" };
const EMPTY_CONTACT = { personName: "", title: "", department: "", officePhone: "", mobilePhone: "", faxNumber: "", email: "" };
const ORG_FIELDS: { key: keyof typeof EMPTY_ORG; label: string }[] = [
  { key: "orgName", label: "기관명 *" },
  { key: "businessRegistrationNo", label: "사업자등록번호" },
  { key: "phoneNumber", label: "대표전화" },
  { key: "homepageUrl", label: "홈페이지" },
  { key: "address", label: "주소" },
  { key: "memo", label: "메모" },
];
const CONTACT_FIELDS: { key: keyof typeof EMPTY_CONTACT; label: string }[] = [
  { key: "personName", label: "이름 *" },
  { key: "title", label: "직급" },
  { key: "department", label: "부서" },
  { key: "mobilePhone", label: "휴대폰" },
  { key: "officePhone", label: "사무실" },
  { key: "email", label: "이메일" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** 기관 목록 — 사업장 마스터에 넣지 않는, 거래처가 아닌 기관·업체와 그 담당자. */
export function OrganizationBoard() {
  const { theme } = useCdashTheme();
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canPromote, setCanPromote] = useState(false);
  const [canViewFacility, setCanViewFacility] = useState(false);
  const [origin, setOrigin] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [contacts, setContacts] = useState<OrgContact[]>([]);
  const [orgForm, setOrgForm] = useState<typeof EMPTY_ORG | null>(null);
  const [contactForm, setContactForm] = useState<(typeof EMPTY_CONTACT & { id?: number }) | null>(null);
  const [roles, setRoles] = useState<string[]>(["sales"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const visibleRows = useMemo(() => (origin ? rows.filter((row) => row.kind === origin) : rows), [rows, origin]);
  const paging = useClientPaging(visibleRows, "organizations-page-size", loading);
  const isFacility = detail?.source === "facility";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, category });
      const data = await api<{ organizations: OrgRow[]; canEdit: boolean; canPromote: boolean; canViewFacility: boolean }>(`/api/organizations?${params}`);
      setRows(data.organizations);
      setCanEdit(data.canEdit);
      setCanPromote(data.canPromote);
      setCanViewFacility(data.canViewFacility);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, category]);
  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (orgId: string, kind: OrgRow["kind"] = "organization") => {
    const base = kind === "facility" ? "/api/organizations/facility/" : "/api/organizations/";
    const data = await api<{ organization: OrgDetail; contacts: OrgContact[] }>(`${base}${encodeURIComponent(orgId)}`);
    setDetail(data.organization);
    setContacts(data.contacts);
  }, []);
  const select = (row: OrgRow) => {
    setSelectedId(row.orgId);
    setOrgForm(null);
    setContactForm(null);
    loadDetail(row.orgId, row.kind).catch((e) => setError((e as Error).message));
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveOrg = () => orgForm && void act(async () => {
    if (selectedId && detail) {
      await api(`/api/organizations/${encodeURIComponent(selectedId)}`, jsonInit("PATCH", orgForm));
      await loadDetail(selectedId);
    } else {
      const r = await api<{ orgId: string }>("/api/organizations", jsonInit("POST", orgForm));
      setSelectedId(r.orgId);
      await loadDetail(r.orgId);
    }
    setOrgForm(null);
    await load();
  });
  const removeOrg = () => detail && window.confirm(`${detail.orgName} 을(를) 기관 목록에서 삭제합니다.`) && void act(async () => {
    await api(`/api/organizations/${encodeURIComponent(detail.orgId)}`, { method: "DELETE" });
    setSelectedId(null);
    setDetail(null);
    setContacts([]);
    await load();
  });
  const saveContact = () => contactForm && selectedId && void act(async () => {
    await api(`/api/organizations/${encodeURIComponent(selectedId)}/contacts`, jsonInit("POST", contactForm));
    setContactForm(null);
    await loadDetail(selectedId);
    await load();
  });
  const removeContact = (contact: OrgContact) => selectedId && window.confirm(`${contact.personName} 담당자를 삭제합니다.`) && void act(async () => {
    await api(`/api/organizations/${encodeURIComponent(selectedId)}/contacts?contactId=${contact.id}`, { method: "DELETE" });
    await loadDetail(selectedId);
    await load();
  });
  const promote = () => detail && window.confirm(`${detail.orgName} 을(를) 거래처로 전환해 사업장 마스터로 옮깁니다. 기관 목록에서는 빠집니다.`) && void act(async () => {
    const url = isFacility ? `/api/organizations/facility/${encodeURIComponent(detail.orgId)}` : `/api/organizations/${encodeURIComponent(detail.orgId)}/promote`;
    const r = await api<{ facilityId: string; created: boolean }>(url, jsonInit("POST", { tradeRoles: roles }));
    setMessage(isFacility ? "거래처로 지정했습니다. 이제 사업장 마스터에 나옵니다." : r.created ? "사업장 마스터에 등록했습니다." : "같은 사업장이 이미 있어 그 사업장에 담당자를 옮겼습니다.");
    setSelectedId(null);
    setDetail(null);
    setContacts([]);
    await load();
  });
  const selectRole = (role: string) => setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return (
    <div className="cdash cd-fields-white p-4 md:p-5 flex flex-col gap-4 min-h-full rounded-lg" data-theme={theme}>
      <CdPageHeader
        title="기관 목록"
        helpTopic="organizations.list"
        actions={canEdit ? (
          <>
            <Link href="/organizations/import" className="cd-btn cd-btn-ghost cd-btn-sm"><Upload className="w-3.5 h-3.5" /> 연락처 가져오기</Link>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => { setSelectedId(null); setDetail(null); setContacts([]); setContactForm(null); setOrgForm({ ...EMPTY_ORG }); }}>
              <Plus className="w-3.5 h-3.5" /> 기관 등록
            </button>
          </>
        ) : undefined}
      />
      {error && <div role="alert" className="cd-card p-3 cd-error-text">{error}</div>}
      {message && <div role="status" className="cd-card p-3 cd-text">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 items-start">
        <section className="flex flex-col gap-3" aria-label="기관 목록">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint" aria-hidden />
              <input aria-label="기관명·담당자 검색" placeholder="기관명·담당자 검색" className="cd-input !w-56 !pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select aria-label="기관 구분" className="cd-input !w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">전체 구분</option>
              {ORG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select aria-label="출처" className="cd-input !w-auto" value={origin} onChange={(e) => { setOrigin(e.target.value); paging.resetPage(); }}>
              <option value="">전체 출처</option>
              <option value="organization">등록·가져온 기관</option>
              <option value="facility">기존 사업장</option>
            </select>
            <span className="text-sm cd-text-faint">{visibleRows.length.toLocaleString()}곳</span>
          </div>
          <div className="cd-card rounded-lg overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-faint">
                  <th className="p-3">기관명</th><th className="p-3">구분</th><th className="p-3">출처</th><th className="p-3">지역</th><th className="p-3 text-right">담당자</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visibleRows.length === 0 && <tr><td colSpan={5} className="p-4 text-center cd-text-faint">등록된 기관이 없습니다.</td></tr>}
                {paging.pageRows.map((row) => (
                  <tr key={row.orgId} className="border-t cd-border-c cd-text cursor-pointer" style={selectedId === row.orgId ? { backgroundColor: "var(--cd-row-selected)" } : undefined} onClick={() => select(row)}>
                    <td className="p-3">
                      <button type="button" className="font-semibold text-left" onClick={(e) => { e.stopPropagation(); select(row); }}>{row.orgName}</button>
                    </td>
                    <td className="p-3">{row.orgCategory ?? "—"}</td>
                    <td className="p-3 whitespace-nowrap">{row.kind === "facility" ? "기존 사업장" : "기관"}</td>
                    <td className="p-3">{row.region ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">{row.contactCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paging.pager}
        </section>

        <section className="cd-card rounded-lg p-4 flex flex-col gap-3 text-sm cd-text" aria-label="기관 상세">
          {orgForm ? (
            <>
              <h2 className="font-semibold">{detail ? "기관 정보 수정" : "기관 등록"}</h2>
              <label className="flex flex-col gap-1">
                <span className="text-xs cd-text-muted">구분</span>
                <select className="cd-input" value={orgForm.orgCategory} onChange={(e) => setOrgForm({ ...orgForm, orgCategory: e.target.value })}>
                  {ORG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              {ORG_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-xs cd-text-muted">{f.label}</span>
                  <input className="cd-input" value={orgForm[f.key]} onChange={(e) => setOrgForm({ ...orgForm, [f.key]: e.target.value })} />
                </label>
              ))}
              <div className="flex gap-2">
                <button type="button" disabled={busy} className="cd-btn cd-btn-primary cd-btn-sm" onClick={saveOrg}><Save className="w-3.5 h-3.5" /> 저장</button>
                <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setOrgForm(null)}><X className="w-3.5 h-3.5" /> 취소</button>
              </div>
            </>
          ) : !detail ? (
            <p className="cd-text-faint">왼쪽에서 기관을 고르세요.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-base flex-1 min-w-0">{detail.orgName}</h2>
                {isFacility && canViewFacility && (
                  <Link href={`/facilities?focus=${encodeURIComponent(detail.orgId)}`} className="cd-btn cd-btn-ghost cd-btn-sm">사업장 화면 열기</Link>
                )}
                {canEdit && !isFacility && (
                  <>
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setOrgForm({
                      orgName: detail.orgName, orgCategory: detail.orgCategory ?? "민간기업", businessRegistrationNo: detail.businessRegistrationNo ?? "",
                      corporateRegistrationNo: detail.corporateRegistrationNo ?? "", address: detail.address ?? "", phoneNumber: detail.phoneNumber ?? "",
                      homepageUrl: detail.homepageUrl ?? "", memo: detail.memo ?? "",
                    })}>수정</button>
                    <button type="button" disabled={busy} className="cd-btn cd-btn-ghost cd-btn-sm" onClick={removeOrg}><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
                  </>
                )}
              </div>
              <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1">
                <dt className="cd-text-faint">구분</dt><dd>{detail.orgCategory ?? "—"}</dd>
                <dt className="cd-text-faint">사업자번호</dt><dd>{detail.businessRegistrationNo ?? "—"}</dd>
                <dt className="cd-text-faint">대표전화</dt><dd>{detail.phoneNumber ?? "—"}</dd>
                <dt className="cd-text-faint">주소</dt><dd>{detail.address ?? "—"}</dd>
                <dt className="cd-text-faint">홈페이지</dt><dd>{detail.homepageUrl ?? "—"}</dd>
                {detail.memo && (<><dt className="cd-text-faint">메모</dt><dd>{detail.memo}</dd></>)}
              </dl>
              {canPromote && (
                <div className="flex flex-wrap items-center gap-2 border-t cd-border-c pt-3">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={roles.includes("sales")} onChange={() => selectRole("sales")} />매출</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={roles.includes("purchase")} onChange={() => selectRole("purchase")} />매입</label>
                  <button type="button" disabled={busy || !roles.length} className="cd-btn cd-btn-soft cd-btn-sm" onClick={promote}><ArrowRight className="w-3.5 h-3.5" /> 거래처로 전환</button>
                </div>
              )}
              <div className="flex items-center gap-2 border-t cd-border-c pt-3">
                <h3 className="font-semibold flex-1">담당자 {contacts.length}명</h3>
                {canEdit && !isFacility && <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setContactForm({ ...EMPTY_CONTACT })}><Plus className="w-3.5 h-3.5" /> 담당자 추가</button>}
              </div>
              {contactForm && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border cd-border-c rounded-lg p-3">
                  {CONTACT_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1">
                      <span className="text-xs cd-text-muted">{f.label}</span>
                      <input className="cd-input" value={contactForm[f.key]} onChange={(e) => setContactForm({ ...contactForm, [f.key]: e.target.value })} />
                    </label>
                  ))}
                  <div className="sm:col-span-2 flex gap-2">
                    <button type="button" disabled={busy} className="cd-btn cd-btn-primary cd-btn-sm" onClick={saveContact}><Save className="w-3.5 h-3.5" /> 저장</button>
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setContactForm(null)}><X className="w-3.5 h-3.5" /> 취소</button>
                  </div>
                </div>
              )}
              <ul className="flex flex-col gap-2">
                {contacts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start gap-2 border-t cd-border-c pt-2 first:border-t-0 first:pt-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{p.personName}{p.title ? ` ${p.title}` : ""}{p.department ? <span className="font-normal cd-text-faint"> · {p.department}</span> : null}</div>
                      <div className="text-xs cd-text-faint">{[p.mobilePhone, p.officePhone, p.email].filter(Boolean).join(" · ") || "연락처 없음"}</div>
                    </div>
                    {canEdit && !isFacility && (
                      <>
                        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${p.personName} 수정`} onClick={() => setContactForm({
                          id: p.id, personName: p.personName, title: p.title ?? "", department: p.department ?? "", officePhone: p.officePhone ?? "",
                          mobilePhone: p.mobilePhone ?? "", faxNumber: p.faxNumber ?? "", email: p.email ?? "",
                        })}>수정</button>
                        <button type="button" disabled={busy} className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${p.personName} 삭제`} onClick={() => removeContact(p)}><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
