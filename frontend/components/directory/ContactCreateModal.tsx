"use client";

// 외부 담당자 등록 — 출장·영업에서 만난 사람을 직원이 직접 등록한다(2026-10-30 사용자 결정, contact.edit).
// 주소록(외부 연락처)과 결재 양식의 접견인 칸에서 같이 쓴다. 기관·업체는 이미 등록된 사업장에서 고른다
// — 저장은 POST /api/directory/contacts.
// 목록에 없는 업체(2026-11-20, 직원 요청 30)는 [새 업체로 등록]으로 업체명만 넣어 함께 등록한다 — 메일의 주소록 간이
// 등록(357)과 같은 경로(POST /api/directory/quick)라 '기타 업체·기관'에 간이 업체로 들어가고 관리자가 나중에 보완·확정한다.

import { useEffect, useRef, useState } from "react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { CdModal } from "@/components/cdash/CdModal";
import { useCdToast } from "@/components/cdash/CdToast";
import { useOutsideDismiss } from "@/components/ui/useOutsideDismiss";
import { DepartmentField } from "@/components/directory/DepartmentField";
import { ExtraEmailsField } from "@/components/directory/ExtraEmailsField";
import { normalizeExtraEmails } from "@/lib/directory-emails";

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
  extraEmails?: string[];
  /** 새 업체와 함께 간이 등록한 담당자(관리자 보완·확정 전). */
  quick?: boolean;
}

