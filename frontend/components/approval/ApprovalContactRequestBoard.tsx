"use client";

// 접견인 명함 등록(회신) — 운영자가 요청한 미계약 업체 접견인 정보를 기안자가 채운다(351).
// 명함 사진을 올리면 인식 결과로 칸을 채우고, 직접 입력도 된다. 회신은 요청에 담기며
// 업체·담당자 등록은 운영자가 [미계약 업체 정리]에서 확정한다.
// 진입: 할 일의 링크(/approval/contact-request?id=…). id 가 없으면 내가 받은 요청 목록을 보여 준다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Camera, Contact, Plus, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import "@/components/cdash/cdash.css";

interface PersonRow {
  name: string;
  title: string;
  department: string;
  mobilePhone: string;
  officePhone: string;
  email: string;
}

interface CompanyInfo {
  address: string;
  phone: string;
  homepage: string;
  brn: string;
}

interface RequestRow {
  requestId: string;
  docId: string;
  companyName: string;
  status: "pending" | "done" | "canceled" | "closed";
  note: string | null;
  requestedByName: string | null;
  createdAt: string;
  response: { company?: Partial<CompanyInfo>; people: Partial<PersonRow>[] } | null;
}

const EMPTY_PERSON: PersonRow = { name: "", title: "", department: "", mobilePhone: "", officePhone: "", email: "" };
const EMPTY_COMPANY: CompanyInfo = { address: "", phone: "", homepage: "", brn: "" };
const PERSON_COLS: { key: keyof PersonRow; label: string; width: string }[] = [
  { key: "name", label: "성명", width: "!w-24" },
  { key: "title", label: "직함", width: "!w-24" },
  { key: "department", label: "부서", width: "!w-28" },
  { key: "mobilePhone", label: "휴대폰", width: "!w-32" },
  { key: "officePhone", label: "사무실 전화", width: "!w-32" },
  { key: "email", label: "이메일", width: "!w-44" },
];
const toRow = (p: Partial<PersonRow>): PersonRow => ({
  name: p.name ?? "",
  title: p.title ?? "",
  department: p.department ?? "",
  mobilePhone: p.mobilePhone ?? "",
  officePhone: p.officePhone ?? "",
  email: p.email ?? "",
});

