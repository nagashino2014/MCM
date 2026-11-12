"use client";

// 주소록 간이 등록(357, 2026-11-12 사용자 결정) — 메일의 보낸사람·받는사람·참조 주소에서 '주소록 추가'를 누르면 연다.
// 주소록은 업체 정보가 전제라 업체를 먼저 정한다: 기존 업체를 검색해 고르거나(이메일 도메인으로 추천), 없으면 업체명만으로
// 간이 업체를 만든다. 그다음 담당자를 적는다. 저장하면 주소록·받는 사람 검색에 바로 나오고, 관리자가 간이 등록 목록에서 확정한다.
// 저장은 POST /api/directory/quick.

import { useEffect, useRef, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdModal } from "@/components/cdash/CdModal";
import { useCdToast } from "@/components/cdash/CdToast";
import { useOutsideDismiss } from "@/components/ui/useOutsideDismiss";

interface FacilityHit {
  facilityId: string;
  companyName: string;
  region?: string | null;
  regionSido?: string | null;
  regionSigungu?: string | null;
  reason?: string;
}

interface Lookup {
  address: string;
  internal: boolean;
  existing: { id: number; personName: string; title: string | null; facilityId: string; facilityName: string | null }[];
  suggestions: FacilityHit[];
  domain: string | null;
}

export interface QuickContactResult {
  facilityId: string;
  facilityName: string;
  personId: number;
  facilityCreated: boolean;
}

const regionOf = (h: FacilityHit) => h.region ?? ([h.regionSido, h.regionSigungu].filter(Boolean).join(" ") || null);

