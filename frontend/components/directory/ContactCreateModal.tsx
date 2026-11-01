"use client";

// 외부 담당자 등록 — 출장·영업에서 만난 사람을 직원이 직접 등록한다(2026-10-30 사용자 결정, contact.edit).
// 주소록(외부 연락처)과 결재 양식의 접견인 칸에서 같이 쓴다. 기관·업체는 이미 등록된 사업장에서 고른다
// (사업장 신규 등록은 사업장 수정 권한이 필요하다). 저장은 POST /api/directory/contacts.

import { useEffect, useRef, useState } from "react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { CdModal } from "@/components/cdash/CdModal";
import { useCdToast } from "@/components/cdash/CdToast";
import { useOutsideDismiss } from "@/components/ui/useOutsideDismiss";

export interface CreatedContact {
  id: number;
  facilityId: string;
  facilityName: string;
  personName: string;
  title: string | null;
  departmentName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  email: string | null;
}

interface FacilityHit {
  facilityId: string;
  companyName: string;
  businessRegistrationNo?: string | null;
  regionSido?: string | null;
  regionSigungu?: string | null;
}

export function ContactCreateModal({
  initialName,
  onClose,
  onCreated,
}: {
  /** 검색하던 이름을 이름 칸에 미리 채운다(접견인 칸에서 열 때). */
  initialName?: string;
  onClose: () => void;
  onCreated: (c: CreatedContact) => void;
}) {
  const { toast } = useCdToast();
  const [facility, setFacility] = useState<{ facilityId: string; name: string } | null>(null);
  const [fq, setFq] = useState("");
  const [hits, setHits] = useState<FacilityHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(boxRef, open, () => setOpen(false));
  const [personName, setPersonName] = useState(initialName ?? "");
  const [title, setTitle] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [officePhone, setOfficePhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = fq.trim();
    if (facility || q.length < 2) {
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
  }, [fq, facility]);

  const save = async () => {
    if (!facility) {
      toast("기관·업체를 검색해 선택하세요.", "warn");
      return;
    }
    if (!personName.trim()) {
      toast("이름을 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const body = {
        facilityId: facility.facilityId,
        personName: personName.trim(),
        title: title.trim() || null,
        departmentName: departmentName.trim() || null,
        mobilePhone: mobilePhone.trim() || null,
        officePhone: officePhone.trim() || null,
        email: email.trim() || null,
      };
      const r = await fetch("/api/directory/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(String(d.error ?? "등록에 실패했습니다."), "error");
        return;
      }
      toast("담당자를 등록했습니다.", "success");
      onCreated({ id: Number(d.id), facilityName: facility.name, ...body });
    } finally {
      setSaving(false);
    }
  };

  return (
    <CdModal
      open
      onClose={onClose}
      title="외부 담당자 등록"
      size="md"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={save}>
            등록
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div ref={boxRef} className="relative">
          {facility ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="cd-label m-0">기관·업체</span>
              <span className="cd-text font-semibold">{facility.name}</span>
              <button type="button" className="text-[12px] cd-text-primary" onClick={() => setFacility(null)}>
                다시 고르기
              </button>
            </div>
          ) : (
            <CdInput
              label="기관·업체"
              required
              value={fq}
              placeholder="업체명 검색(2자 이상)"
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setFq(e.target.value);
                setOpen(true);
              }}
            />
          )}
          {open && !facility && hits.length > 0 && (
            <div className="absolute z-20 top-full mt-1 left-0 right-0 rounded-lg border cd-border-c cd-card-bg shadow-[var(--cd-shadow-popover)] max-h-52 overflow-y-auto">
              {hits.map((h) => (
                <button
                  key={h.facilityId}
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] hover:bg-[color:var(--cd-surface)]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setFacility({ facilityId: h.facilityId, name: h.companyName });
                    setOpen(false);
                  }}
                >
                  <span className="cd-text">{h.companyName}</span>
                  <span className="ml-2 text-[11px] cd-text-faint">
                    {[h.regionSido, h.regionSigungu].filter(Boolean).join(" ") || h.businessRegistrationNo || ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!facility && (
          <p className="-mt-2 text-xs cd-text-faint">등록된 사업장에서 고릅니다. 목록에 없으면 사업장 관리 담당자에게 등록을 요청하세요.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CdInput label="이름" required value={personName} onChange={(e) => setPersonName(e.target.value)} />
          <CdInput label="직급" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 부장" />
          <CdInput label="부서" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} placeholder="예: 환경안전팀" />
          <CdInput label="휴대폰" value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
          <CdInput label="사무실" value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} />
          <CdInput label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
      </div>
    </CdModal>
  );
}
