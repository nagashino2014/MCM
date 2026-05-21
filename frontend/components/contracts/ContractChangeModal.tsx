"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface ContractChangePayload {
  amounts: Array<{ stageLabel: string; previousAmount: string; nextAmount: string }>;
  servicePeriod: { previous: string; next: string };
  paymentTerms: Array<{ stageLabel: string; previous: string; next: string }>;
  serviceCategory: { previousType: string; previousSubtype: string; nextType: string; nextSubtype: string; changed: boolean };
  closing: { completionDate: string; permitAcquiredAt: string; etc: string };
  termination: { terminated: boolean; terminatedAt: string };
  meta: { changedAt: string; enteredAt: string; memo: string };
}

interface ContractChangeModalProps {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  contractDate: string | null;
  initialMilestones: Array<{ stageLabel: string; amount: number; paymentTerms: string }>;
  initialServiceType: string;
  initialServiceSubtype: string;
  initialEndedAt: string | null;
  initialCurrentAmount: number | null;
  onClose: () => void;
  onSaved: () => void;
}

type TabKey = "amount" | "period" | "terms" | "service" | "closing";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "amount", label: "금액" },
  { key: "period", label: "용역기간" },
  { key: "terms", label: "지급조건" },
  { key: "service", label: "용역분류" },
  { key: "closing", label: "준공일 및 기타" },
];

