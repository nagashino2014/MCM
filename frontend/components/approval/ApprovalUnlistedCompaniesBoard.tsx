"use client";

// 미계약 업체 정리(결재 운영, 2026-11-11) — 결재 문서에 '미계약 업체(직접 입력)'로 적힌 업체와 접견인을 모아
// 기존 업체에 연결하거나 새로 등록한다. 새 업체는 기본 '기타 업체·기관'. 접견인은 그 업체의 담당자로 넣고
// 원 문서에 연결한다. 연락처가 필요하면 기안자에게 명함 등록을 요청한다(351).
// 서버: lib/approval/unlisted-companies.ts.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Search } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import "@/components/cdash/cdash.css";

interface RequestInfo {
  requestId: string;
  status: "pending" | "done" | "canceled" | "closed";
  createdAt: string;
  respondedAt: string | null;
}

interface DocRow {
  docId: string;
  docNo: string | null;
  formName: string;
  drafterName: string | null;
  submittedAt: string | null;
  companyText: string;
  receivers: { name: string; title: string | null }[];
  request: RequestInfo | null;
}

interface Candidate {
  facilityId: string;
  companyName: string;
  address: string | null;
  kind: string;
  other: boolean;
}

interface Person {
  name: string;
  title?: string | null;
  mobilePhone?: string | null;
  email?: string | null;
}

interface Company {
  key: string;
  name: string;
  docs: DocRow[];
  people: Person[];
  candidates: Candidate[];
  suggestedCategory: string;
}

/** 처리 방법 — 기존 업체 연결(facilityId) 또는 새로 등록(기타 / 사업장) */
type Choice = { kind: "link"; facilityId: string } | { kind: "create"; listing: "other" | "master" };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");
const choiceId = (c: Choice) => (c.kind === "link" ? `link:${c.facilityId}` : `create:${c.listing}`);

/** 이름·지역이 함께 맞는 후보가 하나뿐이면 그 연결을, 아니면 '기타 업체·기관' 신규 등록을 기본으로 고른다. */
function defaultChoice(c: Company): Choice {
  const strong = c.candidates.filter((x) => x.kind === "name_region" || x.kind === "name");
  return strong.length === 1 ? { kind: "link", facilityId: strong[0].facilityId } : { kind: "create", listing: "other" };
}

