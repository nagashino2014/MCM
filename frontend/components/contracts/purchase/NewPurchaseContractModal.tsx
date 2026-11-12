"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CdHelp } from "@/components/cdash/CdHelp";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { createRateCard, rateCardHasContent, type RateCardData, type RateCardRound, type RateCardStageOption } from "@/lib/contracts/rate-card";
import { monthlyKindFor, purchaseTabsFor, type PurchaseTabKey } from "@/lib/contracts/purchase/options";
import type { PurchaseMonthlyEntry } from "@/lib/contracts/purchase/types";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { ModalShell, formatThousands, stripDigits } from "./primitives";
import {
  PurchaseContractForm,
  createEmptyPurchaseFormState,
  purchaseFormToBody,
  validatePurchaseForm,
  type PurchaseFormState,
} from "./PurchaseContractForm";
import { PurchaseRateCardTab } from "./PurchaseRateCardTab";
import { PurchaseLeaseDetailFields } from "./PurchaseLeaseDetailFields";
import { PurchaseMonthlyPanel, emptyMonthlyEntries } from "./PurchaseMonthlyPanel";

interface MilestoneDraft {
  id: string;
  stageLabel: string;
  amount: string;
  paymentTerms: string;
}

const createDraft = (): MilestoneDraft => ({ id: Math.random().toString(36).slice(2, 10), stageLabel: "", amount: "", paymentTerms: "" });

/**
 * 신규 매입 계약 입력(331·333) — 탭은 유형·분류·계약 조건에 따라 purchaseTabsFor 가 정한다.
 * 저장 순서: 계약 → [단가 기준표] → [청구·수금 단계(외주)] → [월별 금액(올해 draft)] → [차량 등록증] → [계약서 PDF(관리 계약 제외)].
 * 관리비 명세서는 계약을 만든 뒤 상세 화면의 납부 현황에서 올린다.
 */
