"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Download, Minus, Plus, Upload, User, X } from "lucide-react";
import type { FacilityDetail } from "@/lib/ieps/types-facility";
import { GroupManagementModal } from "@/components/facilities/FacilityDetailPanel";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AutoTimeInput } from "@/components/ui/AutoTimeInput";
import {
  SALES_OUTCOME_LABELS,
  SALES_SERVICE_CATEGORIES,
  SALES_SUBCATEGORIES_BY_CATEGORY,
  SALES_STAGE_LABELS,
  type SalesBidResult,
  type SalesServiceCategory,
  type SalesStage,
} from "@/lib/sales/types";
import "@/app/(app)/contracts/billing/billing.css";

interface HistoryItem {
  projectId: string;
  title: string;
  stage: SalesStage;
  serviceCategory: string | null;
  serviceSubcategory: string | null;
  startDate: string | null;
  endDate: string | null;
  members: { employeeName: string | null; positionName: string | null; photoPath: string | null }[];
  summary: string | null;
  bidAmount: number | null;
  outcome: SalesBidResult | null;
}

function HistAvatar({ src }: { src: string | null }) {
  if (src) return <img src={src} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />;
  return <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center" style={{ background: "var(--cd-surface)" }}><User className="w-3.5 h-3.5 cd-text-faint" /></span>;
}

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
  const [tab, setTab] = useState("general");
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

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
    <div className="cd-card-bg rounded-2xl border cd-border-c p-4 w-full flex flex-col h-full min-h-0">
      <h2 className="cd-text font-extrabold text-sm mb-3 shrink-0">사업장 정보</h2>

      {/* 탭 — billing 파일탭 형태 */}
      <div className="cdb-tabs shrink-0">
        {TABS.map((t) => (
          <button key={t.k} type="button" className="cdb-tab" data-active={tab === t.k} onClick={() => setTab(t.k)}>{t.l}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3">
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
                      <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={() => setGroupOpen(true)}>그룹 관리</button>
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
      ) : tab === "order" ? (
        <OrderInfoTab facilityId={facilityId} canEdit={canEdit} />
      ) : (
        <HistoryTab facilityId={facilityId} />
      )}
      </div>

      {newOpen && (
        <NewFacilityModal theme={theme} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); }} />
      )}
      {groupOpen && detail && (
        <GroupManagementModal facility={detail} onClose={() => setGroupOpen(false)} onChanged={() => { setGroupOpen(false); reload(); }} />
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
  { k: "etc", l: "기타 설비 자료" },
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
    <div className="pt-4">
      <div className="flex flex-col lg:flex-row gap-5">
        {/* 좌측: 시설정보 + 부지면적 (레이블 좌측 인라인, 입력 70px) */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2"><span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-success)" }} /><h3 className="cd-text text-sm">시설정보 (EA)</h3></div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              {SPEC_FIELDS.map((f) => (
                <div key={f.k} className="flex items-center gap-2">
                  <label className="cd-label font-normal shrink-0 mb-0" style={{ width: 64 }}>{f.l}</label>
                  <input className="cd-input" style={{ width: 80 }} inputMode="numeric" disabled={!canEdit} value={form[f.k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-2"><span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-primary)" }} /><h3 className="cd-text text-sm">부지면적 (m²)</h3></div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              {AREA_FIELDS.map((f) => (
                <div key={f.k} className="flex items-center gap-2">
                  <label className="cd-label font-normal shrink-0 mb-0" style={{ width: 64 }}>{f.l}</label>
                  <input className="cd-input" style={{ width: 80 }} inputMode="numeric" disabled={!canEdit} value={form[f.k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* 우측: 시설 현황 자료 */}
        <div className="lg:w-64 shrink-0">
          <div className="flex items-center gap-1.5 mb-2"><span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-warning)" }} /><h3 className="cd-text text-sm">시설 현황 자료</h3></div>
          <div className="flex flex-col gap-2">
            {SPEC_DOCS.map((d) => {
              const on = hasDoc[d.k];
              return (
                <div key={d.k} className="flex items-center gap-2">
                  <span className="rounded-full px-3 py-1 text-xs shrink-0" style={{ minWidth: 96, textAlign: "center", background: on ? "#EAF7E1" : "var(--cd-surface)", border: on ? "1.5px solid #7EBA56" : "1px solid var(--cd-border)", color: on ? "#4A7A2E" : "var(--cd-muted)" }}>{d.l}</span>
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
      </div>
      {canEdit && (
        <div className="flex justify-end mt-4">
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      )}
    </div>
  );
}

const ORDER_TYPE_OPTS = [
  { k: "negotiated", l: "수의계약" },
  { k: "limited", l: "제한경쟁" },
  { k: "qualification", l: "적격심사" },
];
const FIELD_W = 142; // 발주구분·예정가격·낙찰하한율 공통 너비

const splitIso = (iso: string | null): { date: string; time: string } =>
  iso ? { date: iso.slice(0, 10), time: iso.slice(11, 16) } : { date: "", time: "" };
const joinIso = (date: string, time: string): string | null =>
  date ? `${date}T${time || "00:00"}:00` : null;

function OrderInfoTab({ facilityId, canEdit }: { facilityId: string; canEdit: boolean }) {
  const [orderType, setOrderType] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [orderTime, setOrderTime] = useState("");
  const [bidStartDate, setBidStartDate] = useState("");
  const [bidStartTime, setBidStartTime] = useState("");
  const [bidEndDate, setBidEndDate] = useState("");
  const [bidEndTime, setBidEndTime] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [minBidRate, setMinBidRate] = useState("");
  const [participants, setParticipants] = useState<string[]>(["", "", ""]);
  const [saving, setSaving] = useState(false);
  const negotiated = orderType === "negotiated";

  const reload = useCallback(() => {
    fetch(`/api/facilities/${facilityId}/order-info`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { info: null }))
      .then((d) => {
        const i = d.info;
        if (!i) return;
        setOrderType(i.orderType ?? "");
        const o = splitIso(i.orderAt); setOrderDate(o.date); setOrderTime(o.time);
        const s = splitIso(i.bidStart); setBidStartDate(s.date); setBidStartTime(s.time);
        const e = splitIso(i.bidEnd); setBidEndDate(e.date); setBidEndTime(e.time);
        setEstimatedPrice(i.estimatedPrice != null ? String(i.estimatedPrice) : "");
        setMinBidRate(i.minBidRate != null ? String(i.minBidRate) : "");
        const parts: string[] = Array.isArray(i.participants) ? [...i.participants] : [];
        while (parts.length < 3 || parts.length % 3 !== 0) parts.push("");
        setParticipants(parts);
      })
      .catch(() => {});
  }, [facilityId]);
  useEffect(() => { reload(); }, [reload]);

  const setPart = (idx: number, v: string) => setParticipants((p) => p.map((x, i) => (i === idx ? v : x)));
  const addRow = () => setParticipants((p) => [...p, "", "", ""]);
  const removeRow = () => setParticipants((p) => (p.length > 3 ? p.slice(0, -3) : p));

  const save = async () => {
    setSaving(true);
    await fetch(`/api/facilities/${facilityId}/order-info`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderType: orderType || null,
        orderAt: joinIso(orderDate, orderTime),
        bidStart: negotiated ? null : joinIso(bidStartDate, bidStartTime),
        bidEnd: negotiated ? null : joinIso(bidEndDate, bidEndTime),
        estimatedPrice: estimatedPrice || null,
        minBidRate: minBidRate || null,
        participants: participants.map((x) => x.trim()).filter(Boolean),
      }),
    }).catch(() => {});
    setSaving(false);
  };

  const rows: number[][] = [];
  for (let i = 0; i < participants.length; i += 3) rows.push([i, i + 1, i + 2]);

  return (
    <div className="pt-4 flex flex-col gap-4">
      {/* 발주구분 · 발주일시 · 투찰기간 — 한 행 */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <label className="cd-label font-normal">발주구분</label>
          <select className="cd-select" style={{ width: FIELD_W }} disabled={!canEdit} value={orderType} onChange={(e) => setOrderType(e.target.value)}>
            <option value="">선택</option>
            {ORDER_TYPE_OPTS.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label font-normal">발주일시</label>
          <div className="flex gap-2">
            <AutoDateInput className="cd-input tabular-nums" style={{ width: 111 }} disabled={!canEdit} value={orderDate} onChange={setOrderDate} />
            <AutoTimeInput className="cd-input tabular-nums" style={{ width: 75 }} disabled={!canEdit} value={orderTime} onChange={setOrderTime} />
          </div>
        </div>
        <div>
          <label className="cd-label font-normal">투찰기간{negotiated && <span className="cd-text-faint text-[11px] ml-1">(수의계약 — 해당 없음)</span>}</label>
          <div className="flex items-center gap-2">
            <AutoDateInput className="cd-input tabular-nums" style={{ width: 111 }} disabled={!canEdit || negotiated} value={bidStartDate} onChange={setBidStartDate} />
            <AutoTimeInput className="cd-input tabular-nums" style={{ width: 75 }} disabled={!canEdit || negotiated} value={bidStartTime} onChange={setBidStartTime} />
            <span className="cd-text-faint shrink-0">~</span>
            <AutoDateInput className="cd-input tabular-nums" style={{ width: 111 }} disabled={!canEdit || negotiated} value={bidEndDate} onChange={setBidEndDate} />
            <AutoTimeInput className="cd-input tabular-nums" style={{ width: 75 }} disabled={!canEdit || negotiated} value={bidEndTime} onChange={setBidEndTime} />
          </div>
        </div>
      </div>

      {/* 예정가격·낙찰하한율 · 참여업체 */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="shrink-0 flex flex-col gap-3" style={{ width: FIELD_W }}>
          <div>
            <label className="cd-label font-normal">예정가격 (원)</label>
            <input className="cd-input tabular-nums" inputMode="numeric" disabled={!canEdit} value={estimatedPrice ? Number(estimatedPrice).toLocaleString() : ""} onChange={(e) => setEstimatedPrice(e.target.value.replace(/[^\d]/g, ""))} placeholder="사업장 제시 시" />
          </div>
          <div>
            <label className="cd-label font-normal">낙찰하한율 (%)</label>
            <input className="cd-input" inputMode="decimal" disabled={!canEdit} value={minBidRate} onChange={(e) => setMinBidRate(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <label className="cd-label font-normal">참여업체</label>
          <div className="flex flex-col gap-2">
            {rows.map((row, ri) => {
              const isLast = ri === rows.length - 1;
              return (
                <div key={ri} className="flex items-center gap-2">
                  {row.map((idx) => (
                    <input key={idx} className="cd-input flex-1 min-w-0" disabled={!canEdit} value={participants[idx] ?? ""} onChange={(e) => setPart(idx, e.target.value)} />
                  ))}
                  {canEdit && isLast ? (
                    <div className="flex gap-1 shrink-0">
                      {rows.length > 1 && (
                        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={removeRow} title="마지막 줄 삭제"><Minus className="w-4 h-4" /></button>
                      )}
                      <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={addRow} title="줄 추가"><Plus className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <span className="shrink-0" style={{ width: rows.length > 1 ? 66 : 32 }} />
                  )}
                </div>
              );
            })}
          </div>
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

const fmtHistDate = (iso: string | null) => (iso ? iso.slice(0, 10).replace(/-/g, ".") + "." : "");

function OutcomePill({ stage, outcome }: { stage: SalesStage; outcome: SalesBidResult | null }) {
  // 결과 태그: 수주(녹) / 탈락·거절·중단(회) / 진행중(중립)
  let label: string;
  let tone: "won" | "lost" | "open";
  if (stage === "won") { label = "수주"; tone = "won"; }
  else if (stage === "lost") { label = outcome && outcome !== "won_bid" ? (outcome === "lost_bid" ? "탈락" : SALES_OUTCOME_LABELS[outcome] ?? "종결") : "탈락"; tone = "lost"; }
  else { label = SALES_STAGE_LABELS[stage]; tone = "open"; }
  const style =
    tone === "won" ? { background: "#EAF7E1", border: "1.5px solid #7EBA56", color: "#4A7A2E" }
    : tone === "lost" ? { background: "var(--cd-surface)", border: "1px solid var(--cd-border)", color: "var(--cd-muted)" }
    : { background: "var(--cd-primary-soft)", border: "1px solid var(--cd-primary)", color: "var(--cd-primary)" };
  return <span className="rounded-full px-3 py-1 text-xs font-bold shrink-0" style={style}>{label}</span>;
}

function HistoryTab({ facilityId }: { facilityId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>("all");
  const [sub, setSub] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/facilities/${facilityId}/sales-history`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [facilityId]);

  const filtered = items.filter(
    (it) => (cat === "all" || it.serviceCategory === cat) && (sub === "all" || it.serviceSubcategory === sub)
  );

  const catTabs = [{ code: "all", label: "전체" }, ...SALES_SERVICE_CATEGORIES];
  // 세분류 탭: 선택된 용역별에 종속(전체 용역이면 세분류 '전체'만).
  const subTabs = [
    { code: "all", label: "전체" },
    ...(cat !== "all" ? SALES_SUBCATEGORIES_BY_CATEGORY[cat as SalesServiceCategory] : []),
  ];

  return (
    <div className="pt-4 flex flex-col gap-3">
      {/* 용역별 탭 */}
      <div className="flex flex-wrap gap-1.5">
        {catTabs.map((t) => (
          <button key={t.code} type="button" onClick={() => { setCat(t.code); setSub("all"); }}
            className="rounded-full px-3.5 py-1 text-xs font-bold border transition"
            style={cat === t.code
              ? { background: "var(--cd-primary-soft)", borderColor: "var(--cd-primary)", color: "var(--cd-primary)" }
              : { borderColor: "var(--cd-border)", color: "var(--cd-muted)" }}>{t.label}</button>
        ))}
      </div>
      {/* 세분류 탭 */}
      <div className="flex flex-wrap gap-1.5">
        {subTabs.map((t) => (
          <button key={t.code} type="button" onClick={() => setSub(t.code)}
            className="rounded-lg px-2.5 py-0.5 text-[11px] font-semibold border transition"
            style={sub === t.code
              ? { background: "var(--cd-primary)", borderColor: "var(--cd-primary)", color: "#fff" }
              : { background: "var(--cd-surface)", borderColor: "transparent", color: "var(--cd-muted)" }}>{t.label}</button>
        ))}
      </div>

      {/* 태그 카드 목록 */}
      {loading ? (
        <div className="cd-text-faint text-sm py-6 text-center">불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="cd-text-faint text-sm py-8 text-center border cd-border-c rounded-xl" style={{ borderStyle: "dashed" }}>해당 조건의 영업 이력이 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((it) => (
            <div key={it.projectId} className="rounded-2xl border cd-border-c p-4">
              <div className="flex items-center gap-3 mb-3">
                <OutcomePill stage={it.stage} outcome={it.outcome} />
                <span className="cd-text-muted text-xs tabular-nums shrink-0">{it.startDate ? `${fmtHistDate(it.startDate)} ~ ${fmtHistDate(it.endDate)}` : "기간 미정"}</span>
                <span className="cd-text text-sm font-bold truncate">{it.title}</span>
              </div>
              <div className="border-t cd-border-c pt-3 flex flex-col md:flex-row gap-4">
                <div className="flex flex-col gap-1.5 md:w-48 shrink-0">
                  {it.members.length ? it.members.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <HistAvatar src={m.photoPath} />
                      <span className="cd-text text-sm">{m.employeeName ?? "—"}</span>
                      {m.positionName && <span className="cd-text-faint text-xs">{m.positionName}</span>}
                    </div>
                  )) : <span className="cd-text-faint text-xs">담당 인력 없음</span>}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5 text-[13px]">
                  <div className="flex gap-2"><span className="cd-text-faint w-16 shrink-0">업무상세</span><span className="cd-text min-w-0">{it.summary ?? "—"}</span></div>
                  <div className="flex gap-2"><span className="cd-text-faint w-16 shrink-0">투찰금액</span><span className="cd-text tabular-nums">{it.bidAmount != null ? `₩${it.bidAmount.toLocaleString()}` : "—"}</span></div>
                  <div className="flex gap-2"><span className="cd-text-faint w-16 shrink-0">추진결과</span><span className="cd-text">{it.outcome ? SALES_OUTCOME_LABELS[it.outcome] ?? "—" : "—"}</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