/** 같은 이름의 업체가 이미 있을 때 서버가 돌려주는 후보. */
interface SameNameHit {
  facilityId: string;
  companyName: string;
  region: string | null;
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
  initialTitle,
  initialFacility,
  onClose,
  onCreated,
}: {
  /** 검색하던 이름을 이름 칸에 미리 채운다(접견인 칸에서 열 때). */
  initialName?: string;
  /** 검색란에 `성명 직함`으로 적었을 때의 직함. */
  initialTitle?: string;
  /** 양식에서 이미 고른 업체 — 기관·업체를 미리 채운다([다시 고르기]로 바꿀 수 있다). */
  initialFacility?: { facilityId: string; name: string } | null;
  onClose: () => void;
  onCreated: (c: CreatedContact) => void;
}) {
  const { toast } = useCdToast();
  const [facility, setFacility] = useState<{ facilityId: string; name: string } | null>(initialFacility ?? null);
  const [fq, setFq] = useState("");
  const [hits, setHits] = useState<FacilityHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(boxRef, open, () => setOpen(false));
  const [personName, setPersonName] = useState(initialName ?? "");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [departmentName, setDepartmentName] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [officePhone, setOfficePhone] = useState("");
  const [email, setEmail] = useState("");
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** 추가 이메일 정리 — 형식이 틀리면 알리고 null. */
  const cleanExtra = (): string[] | null => {
    const { emails, invalid } = normalizeExtraEmails(extraEmails, email);
    if (invalid) {
      toast(`이메일 형식이 올바르지 않습니다: ${invalid}`, "warn");
      return null;
    }
    return emails;
  };
  // 목록에 없는 업체 — 검색어를 업체명으로 삼아 간이 업체를 함께 만든다.
  const [newCompany, setNewCompany] = useState(false);
  const [sameName, setSameName] = useState<SameNameHit[]>([]);

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

  /** 새 업체와 담당자를 함께 등록 — force 는 같은 이름의 업체가 있어도 새로 만들 때. */
  const saveWithNewCompany = async (force: boolean) => {
    const companyName = fq.trim();
    if (!companyName) {
      toast("새 업체명을 입력하세요.", "warn");
      return;
    }
    if (!personName.trim()) {
      toast("이름을 입력하세요.", "warn");
      return;
    }
    const extra = cleanExtra();
    if (!extra) return;
    setSaving(true);
    try {
      const person = {
        personName: personName.trim(),
        title: title.trim() || null,
        departmentName: departmentName.trim() || null,
        mobilePhone: mobilePhone.trim() || null,
        officePhone: officePhone.trim() || null,
        email: email.trim() || null,
      };
      const r = await fetch("/api/directory/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId: null, newFacility: { companyName }, forceNewFacility: force, person, source: "directory" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(d.candidates)) {
        setSameName(d.candidates as SameNameHit[]);
        return;
      }
      if (!r.ok) {
        toast(String(d.error ?? "등록에 실패했습니다."), "error");
        return;
      }
      // 간이 등록 경로는 추가 이메일을 받지 않는다 — 만든 담당자에 이어서 넣는다.
      let savedExtra: string[] = [];
      if (extra.length) {
        const er = await fetch("/api/directory/contacts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: Number(d.personId), extraEmails: extra }),
        });
        if (er.ok) savedExtra = extra;
        else toast("담당자는 등록했지만 추가 이메일은 저장하지 못했습니다. 수정에서 다시 넣어 주세요.", "warn");
      }
      toast("새 업체와 담당자를 등록했습니다.", "success");
      onCreated({
        id: Number(d.personId), facilityId: String(d.facilityId), facilityName: String(d.facilityName ?? companyName),
        quick: true, ...person, extraEmails: savedExtra,
      });
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (newCompany && !facility) return saveWithNewCompany(false);
    if (!facility) {
      toast("기관·업체를 검색해 선택하세요. 목록에 없으면 [새 업체로 등록]을 누르세요.", "warn");
      return;
    }
    if (!personName.trim()) {
      toast("이름을 입력하세요.", "warn");
      return;
    }
    const extra = cleanExtra();
    if (!extra) return;
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
        extraEmails: extra,
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
              <button
                type="button"
                className="text-[12px] cd-text-primary"
                onClick={() => {
                  setFacility(null);
                  setNewCompany(false);
                  setSameName([]);
                }}
              >
                다시 고르기
              </button>
            </div>
          ) : (
            <CdInput
              label={newCompany ? "새 업체명" : "기관·업체"}
              required
              value={fq}
              placeholder={newCompany ? "예: ○○환경(주)" : "업체명 검색(2자 이상)"}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setFq(e.target.value);
                setOpen(true);
                setSameName([]);
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
        {!facility && !newCompany && (
          <p className="-mt-2 cd-hint">
            등록된 사업장에서 고릅니다. 목록에 없으면{" "}
            <button type="button" className="cd-text-primary font-semibold" onClick={() => setNewCompany(true)}>
              새 업체로 등록
            </button>
            을 누르세요.
          </p>
        )}
        {!facility && newCompany && (
          <p className="-mt-2 cd-hint">
            적은 이름으로 새 업체를 만들어 함께 등록합니다. 위 검색 결과에 같은 곳이 보이면 그것을 고르세요.{" "}
            <button
              type="button"
              className="cd-text-primary font-semibold"
              onClick={() => {
                setNewCompany(false);
                setSameName([]);
              }}
            >
              검색으로 돌아가기
            </button>
          </p>
        )}
        {!facility && sameName.length > 0 && (
          <div className="rounded-lg border cd-border-c p-2.5 flex flex-col gap-1.5">
            <p className="text-[12px] cd-warn-text">같은 이름의 업체가 이미 있습니다. 같은 곳이면 고르고, 다른 곳이면 새로 만드세요.</p>
            {sameName.map((h) => (
              <button
                key={h.facilityId}
                type="button"
                className="text-left text-[13px] px-2 py-1.5 rounded-lg hover:bg-[color:var(--cd-surface)]"
                onClick={() => {
                  setFacility({ facilityId: h.facilityId, name: h.companyName });
                  setSameName([]);
                }}
              >
                <span className="cd-text">{h.companyName}</span>
                {h.region && <span className="ml-2 text-[11px] cd-text-faint">{h.region}</span>}
              </button>
            ))}
            <div>
              <CdButton size="sm" loading={saving} onClick={() => saveWithNewCompany(true)}>
                그래도 새로 만들기
              </CdButton>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CdInput label="이름" required value={personName} onChange={(e) => setPersonName(e.target.value)} />
          <CdInput label="직급" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 부장" />
          <DepartmentField facilityId={facility?.facilityId ?? null} value={departmentName} onChange={setDepartmentName} />
          <CdInput label="휴대폰" value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
          <CdInput label="사무실" value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} />
          <CdInput label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <ExtraEmailsField value={extraEmails} onChange={setExtraEmails} />
      </div>
    </CdModal>
  );
}