export function QuickContactModal({
  email,
  displayName,
  source = "mail",
  onClose,
  onCreated,
}: {
  /** 누른 메일 주소("이름 <주소>" 도 된다). */
  email?: string | null;
  /** 메일 머리글의 표시 이름 — 담당자 이름 칸에 미리 넣는다. */
  displayName?: string | null;
  source?: "mail" | "directory";
  onClose: () => void;
  onCreated?: (r: QuickContactResult) => void;
}) {
  const { toast } = useCdToast();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [facility, setFacility] = useState<{ facilityId: string; name: string } | null>(null);
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [fq, setFq] = useState("");
  const [hits, setHits] = useState<FacilityHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(boxRef, open, () => setOpen(false));
  const [newCo, setNewCo] = useState({ companyName: "", phone: "", address: "", homepage: "" });
  const [conflict, setConflict] = useState<FacilityHit[] | null>(null);
  const initialName = (displayName ?? "").trim();
  const [person, setPerson] = useState({
    personName: initialName && !initialName.includes("@") ? initialName : "",
    title: "",
    mobilePhone: "",
    officePhone: "",
    email: email ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetch(`/api/directory/quick?lookup=${encodeURIComponent(email)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setLookupError(String(d.error ?? "주소를 확인하지 못했습니다."));
          return;
        }
        setLookup(d as Lookup);
        setPerson((p) => ({ ...p, email: (d as Lookup).address }));
        if ((d as Lookup).domain) setNewCo((c) => ({ ...c, homepage: c.homepage || (d as Lookup).domain! }));
      })
      .catch(() => !cancelled && setLookupError("주소를 확인하지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    const q = fq.trim();
    if (facility || mode !== "pick" || q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/approval/facility-search?q=${encodeURIComponent(q)}&limit=12`, { cache: "no-store", signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setHits(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [fq, facility, mode]);

  const choose = (h: FacilityHit) => {
    setFacility({ facilityId: h.facilityId, name: h.companyName });
    setMode("pick");
    setConflict(null);
    setOpen(false);
  };

  const startNew = () => {
    setFacility(null);
    setMode("new");
    setConflict(null);
    setNewCo((c) => ({ ...c, companyName: c.companyName || fq.trim() }));
  };

  const internal = !!lookup?.internal;

  const save = async (forceNewFacility = false) => {
    if (internal) return;
    if (!facility && !(mode === "new" && newCo.companyName.trim())) {
      toast(mode === "new" ? "업체명을 입력하세요." : "업체를 고르거나 새 업체로 간이 등록하세요.", "warn");
      return;
    }
    if (!person.personName.trim()) {
      toast("담당자 이름을 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const body = {
        facilityId: facility?.facilityId ?? null,
        newFacility: facility ? null : newCo,
        forceNewFacility,
        person,
        source,
        sourceAddress: email ?? null,
      };
      const r = await fetch("/api/directory/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(d.candidates)) {
        setConflict(d.candidates);
        return;
      }
      if (!r.ok) {
        toast(String(d.error ?? "등록하지 못했습니다."), "error");
        return;
      }
      toast(
        d.facilityCreated
          ? "간이 업체와 담당자를 주소록에 등록했습니다. 관리자가 업체 정보를 확정합니다."
          : "주소록에 등록했습니다. 주소록·받는 사람 검색에 바로 나옵니다.",
        "success"
      );
      onCreated?.(d as QuickContactResult);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const suggestions = lookup?.suggestions ?? [];

  return (
    <CdModal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={
        <span className="inline-flex items-center gap-1">
          주소록에 추가
          <CdHelp topic="directory.quick-register" />
        </span>
      }
      size="md"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} disabled={internal} onClick={() => void save(false)}>
            등록
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {email && (
          <p className="text-[13px] cd-text break-all">
            <span className="cd-text-faint">메일 주소</span> <span className="font-semibold">{lookup?.address ?? email}</span>
          </p>
        )}
        {lookupError && <p role="alert" className="text-[13px] cd-error-text">{lookupError}</p>}
        {internal && (
          <p role="alert" className="cd-card p-3 text-[13px] cd-text">
            회사 메일 주소입니다. 임직원은 주소록 임직원 탭에 이미 있습니다.
          </p>
        )}
        {!!lookup?.existing.length && (
          <div className="cd-card p-3 text-[13px] cd-text flex flex-col gap-1" role="status">
            <span className="font-semibold">이 주소는 이미 주소록에 있습니다.</span>
            {lookup.existing.map((x) => (
              <span key={x.id} className="cd-text-muted">
                {x.facilityName ?? "—"} · {x.personName}
                {x.title ? ` ${x.title}` : ""}
              </span>
            ))}
            <span className="text-xs cd-text-faint">다른 업체로 옮긴 사람이면 그대로 새로 등록하세요.</span>
          </div>
        )}

        {!internal && (
          <>
            {/* 1. 업체 */}
            <section className="flex flex-col gap-2" aria-label="업체">
              <h3 className="text-[13px] font-semibold cd-text">1. 업체</h3>
              {facility ? (
                <div className="flex items-center gap-2 text-[13px]">
                  <Building2 className="w-4 h-4 cd-text-faint" aria-hidden />
                  <span className="cd-text font-semibold">{facility.name}</span>
                  <button type="button" className="cd-action text-[12px] cd-text-primary" onClick={() => setFacility(null)}>
                    다시 고르기
                  </button>
                </div>
              ) : mode === "pick" ? (
                <>
                  {suggestions.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs cd-text-faint">메일 도메인으로 찾은 업체</span>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.map((s) => (
                          <button
                            key={s.facilityId}
                            type="button"
                            className="cd-btn cd-btn-soft cd-btn-sm"
                            title={s.reason}
                            onClick={() => choose(s)}
                          >
                            {s.companyName}
                            {regionOf(s) ? <span className="cd-text-faint font-normal">· {regionOf(s)}</span> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={boxRef} className="relative">
                    <CdInput
                      label="업체 검색"
                      value={fq}
                      placeholder="업체명 검색(2자 이상)"
                      onFocus={() => setOpen(true)}
                      onChange={(e) => {
                        setFq(e.target.value);
                        setOpen(true);
                      }}
                    />
                    {open && hits.length > 0 && (
                      <div className="absolute z-20 top-full mt-1 left-0 right-0 rounded-lg border cd-border-c cd-card-bg shadow-[var(--cd-shadow-popover)] max-h-52 overflow-y-auto">
                        {hits.map((h) => (
                          <button
                            key={h.facilityId}
                            type="button"
                            className="w-full px-3 py-2 text-left text-[13px] hover:bg-[color:var(--cd-surface)]"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => choose(h)}
                          >
                            <span className="cd-text">{h.companyName}</span>
                            <span className="ml-2 text-[11px] cd-text-faint">{regionOf(h) ?? ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs cd-text-faint">찾는 업체가 없으면</span>
                    <CdButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={startNew}>
                      새 업체로 간이 등록
                    </CdButton>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CdInput
                      label="업체명"
                      required
                      value={newCo.companyName}
                      onChange={(e) => {
                        setNewCo({ ...newCo, companyName: e.target.value });
                        setConflict(null);
                      }}
                      placeholder="예: ㈜한국환경"
                    />
                    <CdInput label="대표 전화" value={newCo.phone} onChange={(e) => setNewCo({ ...newCo, phone: e.target.value })} />
                    <CdInput label="주소" value={newCo.address} onChange={(e) => setNewCo({ ...newCo, address: e.target.value })} />
                    <CdInput label="홈페이지" value={newCo.homepage} onChange={(e) => setNewCo({ ...newCo, homepage: e.target.value })} />
                  </div>
                  <p className="text-xs cd-text-faint">업체명만 있어도 됩니다. 사업자번호 등 상세 정보는 관리자가 확정할 때 넣습니다.</p>
                  <button type="button" className="cd-action self-start text-[12px] cd-text-primary" onClick={() => setMode("pick")}>
                    기존 업체에서 고르기
                  </button>
                </>
              )}
              {conflict && (
                <div className="cd-card p-3 flex flex-col gap-2 text-[13px] cd-text" role="alert">
                  <span className="font-semibold">같은 이름의 업체가 이미 있습니다. 같은 곳이면 고르세요.</span>
                  <div className="flex flex-wrap gap-1.5">
                    {conflict.map((c) => (
                      <button key={c.facilityId} type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => choose(c)}>
                        {c.companyName}
                        {regionOf(c) ? <span className="cd-text-faint font-normal">· {regionOf(c)}</span> : null}
                      </button>
                    ))}
                  </div>
                  <CdButton size="sm" className="self-start" loading={saving} onClick={() => void save(true)}>
                    다른 곳이므로 새로 만들기
                  </CdButton>
                </div>
              )}
            </section>

            {/* 2. 담당자 */}
            <section className="flex flex-col gap-2 border-t cd-hairline-c pt-4" aria-label="담당자">
              <h3 className="text-[13px] font-semibold cd-text">2. 담당자</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CdInput label="이름" required value={person.personName} onChange={(e) => setPerson({ ...person, personName: e.target.value })} />
                <CdInput label="직함" value={person.title} onChange={(e) => setPerson({ ...person, title: e.target.value })} placeholder="예: 부장" />
                <CdInput label="휴대폰" value={person.mobilePhone} onChange={(e) => setPerson({ ...person, mobilePhone: e.target.value })} />
                <CdInput label="사무실 전화" value={person.officePhone} onChange={(e) => setPerson({ ...person, officePhone: e.target.value })} />
                <CdInput
                  label="이메일"
                  className="sm:col-span-2"
                  value={person.email}
                  onChange={(e) => setPerson({ ...person, email: e.target.value })}
                  placeholder="name@example.com"
                />
              </div>
            </section>
          </>
        )}
      </div>
    </CdModal>
  );
}
