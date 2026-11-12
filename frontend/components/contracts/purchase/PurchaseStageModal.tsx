"use client";

import { useState } from "react";
import { Link2, Unlink } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { formatAmount } from "@/components/ui/AmountInput";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { ModalShell, formatThousands, num, str, stripDigits } from "./primitives";

/**
 * 청구·지급 단계 추가/수정(331) — 단계명·금액·지급조건과 세금계산서 수취·대금 지급을 한 창에서 기록한다.
 * 홈택스 매입계산서 연결은 저장된 단계에서만 [후보 계산서 찾기]로 연다(연결 시 수취 정보가 채워진다).
 */
export function PurchaseStageModal({
  purchaseContractId,
  milestone,
  onClose,
  onSaved,
  onOpenCandidates,
}: {
  purchaseContractId: string;
  /** null 이면 새 단계 */
  milestone: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
  onOpenCandidates: (milestone: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const isNew = !milestone;
  const [stageLabel, setStageLabel] = useState(str(milestone?.stage_label));
  const [amount, setAmount] = useState(milestone?.amount != null ? String(Math.round(num(milestone.amount))) : "");
  const [paymentTerms, setPaymentTerms] = useState(str(milestone?.payment_terms));
  const [invoiceReceived, setInvoiceReceived] = useState(num(milestone?.invoice_received) === 1);
  const [invoiceReceivedAt, setInvoiceReceivedAt] = useState(str(milestone?.invoice_received_at).slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState(milestone?.invoice_amount != null ? String(Math.round(num(milestone.invoice_amount))) : "");
  const [paymentPaid, setPaymentPaid] = useState(num(milestone?.payment_paid) === 1);
  const [paymentPaidAt, setPaymentPaidAt] = useState(str(milestone?.payment_paid_at).slice(0, 10));
  const [paidAmount, setPaidAmount] = useState(milestone?.paid_amount != null ? String(Math.round(num(milestone.paid_amount))) : "");
  const [memo, setMemo] = useState(str(milestone?.memo));
  const [saving, setSaving] = useState(false);
  const linkedHti = milestone?.hometax_hti_id ? String(milestone.hometax_hti_id) : null;
  const base = `/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/milestones`;

  const submit = async () => {
    if (!stageLabel.trim()) return toast.show("단계명을 입력해 주세요.", "error");
    setSaving(true);
    try {
      const body = {
        stageLabel: stageLabel.trim(),
        amount: amount ? Number(amount) : null,
        paymentTerms: paymentTerms || null,
        invoiceReceived,
        invoiceReceivedAt: invoiceReceived ? invoiceReceivedAt || null : null,
        invoiceAmount: invoiceReceived && invoiceAmount ? Number(invoiceAmount) : null,
        paymentPaid,
        paymentPaidAt: paymentPaid ? paymentPaidAt || null : null,
        paidAmount: paymentPaid ? (paidAmount ? Number(paidAmount) : amount ? Number(amount) : null) : null,
        memo: memo || null,
      };
      if (isNew) await purchaseApi(base, { method: "POST", ...purchaseJson(body) });
      else await purchaseApi(`${base}/${encodeURIComponent(String(milestone!.milestone_id))}`, { method: "PATCH", ...purchaseJson(body) });
      toast.show(isNew ? "단계를 추가했습니다." : "단계를 저장했습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("저장 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const unlink = async () => {
    if (!milestone) return;
    if (!confirm("연결한 홈택스 매입 계산서를 해제할까요? 수취 기록은 그대로 둡니다.")) return;
    try {
      await purchaseApi(`${base}/${encodeURIComponent(String(milestone.milestone_id))}`, { method: "PATCH", ...purchaseJson({ hometaxHtiId: null }) });
      toast.show("계산서 연결을 해제했습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("해제 실패: " + (err as Error).message, "error");
    }
  };

  return (
    <ModalShell title={isNew ? "청구·지급 단계 추가" : `단계 수정 — ${str(milestone?.stage_label)}`} onClose={onClose}>
      <div className="p-5 grid gap-4">
        <div className="grid grid-cols-[1fr_150px] gap-3">
          <label className="grid gap-1 text-sm">
            <span className="cd-label-text">단계명</span>
            <input className="cd-input" value={stageLabel} onChange={(e) => setStageLabel(e.target.value)} placeholder="선급금 / 잔금 / 1월분" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="cd-label-text">청구금액</span>
            <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(amount)} onChange={(e) => setAmount(stripDigits(e.target.value))} />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="cd-label-text">대금 지급 조건</span>
          <input className="cd-input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="세금계산서 수취 후 30일 이내" />
        </label>

        <section className="rounded-lg border cd-border-c p-3 grid gap-2">
          <label className="inline-flex items-center gap-2 text-sm font-semibold cd-text">
            <input type="checkbox" checked={invoiceReceived} onChange={(e) => setInvoiceReceived(e.target.checked)} />
            세금계산서 수취
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs">
              <span className="cd-label-text">수취일</span>
              <AutoDateInput className="cd-input tabular-nums" value={invoiceReceivedAt} onChange={setInvoiceReceivedAt} disabled={!invoiceReceived} />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="cd-label-text">계산서 금액(합계)</span>
              <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(invoiceAmount)} onChange={(e) => setInvoiceAmount(stripDigits(e.target.value))} disabled={!invoiceReceived} placeholder={amount ? formatAmount(Number(amount)) : ""} />
            </label>
          </div>
          {linkedHti ? (
            <div className="flex items-center gap-2 text-xs cd-text-muted">
              <Link2 className="w-3.5 h-3.5 cd-text-primary" />
              홈택스 매입계산서 연결됨 — {str(milestone?.hometax_invoicer_corp_name)} · {str(milestone?.hometax_write_date)} · {formatAmount(num(milestone?.hometax_total_amount))}원
              <span className="font-mono cd-text-faint">{str(milestone?.hometax_nts_send_key)}</span>
              <button type="button" onClick={unlink} className="ml-auto cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] inline-flex items-center gap-1">
                <Unlink className="w-3 h-3" /> 해제
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs cd-text-faint">
              {isNew ? (
                "단계를 저장한 뒤 홈택스 매입계산서 후보를 연결할 수 있습니다."
              ) : (
                <>
                  홈택스에서 수집한 매입 계산서 중 이 업체 건을 골라 연결합니다.
                  <button type="button" onClick={() => onOpenCandidates(milestone!)} className="ml-auto cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] inline-flex items-center gap-1 cd-text-primary">
                    <Link2 className="w-3 h-3" /> 후보 계산서 찾기
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border cd-border-c p-3 grid gap-2">
          <label className="inline-flex items-center gap-2 text-sm font-semibold cd-text">
            <input type="checkbox" checked={paymentPaid} onChange={(e) => setPaymentPaid(e.target.checked)} />
            대금 지급
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs">
              <span className="cd-label-text">지급일</span>
              <AutoDateInput className="cd-input tabular-nums" value={paymentPaidAt} onChange={setPaymentPaidAt} disabled={!paymentPaid} />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="cd-label-text">지급액</span>
              <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(paidAmount)} onChange={(e) => setPaidAmount(stripDigits(e.target.value))} disabled={!paymentPaid} placeholder={amount ? formatAmount(Number(amount)) : ""} />
            </label>
          </div>
          <span className="cd-hint">지급액을 비우면 청구금액 전액 지급으로 기록합니다.</span>
        </section>

        <label className="grid gap-1 text-sm">
          <span className="cd-label-text">메모</span>
          <textarea className="cd-input min-h-[60px]" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white cd-fill-primary disabled:opacity-60">
          {saving ? "저장 중..." : isNew ? "단계 추가" : "저장"}
        </button>
      </div>
    </ModalShell>
  );
}
