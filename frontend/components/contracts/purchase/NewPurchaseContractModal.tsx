"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CdHelp } from "@/components/cdash/CdHelp";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { ModalShell, formatThousands, stripDigits } from "./primitives";
import {
  PurchaseContractForm,
  createEmptyPurchaseFormState,
  purchaseFormToBody,
  validatePurchaseForm,
  type PurchaseFormState,
} from "./PurchaseContractForm";

interface MilestoneDraft {
  id: string;
  stageLabel: string;
  amount: string;
  paymentTerms: string;
}

const createDraft = (): MilestoneDraft => ({ id: Math.random().toString(36).slice(2, 10), stageLabel: "", amount: "", paymentTerms: "" });

/**
 * 신규 매입 계약 입력(331) — 탭은 계약 상세정보 / 청구·수금 단계 / 계약서 PDF 세 개.
 * 저장 순서는 매출 신규 계약과 같다: 계약 → 단계 → 계약서 PDF. 계약금액은 단계 합계로 서버가 채운다.
 */
export function NewPurchaseContractModal({ onClose, onSaved }: { onClose: () => void; onSaved: (purchaseContractId: string) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"basic" | "milestones" | "document">("basic");
  const [form, setForm] = useState<PurchaseFormState>(createEmptyPurchaseFormState);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([createDraft()]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const validMilestones = useMemo(() => milestones.filter((m) => m.stageLabel.trim()), [milestones]);
  const milestoneSum = useMemo(() => validMilestones.reduce((acc, m) => acc + Number(m.amount || 0), 0), [validMilestones]);

  const updateMilestone = (id: string, patch: Partial<MilestoneDraft>) =>
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const submit = async () => {
    const formError = validatePurchaseForm(form);
    if (formError) {
      toast.show(formError, "error");
      setTab("basic");
      return;
    }
    setSaving(true);
    try {
      const { purchaseContractId } = await purchaseApi<{ purchaseContractId: string }>("/api/purchase-contracts", {
        method: "POST",
        ...purchaseJson(purchaseFormToBody(form)),
      });
      for (let i = 0; i < validMilestones.length; i++) {
        const m = validMilestones[i];
        await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/milestones`, {
          method: "POST",
          ...purchaseJson({ stageLabel: m.stageLabel, stageOrder: i + 1, amount: m.amount ? Number(m.amount) : null, paymentTerms: m.paymentTerms || null }),
        });
      }
      if (documentFile) {
        const fd = new FormData();
        fd.set("documentType", "contract");
        fd.set("documentDate", form.contractDate || new Date().toISOString().slice(0, 10));
        fd.set("file", documentFile);
        await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/documents`, { method: "POST", body: fd });
      }
      toast.show("매입 계약이 등록되었습니다.", "success");
      onSaved(purchaseContractId);
    } catch (err) {
      toast.show("등록 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="신규 매입 계약 입력" onClose={onClose} wide>
      <div className="border-b cd-border-c px-5 pt-4 flex gap-2">
        {([
          ["basic", "계약 상세정보"],
          ["milestones", "청구·수금 단계"],
          ["document", "계약서 PDF"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-t-xl px-3 py-2 text-xs border border-b-0 " +
              (tab === key ? "cd-card-bg cd-text-primary border-[color:var(--cd-primary)]" : "cd-surface-bg cd-text-faint cd-border-c")
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 min-h-[520px]">
        {tab === "basic" && <PurchaseContractForm state={form} onChange={setForm} amount={milestoneSum} />}

        {tab === "milestones" && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 text-xs cd-text-muted">
              대금 지급 조건을 단계별로 적습니다. 단계 금액 합계가 계약금액이 됩니다.
              <CdHelp topic="purchase.stages" />
            </div>
            {milestones.map((m, idx) => (
              <div key={m.id} className="grid grid-cols-[56px_1fr_150px_1.2fr_40px] gap-2 items-end rounded-lg border cd-border-c cd-surface-bg p-3">
                <div className="text-xs cd-text-faint pb-2">{idx + 1}차</div>
                <label className="grid gap-1 text-xs">
                  <span className="cd-text-faint">단계명</span>
                  <input className="cd-input" value={m.stageLabel} onChange={(e) => updateMilestone(m.id, { stageLabel: e.target.value })} placeholder="선급금 / 중도금 / 잔금 / 1월분" />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="cd-text-faint">청구금액</span>
                  <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(m.amount)} onChange={(e) => updateMilestone(m.id, { amount: stripDigits(e.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="cd-text-faint">대금 지급 조건</span>
                  <input className="cd-input" value={m.paymentTerms} onChange={(e) => updateMilestone(m.id, { paymentTerms: e.target.value })} placeholder="세금계산서 수취 후 30일 이내" />
                </label>
                <button type="button" className="rounded-lg p-2 cd-error-text hover:cd-error-bg" onClick={() => setMilestones((prev) => prev.filter((item) => item.id !== m.id))}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cd-btn cd-btn-ghost rounded-lg px-3 py-2 text-sm cd-text-muted inline-flex items-center gap-2 justify-center"
              onClick={() => setMilestones((prev) => [...prev, createDraft()])}
            >
              <Plus className="w-4 h-4" />
              단계 추가
            </button>
          </div>
        )}

        {tab === "document" && (
          <div className="grid gap-4">
            <div className="grid gap-1 text-sm">
              <span className="font-semibold cd-text-muted">계약서 PDF 첨부</span>
              <FileDropZone value={documentFile} onChange={setDocumentFile} hint="매입 계약서 PDF 1개 · 30MB 이하" />
            </div>
            <p className="text-xs cd-text-faint">
              저장 경로는 계약일 기준 <code>매입계약서/년도/(계약일) 계약명</code> 논리 경로로 생성됩니다.
            </p>
          </div>
        )}
      </div>

      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white cd-fill-primary disabled:opacity-60">
          {saving ? "저장 중..." : "계약 등록"}
        </button>
      </div>
    </ModalShell>
  );
}