export function ApprovalUnlistedCompaniesBoard() {
  const { theme } = useCdashTheme();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [requestsReady, setRequestsReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [addContacts, setAddContacts] = useState<Record<string, boolean>>({});
  // 후보에 없는 업체를 직접 찾아 연결 — 업체별 검색어·결과
  const [searchQ, setSearchQ] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, Candidate[]>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/approval/unlisted-companies", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "불러오지 못했습니다.");
      setCompanies(d.companies ?? []);
      setRequestsReady(d.requestsReady !== false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setMsg(null);
    setError(null);
    setBusy(key);
    try {
      setMsg(await fn());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error ?? "처리하지 못했습니다.");
    return d;
  };

  const resolve = (c: Company) => {
    const choice = choices[c.key] ?? defaultChoice(c);
    const withContacts = addContacts[c.key] ?? true;
    const target =
      choice.kind === "link"
        ? [...c.candidates, ...(extra[c.key] ?? [])].find((x) => x.facilityId === choice.facilityId)?.companyName ?? "선택한 업체"
        : choice.listing === "other"
          ? "기타 업체·기관(신규)"
          : "사업장(신규)";
    if (!window.confirm(`'${c.name}' 문서 ${c.docs.length}건을 ${target}에 연결합니다.${withContacts && c.people.length ? `\n접견인 ${c.people.length}명을 담당자로 등록합니다.` : ""}\n계속할까요?`)) return;
    void run(`resolve:${c.key}`, async () => {
      const d = await send("/api/approval/unlisted-companies", "POST", {
        key: c.key,
        action: choice.kind,
        facilityId: choice.kind === "link" ? choice.facilityId : null,
        listing: choice.kind === "create" ? choice.listing : undefined,
        addContacts: withContacts,
      });
      return `'${d.companyName}'에 문서 ${d.docs}건을 연결했습니다${d.contacts ? ` · 담당자 ${d.contacts}명 등록` : ""}.`;
    });
  };

  const requestCard = (c: Company, doc: DocRow) =>
    run(`req:${doc.docId}`, async () => {
      const d = await send("/api/approval/contact-requests", "POST", { docId: doc.docId });
      const who = doc.drafterName ?? "기안자";
      if (d.reused) return `${who}에게 이미 요청해 둔 건입니다.`;
      return d.todoCreated ? `${who}에게 명함 등록을 요청했습니다(할 일·알림 발송).` : `${who}에게 요청을 남겼지만 할 일은 만들지 못했습니다. 직접 알려 주세요.`;
    });

  const cancelRequest = (doc: DocRow) =>
    run(`req:${doc.docId}`, async () => {
      await send(`/api/approval/contact-requests?requestId=${encodeURIComponent(doc.request?.requestId ?? "")}`, "DELETE");
      return "요청을 취소했습니다.";
    });

  const search = async (c: Company) => {
    const q = (searchQ[c.key] ?? "").trim();
    if (q.length < 2) return;
    setError(null);
    try {
      const res = await fetch(`/api/approval/facility-search?${new URLSearchParams({ q, limit: "10" }).toString()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "검색하지 못했습니다.");
      const found: Candidate[] = (d.items ?? []).map((f: { facilityId: string; companyName: string; siteAddress?: string | null }) => ({
        facilityId: f.facilityId,
        companyName: f.companyName,
        address: f.siteAddress ?? null,
        kind: "search",
        other: false,
      }));
      const known = new Set(c.candidates.map((x) => x.facilityId));
      setExtra((prev) => ({ ...prev, [c.key]: found.filter((x) => !known.has(x.facilityId)) }));
      if (!found.length) setMsg(`'${q}'로 찾은 업체가 없습니다.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-lg overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<Building2 className="w-5 h-5" />}
        eyebrow="Approval · Unlisted companies"
        title="미계약 업체 정리"
        helpTopic="approval-ops.unlisted-companies"
      />

      {!requestsReady && (
        <div className="cd-card rounded-lg p-4 text-[13px] cd-error-text">
          명함 등록 요청 표(마이그레이션 351)가 아직 적용되지 않아 요청 기능을 쓸 수 없습니다. 업체 등록·연결은 할 수 있습니다.
        </div>
      )}
      {msg && <p className="text-[12px] cd-text">{msg}</p>}
      {error && <p className="text-[12px] cd-error-text">{error}</p>}

      {!loading && companies.length === 0 && !error && (
        <CdEmptyState
          icon={<Building2 className="w-6 h-6" />}
          title="정리할 미계약 업체가 없습니다"
          description="결재 문서에 직접 입력된 업체가 생기면 여기에 모입니다."
        />
      )}

      {companies.map((c) => {
        const choice = choices[c.key] ?? defaultChoice(c);
        const options = [...c.candidates, ...(extra[c.key] ?? [])];
        const pick = (next: Choice) => setChoices((prev) => ({ ...prev, [c.key]: next }));
        return (
          <div key={c.key} className="cd-card rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[14px] font-semibold cd-text">{c.name}</h2>
              <CdBadge tone="idle">문서 {c.docs.length}건</CdBadge>
              <CdBadge tone="outline">{c.suggestedCategory}</CdBadge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead className="cd-table-head">
                  <tr>
                    <th className="py-2 pr-3 text-left">문서</th>
                    <th className="py-2 pr-3 text-left">기안자</th>
                    <th className="py-2 pr-3 text-left">상신일</th>
                    <th className="py-2 pr-3 text-left">접견인</th>
                    <th className="py-2 text-right">명함 등록</th>
                  </tr>
                </thead>
                <tbody>
                  {c.docs.map((d) => (
                    <tr key={d.docId} className="border-t cd-border-c">
                      <td className="py-2 pr-3">
                        <Link href={`/approval?docId=${encodeURIComponent(d.docId)}`} className="cd-text-primary" target="_blank">
                          {d.formName} {d.docNo ?? ""}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 cd-text whitespace-nowrap">{d.drafterName ?? "-"}</td>
                      <td className="py-2 pr-3 cd-text-faint whitespace-nowrap">{day(d.submittedAt)}</td>
                      <td className="py-2 pr-3 cd-text">
                        {d.receivers.length ? d.receivers.map((r) => `${r.name}${r.title ? ` ${r.title}` : ""}`).join(", ") : <span className="cd-text-faint">없음</span>}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {d.request?.status === "done" ? (
                          <CdBadge tone="success">회신 완료 {day(d.request.respondedAt)}</CdBadge>
                        ) : d.request?.status === "pending" ? (
                          <span className="inline-flex items-center gap-2">
                            <CdBadge tone="warn">요청됨 {day(d.request.createdAt)}</CdBadge>
                            <CdButton size="sm" variant="ghost" disabled={busy != null} onClick={() => void cancelRequest(d)}>
                              요청 취소
                            </CdButton>
                          </span>
                        ) : (
                          <CdButton size="sm" disabled={busy != null || !requestsReady} loading={busy === `req:${d.docId}`} onClick={() => void requestCard(c, d)}>
                            명함 등록 요청
                          </CdButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {c.people.length > 0 && (
              <p className="text-[12px] cd-text-faint">
                등록할 접견인:{" "}
                <span className="cd-text">
                  {c.people.map((p) => `${p.name}${p.title ? ` ${p.title}` : ""}${p.mobilePhone ? ` ${p.mobilePhone}` : ""}`).join(", ")}
                </span>
              </p>
            )}

            <div className="flex flex-col gap-1.5 border-t cd-border-c pt-3">
              {options.map((o) => {
                const opt: Choice = { kind: "link", facilityId: o.facilityId };
                return (
                  <label key={o.facilityId} className="flex items-center gap-2 flex-wrap text-[13px] cd-text cursor-pointer">
                    <input type="radio" name={`choice-${c.key}`} checked={choiceId(choice) === choiceId(opt)} onChange={() => pick(opt)} />
                    <span>기존 업체에 연결 — {o.companyName}</span>
                    <CdBadge tone={o.other ? "outline" : "info"}>{o.other ? "기타 업체·기관" : "사업장"}</CdBadge>
                    {o.address && <span className="text-[11px] cd-text-faint truncate">{o.address}</span>}
                  </label>
                );
              })}
              <label className="flex items-center gap-2 flex-wrap text-[13px] cd-text cursor-pointer">
                <input type="radio" name={`choice-${c.key}`} checked={choiceId(choice) === "create:other"} onChange={() => pick({ kind: "create", listing: "other" })} />
                <span>새로 등록 — 기타 업체·기관</span>
                <span className="text-[11px] cd-text-faint">계약 전 업체의 기본 위치입니다. 계약이 생기면 거래처로 승격합니다.</span>
              </label>
              <label className="flex items-center gap-2 flex-wrap text-[13px] cd-text cursor-pointer">
                <input type="radio" name={`choice-${c.key}`} checked={choiceId(choice) === "create:master"} onChange={() => pick({ kind: "create", listing: "master" })} />
                <span>새로 등록 — 사업장</span>
              </label>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <input
                  className="cd-input !w-56 text-[13px]"
                  placeholder="다른 업체 검색(2자 이상)"
                  value={searchQ[c.key] ?? ""}
                  onChange={(e) => setSearchQ((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void search(c);
                  }}
                />
                <CdButton size="sm" icon={<Search className="w-3.5 h-3.5" />} onClick={() => void search(c)}>
                  업체 검색
                </CdButton>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer">
                <input
                  type="checkbox"
                  disabled={c.people.length === 0}
                  checked={c.people.length > 0 && (addContacts[c.key] ?? true)}
                  onChange={(e) => setAddContacts((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                />
                접견인 {c.people.length}명을 담당자로 등록
              </label>
              <CdButton variant="primary" size="sm" disabled={busy != null} loading={busy === `resolve:${c.key}`} onClick={() => resolve(c)}>
                등록·연결
              </CdButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