export default function ContractChangeModal(props: ContractChangeModalProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("amount");
  const [saving, setSaving] = useState(false);
  const [terminated, setTerminated] = useState(false);
  const [terminatedAt, setTerminatedAt] = useState("");
  const [meta, setMeta] = useState({ changedAt: new Date().toISOString().slice(0, 10), enteredAt: new Date().toISOString().slice(0, 10), memo: "" });

  const [amounts, setAmounts] = useState(
    props.initialMilestones.map((m) => ({
      stageLabel: m.stageLabel,
      previousAmount: String(m.amount ?? ""),
      nextAmount: "",
    }))
  );
  const [servicePeriod, setServicePeriod] = useState({
    previous: props.initialEndedAt ?? "",
    next: "",
  });
  const [paymentTerms, setPaymentTerms] = useState(
    props.initialMilestones.map((m) => ({
      stageLabel: m.stageLabel,
      previous: m.paymentTerms ?? "",
      next: "",
    }))
  );
  const [serviceCategory, setServiceCategory] = useState({
    previousType: props.initialServiceType ?? "",
    previousSubtype: props.initialServiceSubtype ?? "",
    nextType: "",
    nextSubtype: "",
    changed: false,
  });
  const [closing, setClosing] = useState({ completionDate: "", permitAcquiredAt: "", etc: "" });

  const newCurrentAmount = useMemo(() => {
    const totalNext = amounts.reduce((acc, item) => acc + (Number(item.nextAmount) || 0), 0);
    if (totalNext > 0) return totalNext;
    return null;
  }, [amounts]);

  const previousAmountTotal = useMemo(
    () => amounts.reduce((acc, item) => acc + (Number(item.previousAmount) || 0), 0),
    [amounts]
  );

  const submit = async () => {
    setSaving(true);
    try {
      const payload: ContractChangePayload = {
        amounts,
        servicePeriod,
        paymentTerms,
        serviceCategory,
        closing,
        termination: { terminated, terminatedAt },
        meta,
      };
      const changedFields: string[] = [];
      if (amounts.some((a) => a.nextAmount !== "")) changedFields.push("amounts");
      if (servicePeriod.next) changedFields.push("servicePeriod");
      if (paymentTerms.some((t) => t.next !== "")) changedFields.push("paymentTerms");
      if (serviceCategory.changed || serviceCategory.nextType || serviceCategory.nextSubtype) changedFields.push("serviceCategory");
      if (closing.completionDate || closing.permitAcquiredAt || closing.etc) changedFields.push("closing");
      if (terminated) changedFields.push("termination");

      const res = await fetch(`/api/contracts/${encodeURIComponent(props.contractId)}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changedAt: meta.changedAt,
          previousAmount: previousAmountTotal || null,
          deltaAmount: newCurrentAmount != null && previousAmountTotal ? newCurrentAmount - previousAmountTotal : null,
          changedServicePeriod: servicePeriod.next || null,
          changedPaymentTerms: paymentTerms
            .filter((t) => t.next)
            .map((t) => `${t.stageLabel}: ${t.next}`)
            .join("\n") || null,
          detail: closing.etc || meta.memo || null,
          payload,
          changedFields,
          newCurrentAmount,
          newEndedAt: terminated ? terminatedAt : closing.completionDate || servicePeriod.next || undefined,
          newServiceType: serviceCategory.changed ? serviceCategory.nextType : undefined,
          newServiceSubtype: serviceCategory.changed ? serviceCategory.nextSubtype : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("변경계약이 저장되었습니다.", "success");
      props.onSaved();
    } catch (err) {
      toast.show("저장 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-[#24251f] text-stone-100 shadow-2xl border border-amber-300/20 overflow-hidden">
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black text-amber-300 tracking-[0.18em] uppercase">Contract Change</p>
            <h2 className="text-xl font-black mt-1">{props.contractTitle}</h2>
            <p className="text-xs text-stone-400 mt-1">{props.counterpartyName} · 계약일 {props.contractDate ?? "-"}</p>
          </div>
          <button type="button" onClick={props.onClose} className="text-stone-300 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-3 grid grid-cols-3 gap-2 text-xs">
          <label className="grid gap-1">
            <span className="font-bold text-stone-400">계약일</span>
            <input type="date" disabled value={props.contractDate ?? ""} className="input-field text-stone-900 disabled:opacity-60" />
          </label>
          <label className="grid gap-1">
            <span className="font-bold text-stone-400">입력일</span>
            <input type="date" value={meta.enteredAt} onChange={(e) => setMeta({ ...meta, enteredAt: e.target.value })} className="input-field text-stone-900" />
          </label>
          <label className="grid gap-1">
            <span className="font-bold text-stone-400">변경일</span>
            <input type="date" value={meta.changedAt} onChange={(e) => setMeta({ ...meta, changedAt: e.target.value })} className="input-field text-stone-900" />
          </label>
        </div>

        <div className="px-5 mt-4 flex gap-1 border-b border-white/10">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={
                "px-3 py-2 text-xs font-bold rounded-t-lg " +
                (activeTab === tab.key ? "bg-amber-300 text-zinc-950" : "bg-white/5 text-stone-300 hover:bg-white/10")
              }
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 max-h-[420px] overflow-auto">
          {activeTab === "amount" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_140px_140px] gap-2 text-[11px] font-bold text-stone-400">
                <span>단계</span>
                <span className="text-right">기존 금액</span>
                <span className="text-right">변경 금액</span>
              </div>
              {amounts.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_140px] gap-2 items-center">
                  <input type="text" className="input-field text-stone-900" value={row.stageLabel}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { stageLabel: e.target.value })} />
                  <input type="number" className="input-field text-stone-900" value={row.previousAmount}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { previousAmount: e.target.value })} />
                  <input type="number" className="input-field text-stone-900" value={row.nextAmount}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { nextAmount: e.target.value })} />
                </div>
              ))}
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setAmounts([...amounts, { stageLabel: `${amounts.length + 1}차`, previousAmount: "", nextAmount: "" }])}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold border border-white/20">+ 단계 추가</button>
                <button type="button" onClick={() => setAmounts(amounts.slice(0, -1))} disabled={amounts.length === 0}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold border border-white/20 disabled:opacity-50">- 단계 삭제</button>
              </div>
              <p className="text-[11px] text-stone-400 mt-2">
                기존 합계 {previousAmountTotal.toLocaleString()} → 변경 합계 {(newCurrentAmount ?? 0).toLocaleString()}
              </p>
            </div>
          )}

          {activeTab === "period" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-300">기존 준공기한</span>
                <input type="date" className="input-field text-stone-900" value={servicePeriod.previous}
                  onChange={(e) => setServicePeriod({ ...servicePeriod, previous: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-300">변경 준공기한</span>
                <input type="date" className="input-field text-stone-900" value={servicePeriod.next}
                  onChange={(e) => setServicePeriod({ ...servicePeriod, next: e.target.value })} />
              </label>
            </div>
          )}

          {activeTab === "terms" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] font-bold text-stone-400">
                <span>단계</span>
                <span>기존 지급조건</span>
                <span>변경 지급조건</span>
              </div>
              {paymentTerms.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                  <input type="text" className="input-field text-stone-900" value={row.stageLabel}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { stageLabel: e.target.value })} />
                  <input type="text" className="input-field text-stone-900" value={row.previous}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { previous: e.target.value })} />
                  <input type="text" className="input-field text-stone-900" value={row.next}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { next: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          {activeTab === "service" && (
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm font-bold text-stone-300">
                <input type="checkbox" checked={serviceCategory.changed}
                  onChange={(e) => setServiceCategory({ ...serviceCategory, changed: e.target.checked })} />
                용역분류 변경 적용
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">기존 대분류</span>
                  <input type="text" disabled className="input-field text-stone-900 disabled:opacity-60"
                    value={serviceCategory.previousType} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">기존 세분류</span>
                  <input type="text" disabled className="input-field text-stone-900 disabled:opacity-60"
                    value={serviceCategory.previousSubtype} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">변경 대분류</span>
                  <input type="text" className="input-field text-stone-900"
                    value={serviceCategory.nextType}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextType: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">변경 세분류</span>
                  <input type="text" className="input-field text-stone-900"
                    value={serviceCategory.nextSubtype}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextSubtype: e.target.value })} />
                </label>
              </div>
            </div>
          )}

          {activeTab === "closing" && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">준공일</span>
                  <input type="date" className="input-field text-stone-900" value={closing.completionDate}
                    onChange={(e) => setClosing({ ...closing, completionDate: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">허가 취득일</span>
                  <input type="date" className="input-field text-stone-900" value={closing.permitAcquiredAt}
                    onChange={(e) => setClosing({ ...closing, permitAcquiredAt: e.target.value })} />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-300">기타 변경사항</span>
                <textarea className="input-field text-stone-900 min-h-[80px]"
                  value={closing.etc} onChange={(e) => setClosing({ ...closing, etc: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-stone-300">
                <input type="checkbox" checked={terminated} onChange={(e) => setTerminated(e.target.checked)} />
                계약 해지/종료
              </label>
              {terminated && (
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-300">해지일</span>
                  <input type="date" className="input-field text-stone-900" value={terminatedAt}
                    onChange={(e) => setTerminatedAt(e.target.value)} />
                </label>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-white/10 flex justify-between items-center gap-2">
          <p className="text-[11px] text-stone-400">변경 사유와 변경 계약서 PDF는 후속 단계에서 첨부 가능합니다.</p>
          <div className="flex gap-2">
            <button type="button" onClick={props.onClose} className="rounded-xl px-4 py-2 text-sm font-bold border border-white/20">
              닫기
            </button>
            <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-black bg-amber-300 text-zinc-950 disabled:opacity-60">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function updateAt<T>(list: T[], setter: (next: T[]) => void, idx: number, patch: Partial<T>) {
  const next = list.slice();
  next[idx] = { ...next[idx], ...patch };
  setter(next);
}
