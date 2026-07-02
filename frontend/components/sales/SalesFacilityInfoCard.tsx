"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Download, Plus, Upload, X } from "lucide-react";
import type { FacilityDetail } from "@/lib/ieps/types-facility";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";
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
              <InfoRow label="사업장명" value={detail.companyName} />
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
      ) : tab === "facility" ? (
        <FacilitySpecTab facilityId={facilityId} canEdit={canEdit} />
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
            <label className="cd-label">업종(통합허가 대상)</label>
            <select className="cd-select mb-4" value={industryName} onChange={(e) => setIndustryName(e.target.value)}>
              <option value="">업종 선택</option>
              {INTEGRATED_PERMIT_INDUSTRIES.map((i) => <option key={i.id} value={i.label}>{i.label}</option>)}
            </select>
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

const SPEC_FIELDS = [
  { k: "dischargeFacility", l: "배출시설" }, { k: "generalStack", l: "일반굴뚝" }, { k: "cleansys", l: "CleanSYS" },
  { k: "flareStack", l: "플레어스택" }, { k: "outlet", l: "방류구" }, { k: "nonDischargeFacility", l: "비배출시설" },
];
const AREA_FIELDS = [
  { k: "factoryArea", l: "공장부지" }, { k: "manufacturingArea", l: "제조시설" }, { k: "auxiliaryArea", l: "부대시설" },
];
const SPEC_DOCS = [
  { k: "integrated_plan", l: "통합 계획서" }, { k: "media_permit", l: "매체별 인허가" }, { k: "factory_reg", l: "공장 등록증" },
];

function FacilitySpecTab({ facilityId, canEdit }: { facilityId: string; canEdit: boolean }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [hasDoc, setHasDoc] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const reload = useCallback(() => {
    fetch(`/api/facilities/${facilityId}/facility-info`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { info: null, docs: [] }))
      .then((d) => {
        const info = d.info ?? {};
        const f: Record<string, string> = {};
        [...SPEC_FIELDS, ...AREA_FIELDS].forEach((x) => { f[x.k] = info[x.k] != null ? String(info[x.k]) : ""; });
        setForm(f);
        const has: Record<string, boolean> = {};
        (d.docs ?? []).forEach((x: { docType: string }) => { has[x.docType] = true; });
        setHasDoc(has);
      })
      .catch(() => {});
  }, [facilityId]);
  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/facilities/${facilityId}/facility-info`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    }).catch(() => {});
    setSaving(false);
  };
  const upload = async (docType: string, file: File) => {
    setUploading(docType);
    const fd = new FormData(); fd.set("file", file); fd.set("docType", docType);
    await fetch(`/api/facilities/${facilityId}/facility-docs`, { method: "POST", body: fd }).catch(() => {});
    setUploading(null);
    reload();
  };

  return (
    <div className="pt-4 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5 mb-2"><span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-success)" }} /><h3 className="cd-text text-sm">시설정보</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {SPEC_FIELDS.map((f) => (
            <div key={f.k}>
              <label className="cd-label">{f.l}</label>
              <input className="cd-input" disabled={!canEdit} value={form[f.k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 mb-2"><span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-primary)" }} /><h3 className="cd-text text-sm">부지면적</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {AREA_FIELDS.map((f) => (
            <div key={f.k}>
              <label className="cd-label">{f.l} (m²)</label>
              <input className="cd-input" inputMode="numeric" disabled={!canEdit} value={form[f.k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 mb-2"><span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-warning)" }} /><h3 className="cd-text text-sm">시설 현황 자료</h3></div>
        <div className="flex flex-col gap-2">
          {SPEC_DOCS.map((d) => {
            const on = hasDoc[d.k];
            return (
              <div key={d.k} className="flex items-center gap-2">
                <span className="rounded-full px-3 py-1 text-xs shrink-0" style={{ minWidth: 100, textAlign: "center", background: on ? "#EAF7E1" : "var(--cd-surface)", border: on ? "1.5px solid #7EBA56" : "1px solid var(--cd-border)", color: on ? "#4A7A2E" : "var(--cd-muted)" }}>{d.l}</span>
                {canEdit && (
                  <>
                    <input ref={(el) => { fileRefs.current[d.k] = el; }} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(d.k, f); }} />
                    <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => fileRefs.current[d.k]?.click()} disabled={uploading === d.k}>
                      <Upload className="w-3 h-3" /> {uploading === d.k ? "…" : "Up"}
                    </button>
                  </>
                )}
                <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={!on} onClick={() => window.open(`/api/facilities/${facilityId}/facility-docs?docType=${d.k}`)}>
                  <Download className="w-3 h-3" /> Down
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      )}
    </div>
  );
}