export function NewPurchaseContractModal({ onClose, onSaved }: { onClose: () => void; onSaved: (purchaseContractId: string) => void }) {
  const toast = useToast();
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<PurchaseTabKey>("basic");
  const [form, setForm] = useState<PurchaseFormState>(createEmptyPurchaseFormState);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([createDraft()]);
  const [rateCard, setRateCard] = useState<RateCardData>(createRateCard);
  const [monthlyYear, setMonthlyYear] = useState(() => new Date().getFullYear());
  const [monthly, setMonthly] = useState<PurchaseMonthlyEntry[]>(emptyMonthlyEntries);
  const [registrationFile, setRegistrationFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const tabs = useMemo(() => purchaseTabsFor(form), [form]);
  // 유형 변경·체크 해제로 탭이 사라지면 계약 상세정보로 돌아간다(빈 화면 방지).
  useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab("basic");
  }, [tabs, tab]);

  const validMilestones = useMemo(() => milestones.filter((m) => m.stageLabel.trim()), [milestones]);
  const milestoneSum = useMemo(() => validMilestones.reduce((acc, m) => acc + Number(m.amount || 0), 0), [validMilestones]);
  const monthlyKind = monthlyKindFor(form.contractType);

  const updateMilestone = (id: string, patch: Partial<MilestoneDraft>) =>
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // 단가 계약 차수 → 청구·수금 단계(매출 모달과 같은 동작: 차수 지급 단위를 단계 행으로 넣는다)
  const addRoundStages = (_round: RateCardRound, stages: RateCardStageOption[]) => {
    setMilestones((prev) => {
      const kept = prev.filter((m) => m.stageLabel.trim());
      const existing = new Set(kept.map((m) => m.stageLabel.trim()));
      const added = stages.filter((s) => !existing.has(s.label)).map((s) => ({ ...createDraft(), stageLabel: s.label, amount: String(Math.round(s.amount)) }));
      return [...kept, ...added];
    });
    toast.show(`${stages.length}개 단계를 청구·수금 단계에 추가했습니다.`, "success");
    setTab("milestones");
  };

  const changeMonthly = (month: number, patch: { amount?: string; purpose?: string }) =>
    setMonthly((prev) =>
      prev.map((m) =>
        m.month === month
          ? { ...m, ...(patch.amount !== undefined ? { amount: patch.amount === "" ? null : Number(patch.amount) } : {}), ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}) }
          : m
      )
    );

  const submit = async () => {
    const formError = validatePurchaseForm(form);
    if (formError) {
      toast.show(formError, "error");
      setTab(formError.includes("차종") ? "leaseDetail" : "basic");
      return;
    }
    setSaving(true);
    try {
      const { purchaseContractId } = await purchaseApi<{ purchaseContractId: string }>("/api/purchase-contracts", {
        method: "POST",
        ...purchaseJson(purchaseFormToBody(form)),
      });
      const base = `/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}`;
      if (form.contractType === "outsourcing") {
        if (form.isUnitPrice && rateCardHasContent(rateCard)) {
          await purchaseApi(`${base}/rate-card`, { method: "PUT", ...purchaseJson({ card: rateCard }) });
        }
        for (let i = 0; i < validMilestones.length; i++) {
          const m = validMilestones[i];
          await purchaseApi(`${base}/milestones`, {
            method: "POST",
            ...purchaseJson({ stageLabel: m.stageLabel, stageOrder: i + 1, amount: m.amount ? Number(m.amount) : null, paymentTerms: m.paymentTerms || null }),
          });
        }
      }
      const monthlyOpen = tabs.some((t) => t.key === "extra" || t.key === "metered" || t.key === "feeStatus");
      if (monthlyKind && monthlyOpen && monthly.some((m) => m.amount != null || m.purpose.trim())) {
        await purchaseApi(`${base}/monthly`, {
          method: "PUT",
          ...purchaseJson({ kind: monthlyKind, year: monthlyYear, months: monthly.map((m) => ({ month: m.month, amount: m.amount, purpose: m.purpose })) }),
        });
      }
      if (registrationFile && form.contractType === "lease" && form.contractCategory === "차량 렌트") {
        const fd = new FormData();
        fd.set("file", registrationFile);
        await purchaseApi(`${base}/vehicle-registration`, { method: "POST", body: fd });
      }
      if (documentFile && form.contractType !== "management") {
        const fd = new FormData();
        fd.set("documentType", "contract");
        fd.set("documentDate", form.contractDate || new Date().toISOString().slice(0, 10));
        fd.set("file", documentFile);
        await purchaseApi(`${base}/documents`, { method: "POST", body: fd });
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
      <div className="border-b cd-border-c px-5 pt-4 flex gap-2 flex-wrap">
        {tabs.map(({ key, label }) => (
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

        {tab === "ratecard" && <PurchaseRateCardTab data={rateCard} onChange={setRateCard} onAddStages={addRoundStages} />}

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
                  <span className="cd-label-text">단계명</span>
                  <input className="cd-input" value={m.stageLabel} onChange={(e) => updateMilestone(m.id, { stageLabel: e.target.value })} placeholder="선급금 / 중도금 / 잔금 / 1월분" />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="cd-label-text">청구금액</span>
                  <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(m.amount)} onChange={(e) => updateMilestone(m.id, { amount: stripDigits(e.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="cd-label-text">대금 지급 조건</span>
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

        {tab === "leaseDetail" && (
          <PurchaseLeaseDetailFields
            category={form.contractCategory}
            value={form.typeDetails}
            onChange={(typeDetails) => setForm({ ...form, typeDetails })}
            registrationFile={registrationFile}
            onRegistrationFile={setRegistrationFile}
          />
        )}

        {(tab === "extra" || tab === "metered" || tab === "feeStatus") && monthlyKind && (
          <PurchaseMonthlyPanel
            kind={monthlyKind}
            year={monthlyYear}
            years={[]}
            onYearChange={setMonthlyYear}
            months={monthly}
            yearlyTotals={[]}
            onChangeMonth={changeMonthly}
            theme={theme}
            footerLeft={
              monthlyKind === "management_fee" ? (
                <span className="text-[11px] cd-text-faint">관리비 명세서 PDF 는 계약 등록 후 상세 화면의 납부 현황에서 올립니다.</span>
              ) : monthlyKind === "metered" ? (
                <span className="text-[11px] cd-text-faint">분개장 대조는 계약 등록 후 상세 화면에서 합니다.</span>
              ) : null
            }
          />
        )}

        {tab === "document" && (
          <div className="grid gap-4">
            <div className="grid gap-1 text-sm">
              <span className="cd-label-text">계약서 PDF 첨부</span>
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