export function ApprovalContactRequestBoard() {
  const { theme } = useCdashTheme();
  const id = useSearchParams().get("id");
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [docLabel, setDocLabel] = useState<string | null>(null);
  const [mine, setMine] = useState<RequestRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([{ ...EMPTY_PERSON }]);
  const [company, setCompany] = useState<CompanyInfo>(EMPTY_COMPANY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/contact-requests${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "불러오지 못했습니다.");
      if (!id) {
        setMine(d.requests ?? []);
        return;
      }
      const r = d.request as RequestRow;
      setRequest(r);
      setDocLabel(d.docLabel ?? null);
      // 이미 회신했으면 그 값을, 아니면 문서에 적은 접견인을 초기값으로
      const seed = r.response?.people?.length ? r.response.people : ((d.receivers ?? []) as Partial<PersonRow>[]);
      setPeople(seed.length ? seed.map(toRow) : [{ ...EMPTY_PERSON }]);
      setCompany({ ...EMPTY_COMPANY, ...Object.fromEntries(Object.entries(r.response?.company ?? {}).map(([k, v]) => [k, v ?? ""])) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPerson = (i: number, key: keyof PersonRow, value: string) =>
    setPeople((prev) => prev.map((p, pi) => (pi === i ? { ...p, [key]: value } : p)));

  /** 명함 인식 결과를 칸에 넣는다 — 같은 이름의 줄이 있으면 빈 칸만 채우고, 없으면 줄을 더한다. */
  const applyCard = (f: Record<string, string | null>) => {
    const card = toRow({
      name: f.personName ?? "",
      title: f.title ?? "",
      department: f.department ?? "",
      mobilePhone: f.mobilePhone ?? "",
      officePhone: f.officePhone ?? "",
      email: f.email ?? "",
    });
    if (card.name) {
      setPeople((prev) => {
        const i = prev.findIndex((p) => p.name.trim() === card.name);
        if (i >= 0) {
          return prev.map((p, pi) =>
            pi === i ? (Object.fromEntries(PERSON_COLS.map(({ key }) => [key, p[key].trim() || card[key]])) as unknown as PersonRow) : p
          );
        }
        const blank = prev.findIndex((p) => !p.name.trim());
        return blank >= 0 ? prev.map((p, pi) => (pi === blank ? card : p)) : [...prev, card];
      });
    }
    setCompany((prev) => ({
      ...prev,
      address: prev.address.trim() || (f.address ?? ""),
      phone: prev.phone.trim() || (f.officePhone ?? ""),
      homepage: prev.homepage.trim() || (f.homepage ?? ""),
    }));
  };

  const onCard = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/facilities/business-card/parse", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "명함을 읽지 못했습니다.");
      if (!d.fields) {
        setMsg(d.warning ?? "명함을 자동으로 읽지 못했습니다. 직접 입력해 주세요.");
        return;
      }
      applyCard(d.fields);
      setMsg("명함에서 읽은 내용을 넣었습니다. 틀린 곳이 없는지 확인하세요.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!request) return;
    const rows = people.filter((p) => p.name.trim());
    if (!rows.length) {
      setError("접견인 성명을 한 명 이상 입력하세요.");
      return;
    }
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/approval/contact-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.requestId, response: { company, people: rows } }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "등록하지 못했습니다.");
      setRequest(d.request);
      setMsg("등록했습니다. 운영자가 확인한 뒤 업체와 담당자로 반영합니다.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closed = request != null && (request.status === "canceled" || request.status === "closed");

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-lg overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<Contact className="w-5 h-5" />}
        eyebrow="Approval · Contact request"
        title="접견인 명함 등록"
        helpTopic="approval.contact-request"
      />
      {msg && <p className="text-[12px] cd-text">{msg}</p>}
      {error && <p className="text-[12px] cd-error-text">{error}</p>}

      {!id && !loading && (
        mine.length ? (
          <div className="cd-card rounded-lg p-5 flex flex-col gap-2">
            <h2 className="text-[14px] font-semibold cd-text">내가 받은 요청</h2>
            {mine.map((r) => (
              <Link key={r.requestId} href={`/approval/contact-request?id=${encodeURIComponent(r.requestId)}`} className="flex items-center gap-2 text-[13px] cd-text-primary">
                {r.companyName}
                <span className="text-[11px] cd-text-faint">{r.createdAt.slice(0, 10)} 요청</span>
              </Link>
            ))}
          </div>
        ) : (
          <CdEmptyState icon={<Contact className="w-6 h-6" />} title="받은 요청이 없습니다" />
        )
      )}

      {id && request && (
        <div className="cd-card rounded-lg p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[14px] font-semibold cd-text">{request.companyName}</h2>
            {request.status === "done" && <CdBadge tone="success">등록 완료</CdBadge>}
            {request.status === "pending" && <CdBadge tone="warn">등록 대기</CdBadge>}
            {closed && <CdBadge tone="idle">{request.status === "canceled" ? "요청 취소됨" : "운영자가 등록을 마침"}</CdBadge>}
            <Link href={`/approval?docId=${encodeURIComponent(request.docId)}`} className="text-[12px] cd-text-primary" target="_blank">
              {docLabel ?? "원 문서"} 열기
            </Link>
          </div>
          {request.note && <p className="text-[12px] cd-text-faint">요청 메모({request.requestedByName ?? "운영자"}): {request.note}</p>}

          {!closed && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onCard(e.target.files?.[0])} />
                <CdButton size="sm" icon={<Camera className="w-3.5 h-3.5" />} loading={busy} onClick={() => fileRef.current?.click()}>
                  명함 사진 올리기
                </CdButton>
                <CdButton size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setPeople((prev) => [...prev, { ...EMPTY_PERSON }])}>
                  접견인 추가
                </CdButton>
              </div>

              <div className="overflow-x-auto">
                <table className="text-[13px]">
                  <thead className="cd-table-head">
                    <tr>
                      {PERSON_COLS.map((c) => (
                        <th key={c.key} className="py-2 pr-2 text-left">{c.label}</th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p, i) => (
                      <tr key={i}>
                        {PERSON_COLS.map((c) => (
                          <td key={c.key} className="py-1 pr-2">
                            <input className={`cd-input ${c.width} text-[13px]`} aria-label={c.label} value={p[c.key]} onChange={(e) => setPerson(i, c.key, e.target.value)} />
                          </td>
                        ))}
                        <td className="py-1">
                          <button type="button" className="cd-action p-1.5 cd-text-faint" title="줄 삭제" disabled={people.length === 1} onClick={() => setPeople((prev) => prev.filter((_, pi) => pi !== i))}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {([
                  ["address", "업체 주소"],
                  ["phone", "대표 전화"],
                  ["homepage", "홈페이지"],
                  ["brn", "사업자등록번호"],
                ] as [keyof CompanyInfo, string][]).map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1 text-[12px] cd-text-faint">
                    <span className="cd-label-text">{label}</span>
                    <input className="cd-input text-[13px]" value={company[key]} onChange={(e) => setCompany((prev) => ({ ...prev, [key]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <p className="cd-hint">성명만 필수입니다. 아는 만큼 적으면 됩니다.</p>

              <div className="flex justify-end">
                <CdButton variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
                  {request.status === "done" ? "다시 등록" : "등록 완료"}
                </CdButton>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
