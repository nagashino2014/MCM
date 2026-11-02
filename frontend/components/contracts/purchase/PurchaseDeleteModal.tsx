"use client";

import { useState } from "react";
import { ModalShell } from "./primitives";

/** 매입 계약 삭제(331) — 사유를 적어야 지운다(soft delete, 휴지통 연동은 후속). */
export function PurchaseDeleteModal({ contractTitle, onClose, onConfirm }: { contractTitle: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell title="매입 계약 삭제" onClose={onClose}>
      <div className="p-5 grid gap-3">
        <p className="text-sm cd-text">
          <b>{contractTitle}</b> 계약을 삭제합니다. 청구·지급 단계와 첨부 문서 기록이 함께 숨겨지며, 목록에서 바로 사라집니다.
        </p>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold cd-text-muted">삭제 사유</span>
          <textarea className="cd-input min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 중복 등록" />
        </label>
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold cd-text-muted">닫기</button>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason.trim());
            } finally {
              setBusy(false);
            }
          }}
          className="cd-btn cd-btn-danger rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </ModalShell>
  );
}
