"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Search, Upload } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { ORG_CATEGORIES } from "@/lib/directory-categories";
import { formatBusinessRegistrationNo } from "@/lib/ieps/formatters";
import "@/components/cdash/cdash.css";

type Stage = "connect" | "recommend" | "review" | "not_found" | "searching" | "done" | "excluded";
const STAGES: { key: Stage; label: string }[] = [
  { key: "connect", label: "사업장 연결 확인" },
  { key: "recommend", label: "번호 확인됨" },
  { key: "review", label: "검토 필요" },
  { key: "not_found", label: "번호 못 찾음" },
  { key: "searching", label: "검색 중" },
  { key: "done", label: "분류 완료" },
  { key: "excluded", label: "제외" },
];
const KIND_LABELS: Record<string, string> = {
  brn: "사업자번호 일치", name_region: "이름·지역 일치", name: "이름 일치·지역 다름", prefix_region: "이름 일부·지역 일치", prefix: "이름 일부 일치", address: "주소만 일치",
};
const SOURCE_LABELS: Record<string, string> = { dart: "DART", fsc: "금융위원회", naver: "네이버 기업정보", bizno: "비즈노" };
const DECISION_LABELS: Record<string, string> = { link: "사업장 연결", partner: "거래처 등록", other: "기타 목록", exclude: "제외" };

