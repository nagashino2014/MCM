"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, X } from "lucide-react";
import type { FacilityDetail } from "@/lib/ieps/types-facility";
import "@/app/(app)/contracts/billing/billing.css";

const TABS = [
  { k: "general", l: "일반현황" },
  { k: "facility", l: "시설현황" },
  { k: "order", l: "발주정보" },
  { k: "history", l: "과거이력" },
];

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px] py-2 border-b cd-border-c last:border-0">
      <span className="cd-text-faint w-20 shrink-0">{label}</span>
      <span className="cd-text min-w-0 flex-1">{value ?? "—"}</span>
    </div>
  );
}

export function SalesFacilityInfoCard({ facilityId, theme, canEdit }: { facilityId: string; theme: string; canEdit: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState("general");
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const reload = useCallback(() => {
    fetch(`/api/facilities/${facilityId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetail(d))
      .catch(() => {});
  }, [facilityId]);
  useEffect(() => { reload(); }, [reload]);

  const air = detail?.annualReport?.airClass ?? detail?.permits?.find((p) => p.airClass != null)?.airClass ?? null;
  const water = detail?.annualReport?.waterClass ?? detail?.permits?.find((p) => p.waterClass != null)?.waterClass ?? null;
  const groupName = detail?.groupInfo?.group.groupName ?? null;

  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c p-4 w-full flex flex-col">
      <h2 className="cd-text font-extrabold text-sm flex items-center gap-1 mb-3"><Building2 className="w-4 h-4" /> 사업장 정보</h2>

      {/* 탭 — billing 파일탭 형태 */}
      <div className="cdb-tabs">
        {TABS.map((t) => (
          <button key={t.k} type="button" className="cdb-tab" data-active={tab === t.k} onClick={() => setTab(t.k)}>{t.l}</button>
        ))}
      </div>

      {tab === "general" ? (
        !detail ? (
          <div className="cd-text-faint text-sm py-4">불러오는 중…</div>
        ) : (
          <div className="flex flex-col pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <InfoRow label="사업장명" value={<span className="font-bold">{detail.companyName}</span>} />
              <InfoRow label="대표자명" value={detail.representativeName} />
              <InfoRow label="소재지" value={detail.siteAddress} />
              <InfoRow label="사업자번호" value={detail.businessRegistrationNo} />
              <InfoRow label="대표번호" value={detail.phoneNumber} />
              <InfoRow label="업종" value={detail.industryName ?? detail.industryCode} />
              <InfoRow label="대기 종규모" value={air != null ? `${air}종` : "—"} />
              <InfoRow label="수질 종규모" value={water != null ? `${water}종` : "—"} />
              <InfoRow
                label="계열관계"
                value={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{groupName ?? "—"}</span>
                    {canEdit && (
                      <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={() => router.push(`/facilities?focus=${facilityId}`)}>그룹 관리</button>
                    )}
                  </span>
                }
              />
            </div>
            {canEdit && (
              <button className="cd-btn cd-btn-soft cd-btn-sm mt-4 self-start" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> 신규 등록</button>
            )}
          </div>
        )
      ) : (
        <div className="cd-text-faint text-sm py-6 text-center">다음 단계에서 구현 예정입니다.</div>
      )}

      {newOpen && (
        <NewFacilityModal theme={theme} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); }} />
      )}
    </div>
  );
}

function NewFacilityModal({ theme, onClose, onCreated }: { theme: string; onClose: () => void; onCreated: (facilityId: string) => void }) {
  const [companyName, setCompanyName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [brn, setBrn] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [industryName, setIndustryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!companyName.trim() || !siteAddress.trim() || !brn.trim()) {
      setErr("사업장명 · 소재지 · 사업자번호는 필수입니다.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/facilities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          siteAddress: siteAddress.trim(),
          businessRegistrationNo: brn.trim(),
          representativeName: representativeName.trim() || null,
          phoneNumber: phoneNumber.trim() || null,
          industryName: industryName.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDone(true);
      onCreated(String(data.facilityId));
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 460, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">사업장 신규 등록</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="cd-success-text font-bold">사업장이 등록되었습니다.</p>
            <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={onClose}>닫기</button>
          </div>
        ) : (
          <>
            {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}
            <p className="cd-text-faint text-[11px] mb-3">최소 필수: 사업장명 · 소재지 · 사업자번호. 나머지 상세는 사업장 메뉴에서 보강할 수 있습니다.</p>
            <label className="cd-label">사업장명 *</label>
            <input className="cd-input mb-3" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <label className="cd-label">소재지 *</label>
            <input className="cd-input mb-3" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
            <label className="cd-label">사업자번호 *</label>
            <input className="cd-input mb-3" value={brn} onChange={(e) => setBrn(e.target.value)} placeholder="000-00-00000" />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="cd-label">대표자명</label>
                <input className="cd-input" value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} />
              </div>
              <div>
                <label className="cd-label">대표번호</label>
                <input className="cd-input" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
              </div>
            </div>
            <label className="cd-label">업종</label>
            <input className="cd-input mb-4" value={industryName} onChange={(e) => setIndustryName(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
              <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={submit} disabled={saving}>{saving ? "저장 중…" : "등록"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
