"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatAmount } from "@/components/ui/AmountInput";
import type { PurchaseInvoiceCandidate } from "@/lib/contracts/purchase/types";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { ModalShell, num, str } from "./primitives";

/**
 * 홈택스 매입 세금계산서 후보 연결(331) — 계약상대 사업자번호가 같은 매입 계산서를 단계 금액에 가까운 순으로 보여 주고,
 * 고르면 단계의 수취일·계산서 금액을 그 계산서로 채운다(재무 분개는 건드리지 않는다).
 */
export function InvoiceCandidateModal({
  purchaseContractId,
  milestone,
  onClose,
  onLinked,
}: {
  purchaseContractId: string;
  milestone: Record<string, unknown>;
  onClose: () => void;
  onLinked: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [corpNum, setCorpNum] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PurchaseInvoiceCandidate[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  const milestoneId = str(milestone.milestone_id);
  const target = num(milestone.invoice_amount) || num(milestone.amount);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    purchaseApi<{ candidates: PurchaseInvoiceCandidate[]; corpNum: string | null }>(
      `/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/invoice-candidates?milestoneId=${encodeURIComponent(milestoneId)}`
    )
      .then((json) => {
        if (!alive) return;
        setCandidates(json.candidates);
        setCorpNum(json.corpNum);
      })
      .catch((err) => alive && setError((err as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [purchaseContractId, milestoneId]);

  const link = async (c: PurchaseInvoiceCandidate) => {
    setLinking(c.htiId);
    try {
      await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/milestones/${encodeURIComponent(milestoneId)}`, {
        method: "PATCH",
        ...purchaseJson({ hometaxHtiId: c.htiId, invoiceReceived: true, invoiceReceivedAt: c.writeDate, invoiceAmount: c.totalAmount }),
      });
      toast.show("매입 계산서를 연결하고 수취 정보를 채웠습니다.", "success");
      onLinked();
    } catch (err) {
      toast.show("연결 실패: " + (err as Error).message, "error");
    } finally {
      setLinking(null);
    }
  };

  return (
    <ModalShell title={`홈택스 매입계산서 후보 — ${str(milestone.stage_label)}`} onClose={onClose} wide>
      <div className="p-5 grid gap-3">
        <p className="text-xs cd-text-muted">
          공급자 사업자번호 <span className="font-mono">{corpNum ?? "-"}</span> 의 매입 계산서를 단계 금액
          {target > 0 ? ` ${formatAmount(target)}원` : ""}에 가까운 순으로 보여 줍니다. 홈택스 수집(재무 › 부가세 신고)이 돼 있어야 나옵니다.
        </p>
        {loading ? (
          <p className="text-sm cd-text-faint py-8 text-center">후보를 불러오는 중입니다.</p>
        ) : error ? (
          <p className="text-sm cd-error-text">{error}</p>
        ) : !corpNum ? (
          <p className="rounded-lg border cd-border-c p-4 text-sm cd-text-muted">계약상대 업체에 사업자등록번호가 없어 후보를 찾을 수 없습니다. 사업장 마스터에서 번호를 먼저 채워 주세요.</p>
        ) : candidates.length === 0 ? (
          <p className="rounded-lg border cd-border-c p-4 text-sm cd-text-muted">이 업체의 홈택스 매입 계산서가 없습니다.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="cd-text-faint text-left border-b cd-border-c">
                <th className="py-2 pr-2 font-medium">작성일</th>
                <th className="py-2 pr-2 font-medium">공급자</th>
                <th className="py-2 pr-2 font-medium">품목</th>
                <th className="py-2 pr-2 font-medium text-right">공급가액</th>
                <th className="py-2 pr-2 font-medium text-right">세액</th>
                <th className="py-2 pr-2 font-medium text-right">합계</th>
                <th className="py-2 pr-2 font-medium">승인번호</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const linkedElsewhere = !!c.linkedMilestoneId && c.linkedMilestoneId !== milestoneId;
                const linkedHere = c.linkedMilestoneId === milestoneId;
                const exact = target > 0 && Math.abs(c.totalAmount - target) < 1;
                return (
                  <tr key={c.htiId} className={"border-b cd-border-c " + (exact ? "cd-tint-primary" : "")}>
                    <td className="py-2 pr-2 font-mono tabular-nums cd-text">{c.writeDate}</td>
                    <td className="py-2 pr-2 cd-text truncate max-w-[180px]">{c.invoicerCorpName ?? "-"}</td>
                    <td className="py-2 pr-2 cd-text-muted truncate max-w-[160px]">{c.itemName ?? "-"}</td>
                    <td className="py-2 pr-2 text-right font-mono tabular-nums">{formatAmount(c.amountTotal)}</td>
                    <td className="py-2 pr-2 text-right font-mono tabular-nums">{formatAmount(c.taxTotal)}</td>
                    <td className="py-2 pr-2 text-right font-mono tabular-nums font-semibold">{formatAmount(c.totalAmount)}</td>
                    <td className="py-2 pr-2 font-mono cd-text-faint">{c.ntsSendKey}</td>
                    <td className="py-2 text-right">
                      {linkedHere ? (
                        <span className="text-[11px] cd-text-primary">연결됨</span>
                      ) : linkedElsewhere ? (
                        <span className="text-[11px] cd-text-faint" title="다른 단계에 연결된 계산서">다른 단계</span>
                      ) : (
                        <button
                          type="button"
                          disabled={linking === c.htiId}
                          onClick={() => link(c)}
                          className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] inline-flex items-center gap-1 cd-text-primary disabled:opacity-60"
                        >
                          <Link2 className="w-3 h-3" /> 연결
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold cd-text-muted">닫기</button>
      </div>
    </ModalShell>
  );
}
