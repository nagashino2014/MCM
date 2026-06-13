"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ContractReceivableRow } from "@/lib/ieps/receivables-types";
import { CATEGORY_META, fmtFull } from "@/components/contracts/dashboard/types";
import { AutoDateInput } from "@/components/ui/AutoDateInput";

function stripDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function formatThousands(value: string): string {
  const digits = stripDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

/**
 * 미수금 리스트에서 좌클릭 시 뜨는 수금 정보 입력 모달.
 * 해당 미수금 건의 청구/수금 단계(milestone)에 직접 수금 정보를 기록한다.
 */
export function CollectionEntryModal({
  row,
  initial,
  onClose,
  onSaved,
}: {
  row: ContractReceivableRow;
  /** 기존 수금 정보 수정 시 초기값 (대쉬보드 수금내역 등) */
  initial?: { collectedAt?: string | null; collectedAmount?: number | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [collectedAt, setCollectedAt] = useState(initial?.collectedAt || today);
  const [collectedAmount, setCollectedAmount] = useState(
    String(initial?.collectedAmount ?? row.outstandingAmount)
  );
  const [markCollected, setMarkCollected] = useState(true);
  const [partialMemo, setPartialMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collectedNum = Number(stripDigits(collectedAmount) || "0");
  const isPartial = collectedNum > 0 && collectedNum < row.invoiceAmount;

  const submit = async () => {
    if (!collectedAt) {
      setError("수금일을 입력해 주세요.");
      return;
    }
    if (collectedNum <= 0) {
      setError("수금금액을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ratio =
        row.invoiceAmount > 0
          ? Math.min(1, Math.max(0, Math.round((collectedNum / row.invoiceAmount) * 10000) / 10000))
          : 0;
      const body: Record<string, unknown> = {
        paymentCollected: markCollected,
        paymentCollectedAt: collectedAt,
        collectedAmount: String(collectedNum),
        collectionRatio: String(ratio),
      };
      if (partialMemo.trim()) body.partialPaymentMemo = partialMemo.trim();
      const res = await fetch(
        `/api/contracts/${encodeURIComponent(row.contractId)}/milestones/${encodeURIComponent(row.milestoneId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string })?.error ?? "HTTP " + res.status);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cdb-modal-overlay" onClick={onClose}>
      <div className="cdb-modal" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.18em] uppercase" style={{ color: "var(--cd-primary)" }}>
              수금 정보 입력
            </p>
            <h3 className="text-sm font-extrabold truncate" style={{ color: "var(--cd-text)" }}>
              {row.contractTitle}
            </h3>
            <p className="text-[11px] font-bold truncate" style={{ color: "var(--cd-faint)" }}>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                style={{ background: CATEGORY_META[row.category]?.color ?? "var(--cd-faint)" }}
              />
              {row.counterpartyName || "-"} · {row.stageLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg"
            style={{ background: "var(--cd-surface)", color: "var(--cd-muted)", border: "1px solid var(--cd-border)" }}
            aria-label="닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 발행 정보 요약 */}
        <div
          className="grid grid-cols-3 gap-2 rounded-xl p-3 mb-3"
          style={{ background: "var(--cd-surface)", border: "1px solid var(--cd-border)" }}
        >
          <div>
            <p className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>발행일</p>
            <p className="text-[12px] font-bold tabular-nums" style={{ color: "var(--cd-text)" }}>
              {row.invoiceIssuedAt ?? "-"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>발행금액</p>
            <p className="text-[12px] font-bold tabular-nums" style={{ color: "var(--cd-text)" }}>
              {fmtFull(row.invoiceAmount)}원
            </p>
          </div>
          <div>
            <p className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>미수금액</p>
            <p className="text-[12px] font-extrabold tabular-nums" style={{ color: "#FF7575" }}>
              {fmtFull(row.outstandingAmount)}원
            </p>
          </div>
          <div className="col-span-3">
            <p className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>대금지급조건</p>
            <p className="text-[12px] font-bold" style={{ color: "var(--cd-text)" }}>
              {row.paymentTerms || "-"}
            </p>
          </div>
        </div>

        {/* 입력 폼 */}
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-muted)" }}>수금일</span>
            <AutoDateInput className="cd-input" value={collectedAt} onChange={setCollectedAt} />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-muted)" }}>수금금액</span>
            <input
              type="text"
              inputMode="numeric"
              className="cd-input tabular-nums"
              value={formatThousands(collectedAmount)}
              onChange={(e) => setCollectedAmount(stripDigits(e.target.value))}
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-[12px] font-bold" style={{ color: "var(--cd-text)" }}>
            <input
              type="checkbox"
              checked={markCollected}
              onChange={(e) => setMarkCollected(e.target.checked)}
            />
            수금 완료 처리
          </label>
          {isPartial && (
            <label className="col-span-2 grid gap-1">
              <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-muted)" }}>부분입금 사유</span>
              <textarea
                className="cd-input min-h-[70px]"
                placeholder="예: 업체 자금 사정으로 일부만 입금, 잔액 추후 입금 예정 등"
                value={partialMemo}
                onChange={(e) => setPartialMemo(e.target.value)}
              />
            </label>
          )}
        </div>

        {error && (
          <p
            className="mt-3 text-[11px] font-bold px-3 py-2 rounded-lg"
            style={{ background: "var(--cd-error-soft, rgba(250,137,107,0.14))", color: "var(--cd-error, #fa896b)" }}
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="cd-chip" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="cd-chip"
            data-active="true"
            disabled={saving}
            onClick={submit}
          >
            {saving ? "저장 중…" : "수금 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