interface MatchCandidate { facilityId: string; companyName: string; address: string | null; kind: string }
interface SearchCandidate { source: string; name: string; brn: string | null; address: string | null; url: string | null; sameRegion: boolean; sameDomain: boolean }
interface Company {
  companyId: string; displayName: string; address: string | null; region: string | null; homepage: string | null; emailDomain: string | null;
  suggestedCategory: string | null; matchCandidates: MatchCandidate[]; searchStatus: string; searchOutcomes: Record<string, { status: string; note?: string }>;
  searchCandidates: SearchCandidate[]; searchVerdict: string | null; foundBrn: string | null; searchNote: string | null;
  decision: string | null; decidedName: string | null; contactCount: number;
}
interface Contact { id: number; personName: string; title: string | null; department: string | null; officePhone: string | null; mobilePhone: string | null; email: string | null; status: string }
interface Batch { batchId: string; filename: string; uploadedAt: string; uploaderName: string; rowCount: number; newCount: number; duplicateCount: number; pendingCount: number }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function ContactImportPanel() {
  const { theme } = useCdashTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [queueEnabled, setQueueEnabled] = useState(true);
  const [stage, setStage] = useState<Stage>("connect");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<string[]>(["sales"]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const limit = 50;

  const loadBatches = useCallback(async () => {
    const data = await api<{ batches: Batch[]; canReview: boolean; queueEnabled: boolean }>("/api/contact-import/batches");
    setBatches(data.batches);
    setCanReview(data.canReview);
    setQueueEnabled(data.queueEnabled);
    return data.canReview;
  }, []);
  const loadCompanies = useCallback(async () => {
    const params = new URLSearchParams({ stage, q, limit: String(limit), offset: String(offset) });
    const data = await api<{ counts: Record<string, number>; companies: Company[]; total: number }>(`/api/contact-import/companies?${params}`);
    setCounts(data.counts);
    setCompanies(data.companies);
    setTotal(data.total);
  }, [stage, q, offset]);

  useEffect(() => {
    loadBatches().catch((e) => setError((e as Error).message));
  }, [loadBatches]);
  useEffect(() => {
    if (!canReview) return;
    setSelected(new Set());
    setOpenId(null);
    loadCompanies().catch((e) => setError((e as Error).message));
  }, [canReview, loadCompanies]);
  // 검색 중인 회사가 있으면 진행 상황을 따라간다.
  useEffect(() => {
    if (!canReview || !(counts.searching > 0)) return;
    const timer = setInterval(() => void loadCompanies().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [canReview, counts.searching, loadCompanies]);

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

  const upload = (file: File | undefined) => {
    if (!file) return;
    void act(async () => {
      const form = new FormData();
      form.set("file", file);
      const r = await api<{ newCount: number; duplicateCount: number; newCompanies: number; skippedRows: number; searchStarted: boolean; searchError: string | null }>(
        "/api/contact-import/batches", { method: "POST", body: form }
      );
      setMessage(`담당자 ${r.newCount}명·회사 ${r.newCompanies}곳을 대기 명단에 넣었습니다.`
        + (r.duplicateCount ? ` 이미 있던 ${r.duplicateCount}명은 합쳤습니다.` : "")
        + (r.skippedRows ? ` 이름이나 회사명이 없는 ${r.skippedRows}줄은 건너뛰었습니다.` : "")
        + (r.searchStarted ? " 사업자번호 검색을 시작했습니다." : ""));
      if (r.searchError) setError(r.searchError);
      await loadBatches();
      if (canReview) await loadCompanies();
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const cancelBatch = (batch: Batch) => {
    if (!window.confirm(`${batch.filename} 의 미분류 담당자 ${batch.pendingCount}명을 명단에서 지웁니다. 이미 옮겨진 담당자는 그대로 남습니다.`)) return;
    void act(async () => {
      const r = await api<{ removed: number }>(`/api/contact-import/batches?batchId=${encodeURIComponent(batch.batchId)}`, { method: "DELETE" });
      setMessage(`담당자 ${r.removed}명을 명단에서 지웠습니다.`);
      await loadBatches();
      if (canReview) await loadCompanies();
    });
  };

  const decide = (action: string) => {
    const ids = [...selected];
    void act(async () => {
      const items = ids.map((companyId) => {
        const company = companies.find((c) => c.companyId === companyId);
        return {
          companyId, action,
          facilityId: action === "link" ? picks[companyId] ?? (company?.matchCandidates.length === 1 ? company.matchCandidates[0].facilityId : null) : null,
          tradeRoles: action === "partner" ? roles : [],
          orgCategory: categories[companyId] ?? company?.suggestedCategory ?? null,
        };
      });
      const { results } = await api<{ results: { companyId: string; status: string; reason?: string }[] }>("/api/contact-import/companies", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }),
      });
      const done = results.filter((r) => r.status === "ok").length;
      const skipped = results.filter((r) => r.status !== "ok");
      setMessage(`${done}곳을 처리했습니다.` + (skipped.length ? ` ${skipped.length}곳은 건너뛰었습니다: ${[...new Set(skipped.map((r) => r.reason))].join(", ")}` : ""));
      setSelected(new Set());
      await loadCompanies();
      await loadBatches();
    });
  };

  const resumeSearch = () => void act(async () => {
    await api("/api/contact-import/search", { method: "POST" });
    setMessage("사업자번호 검색을 이어서 시작했습니다.");
    await loadCompanies();
  });

  const toggleOpen = (companyId: string) => {
    if (openId === companyId) {
      setOpenId(null);
      return;
    }
    setOpenId(companyId);
    setContacts([]);
    api<{ contacts: Contact[] }>(`/api/contact-import/companies/${encodeURIComponent(companyId)}`)
      .then((r) => setContacts(r.contacts))
      .catch((e) => setError((e as Error).message));
  };

  const allSelected = companies.length > 0 && companies.every((c) => selected.has(c.companyId));
  const decided = stage === "done" || stage === "excluded";
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(companies.map((c) => c.companyId)));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const selectRole = (role: string) => setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return (
    <div className="cdash cd-fields-white p-4 md:p-5 flex flex-col gap-4 min-h-full rounded-lg" data-theme={theme}>
      <CdPageHeader
        title="연락처 가져오기"
        helpTopic="external-parties.import"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" aria-label="연락처 엑셀 파일" onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" disabled={busy} className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> 엑셀 올리기
            </button>
          </>
        }
      />
      {error && <div role="alert" className="cd-card p-3 cd-error-text">{error}</div>}
      {message && <div role="status" className="cd-card p-3 cd-text">{message}</div>}

      <section className="cd-card rounded-lg overflow-x-auto" aria-label="올린 파일">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="cd-table-head">
            <tr className="text-left cd-text-faint">
              <th className="p-3">올린 파일</th><th className="p-3">올린 사람</th><th className="p-3">올린 때</th>
              <th className="p-3 text-right">파일 연락처</th><th className="p-3 text-right">새로 추가</th><th className="p-3 text-right">분류 대기</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && <tr><td colSpan={7} className="p-4 text-center cd-text-faint">아직 올린 파일이 없습니다.</td></tr>}
            {batches.map((b) => (
              <tr key={b.batchId} className="border-t cd-border-c cd-text">
                <td className="p-3">{b.filename}</td>
                <td className="p-3">{b.uploaderName}</td>
                <td className="p-3">{new Date(b.uploadedAt).toLocaleString("ko-KR")}</td>
                <td className="p-3 text-right tabular-nums">{b.rowCount.toLocaleString()}</td>
                <td className="p-3 text-right tabular-nums">{b.newCount.toLocaleString()}</td>
                <td className="p-3 text-right tabular-nums">{b.pendingCount.toLocaleString()}</td>
                <td className="p-3 text-right">
                  {b.pendingCount > 0 && <button type="button" disabled={busy} className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => cancelBatch(b)}>올리기 취소</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canReview && (
        <section className="flex flex-col gap-3" aria-label="회사 분류">
          <CdTabs
            items={STAGES.map((s) => ({ key: s.key, label: `${s.label} ${(counts[s.key] ?? 0).toLocaleString()}` }))}
            active={stage}
            onChange={(key) => { setStage(key); setOffset(0); }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint" aria-hidden />
              <input aria-label="회사명 검색" placeholder="회사명 검색" className="cd-input !w-56 !pl-8" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
            </label>
            <button type="button" disabled={busy || !queueEnabled} className="cd-btn cd-btn-ghost cd-btn-sm" onClick={resumeSearch}>
              <RefreshCw className="w-3.5 h-3.5" /> 검색 재개
            </button>
            {!queueEnabled && <span className="text-xs cd-warning-text">외부 조회 워커가 연결되지 않은 환경입니다. 검색은 대기 상태로 남습니다.</span>}
          </div>
          {selected.size > 0 && (
            <div className="cd-card p-3 !flex-row flex-wrap items-center gap-2 text-sm cd-text sticky top-0 z-10" role="group" aria-label="선택한 회사 분류">
              <b>{selected.size}곳 선택</b>
              {decided ? (
                <button type="button" disabled={busy} className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => decide("reopen")}>분류 되돌리기</button>
              ) : (
                <>
                  <button type="button" disabled={busy} className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => decide("link")}>사업장에 연결</button>
                  <span className="inline-flex items-center gap-2 border-l cd-border-c pl-2">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={roles.includes("sales")} onChange={() => selectRole("sales")} />매출</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={roles.includes("purchase")} onChange={() => selectRole("purchase")} />매입</label>
                    <button type="button" disabled={busy || !roles.length} className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => decide("partner")}>거래처로 등록</button>
                  </span>
                  <button type="button" disabled={busy} className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => decide("other")}>기타 목록으로</button>
                  <button type="button" disabled={busy} className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => decide("exclude")}>제외</button>
                </>
              )}
            </div>
          )}
          <div className="cd-card rounded-lg overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-faint">
                  <th className="p-3 w-8"><input type="checkbox" aria-label="이 쪽 전체 선택" checked={allSelected} onChange={toggleAll} /></th>
                  <th className="p-3 w-8" /><th className="p-3">회사</th><th className="p-3 text-right">담당자</th><th className="p-3">구분</th>
                  <th className="p-3">사업자번호</th><th className="p-3">{decided ? "분류 결과" : "기존 사업장 후보"}</th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 && <tr><td colSpan={7} className="p-4 text-center cd-text-faint">해당하는 회사가 없습니다.</td></tr>}
                {companies.map((c) => (
                  <Fragment key={c.companyId}>
                    <tr className="border-t cd-border-c cd-text align-top">
                      <td className="p-3"><input type="checkbox" aria-label={`${c.displayName} 선택`} checked={selected.has(c.companyId)} onChange={() => toggle(c.companyId)} /></td>
                      <td className="p-3">
                        <button type="button" aria-expanded={openId === c.companyId} aria-label={`${c.displayName} 상세`} className="cd-btn cd-btn-ghost cd-btn-sm !p-1" onClick={() => toggleOpen(c.companyId)}>
                          {openId === c.companyId ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="p-3"><div className="font-semibold">{c.displayName}</div><div className="text-xs cd-text-faint">{c.region ?? "지역 없음"}{c.homepage ? ` · ${c.homepage}` : ""}</div></td>
                      <td className="p-3 text-right tabular-nums">{c.contactCount}</td>
                      <td className="p-3">
                        <select aria-label={`${c.displayName} 기관 구분`} className="cd-input !w-auto" disabled={decided}
                          value={categories[c.companyId] ?? c.suggestedCategory ?? ""}
                          onChange={(e) => setCategories((prev) => ({ ...prev, [c.companyId]: e.target.value }))}>
                          {ORG_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </td>
                      <td className="p-3">
                        {c.foundBrn ? <span className="tabular-nums">{formatBusinessRegistrationNo(c.foundBrn)}</span> : <span className="cd-text-faint">{c.searchStatus === "pending" || c.searchStatus === "running" ? "검색 중" : "없음"}</span>}
                        {c.searchNote && <div className="text-xs cd-warning-text">{c.searchNote}</div>}
                      </td>
                      <td className="p-3">
                        {decided ? (
                          <span>{DECISION_LABELS[c.decision ?? ""] ?? "—"}{c.decidedName ? ` · ${c.decidedName}` : ""}</span>
                        ) : c.matchCandidates.length === 0 ? (
                          <span className="cd-text-faint">없음</span>
                        ) : (
                          <select aria-label={`${c.displayName} 연결할 사업장`} className="cd-input !w-auto max-w-[320px]"
                            value={picks[c.companyId] ?? (c.matchCandidates.length === 1 ? c.matchCandidates[0].facilityId : "")}
                            onChange={(e) => setPicks((prev) => ({ ...prev, [c.companyId]: e.target.value }))}>
                            {c.matchCandidates.length > 1 && <option value="">사업장 선택 ({c.matchCandidates.length}곳)</option>}
                            {c.matchCandidates.map((m) => <option key={m.facilityId} value={m.facilityId}>{m.companyName} — {KIND_LABELS[m.kind] ?? m.kind}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                    {openId === c.companyId && (
                      <tr className="border-t cd-border-c">
                        <td colSpan={7} className="p-3">
                          <div className="grid gap-3 lg:grid-cols-2 text-sm cd-text">
                            <div>
                              <h3 className="font-semibold mb-1">담당자</h3>
                              <ul className="flex flex-col gap-1">
                                {contacts.map((p) => (
                                  <li key={p.id}>
                                    {p.personName}{p.title ? ` ${p.title}` : ""}{p.department ? ` · ${p.department}` : ""}
                                    <span className="cd-text-faint"> {[p.mobilePhone, p.officePhone, p.email].filter(Boolean).join(" · ")}</span>
                                  </li>
                                ))}
                              </ul>
                              {c.address && <p className="mt-2 text-xs cd-text-faint">명함 주소: {c.address}</p>}
                            </div>
                            <div>
                              <h3 className="font-semibold mb-1">검색 근거</h3>
                              {c.searchCandidates.length === 0 && <p className="cd-text-faint">찾은 후보가 없습니다.</p>}
                              <ul className="flex flex-col gap-1">
                                {c.searchCandidates.map((s, i) => (
                                  <li key={i}>
                                    {SOURCE_LABELS[s.source] ?? s.source}: {s.name} {s.brn ? formatBusinessRegistrationNo(s.brn) : "(번호 없음)"}
                                    <span className="cd-text-faint"> {s.address ?? ""}{s.sameRegion ? " · 지역 일치" : ""}{s.sameDomain ? " · 도메인 일치" : ""}</span>
                                  </li>
                                ))}
                              </ul>
                              {Object.keys(c.searchOutcomes).length > 0 && (
                                <p className="mt-2 text-xs cd-text-faint">
                                  조회: {Object.entries(c.searchOutcomes).map(([source, o]) => `${SOURCE_LABELS[source] ?? source} ${o.status === "success" ? "결과 있음" : o.status === "not_found" ? "없음" : o.note ?? o.status}`).join(" / ")}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls total={total} limit={limit} offset={offset} loading={busy} onPageChange={setOffset} />
        </section>
      )}
    </div>
  );
}
