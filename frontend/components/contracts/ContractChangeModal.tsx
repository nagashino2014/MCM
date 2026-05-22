"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface ContractChangePayload {
  amounts: Array<{ stageLabel: string; previousAmount: string; nextAmount: string }>;
  servicePeriod: { previous: string; next: string };
  paymentTerms: Array<{ stageLabel: string; previous: string; next: string }>;
  serviceCategory: { previousType: string; previousSubtype: string; nextType: string; nextSubtype: string; changed: boolean };
  closing: { completionDate: string; permitAcquiredAt: string; etc: string };
  termination: { terminatedAt: string; terminationReason: string; suspendedAt: string; suspensionReason: string };
  outsourcing: { outsourcingTitle: string; counterpartyName: string; serviceType: string; contractDate: string; endedAt: string; amount: string; memo: string };
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

type TabKey = "amount" | "period" | "terms" | "service" | "outsourcing" | "lifecycle" | "closing";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "amount", label: "금액" },
  { key: "period", label: "용역기간" },
  { key: "terms", label: "지급조건" },
  { key: "service", label: "용역분류" },
  { key: "outsourcing", label: "외주 용역" },
  { key: "lifecycle", label: "계약중지/해지" },
  { key: "closing", label: "준공일 및 기타" },
];

const DEFAULT_OUTSOURCING_TYPES = ["도면 작성", "산업안전 관련", "측정/분석", "디자인", "번역"];
const DEFAULT_TERMINATION_REASONS = ["사업장 폐쇄", "허가대상 제외", "대금 미지급"];
const DEFAULT_SUSPENSION_REASONS = ["사업추진 유보", "가동 지연", "관련허가 지연", "대금 미지급"];

export default function ContractChangeModal(props: ContractChangeModalProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("amount");
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ changedAt: new Date().toISOString().slice(0, 10), enteredAt: new Date().toISOString().slice(0, 10), memo: "" });
  const outsourcingFileRef = useRef<File | null>(null);
  const [outsourcingFileName, setOutsourcingFileName] = useState("");
  const [outsourcingTypes, setOutsourcingTypes] = useState(DEFAULT_OUTSOURCING_TYPES);
  const [terminationReasons, setTerminationReasons] = useState(DEFAULT_TERMINATION_REASONS);
  const [suspensionReasons, setSuspensionReasons] = useState(DEFAULT_SUSPENSION_REASONS);

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
  const [amendmentFile, setAmendmentFile] = useState<File | null>(null);
  const [outsourcing, setOutsourcing] = useState({
    outsourcingTitle: "",
    counterpartyName: "",
    serviceType: DEFAULT_OUTSOURCING_TYPES[0],
    contractDate: "",
    endedAt: "",
    amount: "",
    memo: "",
  });
  const [lifecycle, setLifecycle] = useState({
    terminatedAt: "",
    terminationReason: DEFAULT_TERMINATION_REASONS[0],
    suspendedAt: "",
    suspensionReason: DEFAULT_SUSPENSION_REASONS[0],
  });

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
        termination: lifecycle,
        outsourcing,
        meta,
      };
      const changedFields: string[] = [];
      if (amounts.some((a) => a.nextAmount !== "")) changedFields.push("amounts");
      if (servicePeriod.next) changedFields.push("servicePeriod");
      if (paymentTerms.some((t) => t.next !== "")) changedFields.push("paymentTerms");
      if (serviceCategory.changed || serviceCategory.nextType || serviceCategory.nextSubtype) changedFields.push("serviceCategory");
      if (closing.completionDate || closing.permitAcquiredAt || closing.etc) changedFields.push("closing");
      if (lifecycle.terminatedAt || lifecycle.suspendedAt) changedFields.push("termination");
      if (outsourcing.outsourcingTitle) changedFields.push("outsourcing");

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
          newEndedAt: lifecycle.terminatedAt || closing.completionDate || servicePeriod.next || undefined,
          newServiceType: serviceCategory.changed ? serviceCategory.nextType : undefined,
          newServiceSubtype: serviceCategory.changed ? serviceCategory.nextSubtype : undefined,
          contractTerminatedAt: lifecycle.terminatedAt || undefined,
          contractTerminationReason: lifecycle.terminatedAt ? lifecycle.terminationReason : undefined,
          contractSuspendedAt: lifecycle.suspendedAt || undefined,
          contractSuspensionReason: lifecycle.suspendedAt ? lifecycle.suspensionReason : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }

      // After the change event is recorded, optionally attach an amendment
      // PDF. Failure here is a soft error — the change event itself is
      // already saved, so we only surface a warning and let the user retry
      // the upload from the detail panel.
      if (amendmentFile) {
        try {
          const created = (await res.json().catch(() => ({}))) as { changeId?: string };
          const docForm = new FormData();
          docForm.set("documentType", "amendment");
          docForm.set("documentDate", meta.changedAt);
          if (created.changeId) docForm.set("changeEventId", created.changeId);
          docForm.set("file", amendmentFile);
          const docRes = await fetch(
            `/api/contracts/${encodeURIComponent(props.contractId)}/documents`,
            { method: "POST", body: docForm }
          );
          if (!docRes.ok) {
            const body = await docRes.json().catch(() => ({}));
            throw new Error(body?.error ?? "HTTP " + docRes.status);
          }
        } catch (uploadErr) {
          toast.show("변경계약서 PDF 업로드 실패: " + (uploadErr as Error).message, "error");
        }
      }

      if (outsourcing.outsourcingTitle.trim()) {
        const outsourcingForm = new FormData();
        outsourcingForm.set("outsourcingTitle", outsourcing.outsourcingTitle);
        outsourcingForm.set("counterpartyName", outsourcing.counterpartyName);
        outsourcingForm.set("serviceType", outsourcing.serviceType);
        outsourcingForm.set("contractDate", outsourcing.contractDate);
        outsourcingForm.set("endedAt", outsourcing.endedAt);
        outsourcingForm.set("amount", outsourcing.amount);
        outsourcingForm.set("memo", outsourcing.memo);
        const file = outsourcingFileRef.current;
        if (file) outsourcingForm.set("file", file);
        const outsourcingRes = await fetch(`/api/contracts/${encodeURIComponent(props.contractId)}/outsourcing`, {
          method: "POST",
          body: outsourcingForm,
        });
        if (!outsourcingRes.ok) {
          const body = await outsourcingRes.json().catch(() => ({}));
          throw new Error(body?.error ?? "외주 용역 저장 실패");
        }
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
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className="glass-panel rounded-3xl w-[min(880px,calc(100vw-32px))] max-h-[min(840px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-stone-200/70 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-stone-800">{props.contractTitle}</h3>
            <p className="text-xs text-stone-500 mt-1">{props.counterpartyName} · 계약일 {props.contractDate ?? "-"}</p>
          </div>
          <button type="button" onClick={props.onClose} className="text-stone-400 hover:text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-3 grid grid-cols-3 gap-2 text-xs">
          <label className="grid gap-1">
            <span className="font-bold text-stone-500">계약일</span>
            <input type="date" disabled value={props.contractDate ?? ""} className="input-field disabled:opacity-60" />
          </label>
          <label className="grid gap-1">
            <span className="font-bold text-stone-500">입력일</span>
            <input type="date" value={meta.enteredAt} onChange={(e) => setMeta({ ...meta, enteredAt: e.target.value })} className="input-field" />
          </label>
          <label className="grid gap-1">
            <span className="font-bold text-stone-500">변경일</span>
            <input type="date" value={meta.changedAt} onChange={(e) => setMeta({ ...meta, changedAt: e.target.value })} className="input-field" />
          </label>
        </div>

        <div className="px-5 mt-4 flex gap-1 border-b border-stone-200/70">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={
                "px-3 py-2 text-xs font-bold rounded-t-lg " +
                (activeTab === tab.key
                  ? "bg-primary text-white shadow-sm"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200")
              }
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 h-[440px] overflow-y-auto scrollbar-hide">
          {activeTab === "amount" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_140px_140px] gap-2 text-[11px] font-bold text-stone-500">
                <span>단계</span>
                <span className="text-right">기존 금액</span>
                <span className="text-right">변경 금액</span>
              </div>
              {amounts.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_140px] gap-2 items-center">
                  <input type="text" className="input-field" value={row.stageLabel}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { stageLabel: e.target.value })} />
                  <input type="number" className="input-field" value={row.previousAmount}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { previousAmount: e.target.value })} />
                  <input type="number" className="input-field" value={row.nextAmount}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { nextAmount: e.target.value })} />
                </div>
              ))}
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setAmounts([...amounts, { stageLabel: `${amounts.length + 1}차`, previousAmount: "", nextAmount: "" }])}
                  className="glass-button rounded-lg px-3 py-1.5 text-[11px] font-bold text-stone-700">+ 단계 추가</button>
                <button type="button" onClick={() => setAmounts(amounts.slice(0, -1))} disabled={amounts.length === 0}
                  className="glass-button rounded-lg px-3 py-1.5 text-[11px] font-bold text-stone-700 disabled:opacity-50">- 단계 삭제</button>
              </div>
              <p className="text-[11px] text-stone-500 mt-2">
                기존 합계 {previousAmountTotal.toLocaleString()} → 변경 합계 {(newCurrentAmount ?? 0).toLocaleString()}
              </p>
            </div>
          )}

          {activeTab === "period" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">기존 준공기한</span>
                <input type="date" className="input-field" value={servicePeriod.previous}
                  onChange={(e) => setServicePeriod({ ...servicePeriod, previous: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">변경 준공기한</span>
                <input type="date" className="input-field" value={servicePeriod.next}
                  onChange={(e) => setServicePeriod({ ...servicePeriod, next: e.target.value })} />
              </label>
            </div>
          )}

          {activeTab === "terms" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] font-bold text-stone-500">
                <span>단계</span>
                <span>기존 지급조건</span>
                <span>변경 지급조건</span>
              </div>
              {paymentTerms.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                  <input type="text" className="input-field" value={row.stageLabel}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { stageLabel: e.target.value })} />
                  <input type="text" className="input-field" value={row.previous}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { previous: e.target.value })} />
                  <input type="text" className="input-field" value={row.next}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { next: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          {activeTab === "service" && (
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm font-bold text-stone-700">
                <input type="checkbox" checked={serviceCategory.changed}
                  onChange={(e) => setServiceCategory({ ...serviceCategory, changed: e.target.checked })} />
                용역분류 변경 적용
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-700">기존 대분류</span>
                  <input type="text" disabled className="input-field disabled:opacity-60"
                    value={serviceCategory.previousType} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-700">기존 세분류</span>
                  <input type="text" disabled className="input-field disabled:opacity-60"
                    value={serviceCategory.previousSubtype} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-700">변경 대분류</span>
                  <input type="text" className="input-field"
                    value={serviceCategory.nextType}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextType: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-700">변경 세분류</span>
                  <input type="text" className="input-field"
                    value={serviceCategory.nextSubtype}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextSubtype: e.target.value })} />
                </label>
              </div>
            </div>
          )}

          {activeTab === "outsourcing" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold text-stone-700">외주 계약명</span>
                <input className="input-field" value={outsourcing.outsourcingTitle}
                  onChange={(e) => setOutsourcing({ ...outsourcing, outsourcingTitle: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold text-stone-700">계약상대 업체</span>
                <input className="input-field" value={outsourcing.counterpartyName}
                  onChange={(e) => setOutsourcing({ ...outsourcing, counterpartyName: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">용역분류</span>
                <select className="ui-select max-w-[220px]" value={outsourcing.serviceType}
                  onChange={(e) => setOutsourcing({ ...outsourcing, serviceType: e.target.value })}>
                  {outsourcingTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <div className="flex items-end justify-start gap-2">
                <button type="button" className="glass-button rounded-xl px-3 py-2 text-xs text-stone-700"
                  onClick={() => {
                    const next = prompt("추가할 외주 용역 분류명을 입력하세요.");
                    if (!next?.trim()) return;
                    setOutsourcingTypes((prev) => prev.includes(next.trim()) ? prev : [...prev, next.trim()]);
                    setOutsourcing({ ...outsourcing, serviceType: next.trim() });
                  }}>
                  분류 추가
                </button>
                <button type="button" className="glass-button rounded-xl px-3 py-2 text-xs text-rose-600"
                  onClick={() => {
                    if (outsourcingTypes.length <= 1) return;
                    const next = outsourcingTypes.filter((type) => type !== outsourcing.serviceType);
                    setOutsourcingTypes(next);
                    setOutsourcing({ ...outsourcing, serviceType: next[0] ?? "" });
                  }}>
                  삭제
                </button>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">계약금액</span>
                <input className="input-field tabular-nums" inputMode="numeric" value={formatThousands(outsourcing.amount)}
                  onChange={(e) => setOutsourcing({ ...outsourcing, amount: stripDigits(e.target.value) })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">계약일</span>
                <input type="date" className="input-field" value={outsourcing.contractDate}
                  onChange={(e) => setOutsourcing({ ...outsourcing, contractDate: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">준공일</span>
                <input type="date" className="input-field" value={outsourcing.endedAt}
                  onChange={(e) => setOutsourcing({ ...outsourcing, endedAt: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold text-stone-700">메모</span>
                <textarea className="input-field min-h-[80px]" value={outsourcing.memo}
                  onChange={(e) => setOutsourcing({ ...outsourcing, memo: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold text-stone-700">외주 계약서 PDF</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    outsourcingFileRef.current = file;
                    setOutsourcingFileName(file?.name ?? "");
                  }}
                />
                {outsourcingFileName && <span className="text-[11px] text-stone-500">선택됨: {outsourcingFileName}</span>}
              </label>
            </div>
          )}

          {activeTab === "lifecycle" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">계약해지일</span>
                <input type="date" className="input-field" value={lifecycle.terminatedAt}
                  onChange={(e) => setLifecycle({ ...lifecycle, terminatedAt: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">해지 사유</span>
                <select className="ui-select" value={lifecycle.terminationReason}
                  onChange={(e) => setLifecycle({ ...lifecycle, terminationReason: e.target.value })}>
                  {terminationReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <ListEditorButtons
                label="해지 사유"
                options={terminationReasons}
                value={lifecycle.terminationReason}
                onOptions={setTerminationReasons}
                onValue={(terminationReason) => setLifecycle({ ...lifecycle, terminationReason })}
              />
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">계약중지일</span>
                <input type="date" className="input-field" value={lifecycle.suspendedAt}
                  onChange={(e) => setLifecycle({ ...lifecycle, suspendedAt: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">계약 중지 사유</span>
                <select className="ui-select" value={lifecycle.suspensionReason}
                  onChange={(e) => setLifecycle({ ...lifecycle, suspensionReason: e.target.value })}>
                  {suspensionReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <ListEditorButtons
                label="중지 사유"
                options={suspensionReasons}
                value={lifecycle.suspensionReason}
                onOptions={setSuspensionReasons}
                onValue={(suspensionReason) => setLifecycle({ ...lifecycle, suspensionReason })}
              />
            </div>
          )}

          {activeTab === "closing" && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-700">준공일</span>
                  <input type="date" className="input-field" value={closing.completionDate}
                    onChange={(e) => setClosing({ ...closing, completionDate: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold text-stone-700">허가 취득일</span>
                  <input type="date" className="input-field" value={closing.permitAcquiredAt}
                    onChange={(e) => setClosing({ ...closing, permitAcquiredAt: e.target.value })} />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">기타 변경사항</span>
                <textarea className="input-field min-h-[80px]"
                  value={closing.etc} onChange={(e) => setClosing({ ...closing, etc: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold text-stone-700">변경계약서 PDF (선택)</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                  onChange={(e) => setAmendmentFile(e.target.files?.[0] ?? null)}
                />
                <span className="text-[11px] text-stone-500">
                  업로드 시 원 계약 폴더에 동일 형식(<code>(YYYY-MM-DD)계약명 변경계약서.pdf</code>)으로 저장됩니다.
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-stone-200/70 flex justify-between items-center gap-2">
          <p className="text-[11px] text-stone-500">변경계약서 PDF는 &quot;준공일 및 기타&quot; 탭에서 첨부할 수 있습니다.</p>
          <div className="flex gap-2">
            <button type="button" onClick={props.onClose} className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700">
              닫기
            </button>
            <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm disabled:opacity-60">
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

function formatThousands(value: string): string {
  const digits = stripDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

function stripDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function ListEditorButtons({
  label,
  options,
  value,
  onOptions,
  onValue,
}: {
  label: string;
  options: string[];
  value: string;
  onOptions: (next: string[]) => void;
  onValue: (next: string) => void;
}) {
  return (
    <div className="col-span-2 flex justify-end gap-2">
      <button
        type="button"
        className="glass-button rounded-xl px-3 py-2 text-xs text-stone-700"
        onClick={() => {
          const next = prompt(`추가할 ${label}를 입력하세요.`);
          if (!next?.trim()) return;
          const trimmed = next.trim();
          onOptions(options.includes(trimmed) ? options : [...options, trimmed]);
          onValue(trimmed);
        }}
      >
        목록 추가
      </button>
      <button
        type="button"
        className="glass-button rounded-xl px-3 py-2 text-xs text-rose-600"
        onClick={() => {
          if (options.length <= 1) return;
          const next = options.filter((item) => item !== value);
          onOptions(next);
          onValue(next[0] ?? "");
        }}
      >
        선택 삭제
      </button>
    </div>
  );
}
