"use client";

import { useState } from "react";
import { Inbox, Check } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface InboxItem {
  milestoneId: string;
  contractId: string;
  contractTitle: string | null;
  serviceType: string | null;
  facilityName: string | null;
  stageLabel: string | null;
  amount: number | null;
  requestedAt: string | null;
  requestedByName: string | null;
  requestNote: string | null;
}

function fmtAmount(amount: number | null): string {
  if (amount == null) return "-";
  return amount.toLocaleString("ko-KR") + "원";
}
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** H11 — 발행 요청 수신함(회계). 인라인 발행 폼(발행일·금액) → milestone PATCH. */
export function InvoiceInboxCard() {
  const w = useHomeWidget<{ items: InboxItem[] }>("/api/home/invoice-requests/inbox");
  const [formFor, setFormFor] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayKst());
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);

  if (w.status === "forbidden") return null;
  const items = w.status === "ok" ? w.data.items : [];

  const openForm = (item: InboxItem) => {
    setFormFor(item.milestoneId);
    setDate(todayKst());
    setAmount(item.amount != null ? String(item.amount) : "");
  };

  const issue = async (item: InboxItem) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${item.contractId}/milestones/${item.milestoneId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceIssued: true,
          invoiceIssuedAt: date || todayKst(),
          invoiceAmount: amount === "" ? null : Number(amount),
        }),
      });
      if (res.ok) {
        setFormFor(null);
        w.reload();
      } else {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "발행 처리에 실패했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <HomeCard
      icon={<Inbox className="w-4 h-4" />}
      title="발행 요청 수신함"
      count={items.length}
      accent="#539BFF"
      href="/contracts/billing"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && items.length === 0}
      emptyText="처리할 발행 요청이 없습니다."
    >
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.milestoneId} className="rounded-lg border cd-border-c px-3 py-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] cd-text truncate">
                  {item.contractTitle ?? item.facilityName ?? "제목 없음"}
                  {item.stageLabel ? ` · ${item.stageLabel}` : ""}
                </span>
                <span className="block text-[11px] cd-text-faint truncate">
                  {item.facilityName}
                  {item.requestedByName ? ` · 요청 ${item.requestedByName}` : ""}
                  {item.requestNote ? ` · "${item.requestNote}"` : ""}
                </span>
              </span>
              <span className="font-mono text-[12px] cd-text-faint shrink-0 tabular-nums">
                {fmtAmount(item.amount)}
              </span>
            </div>

            {formFor === item.milestoneId ? (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="cd-input text-[12px] px-2 py-1 h-8"
                />
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="발행 금액"
                  className="cd-input text-[12px] px-2 py-1 h-8 w-32"
                />
                <button
                  type="button"
                  onClick={() => issue(item)}
                  disabled={busy}
                  className="cd-btn cd-btn-primary text-[11px] px-2.5 py-1 disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  발행 완료
                </button>
                <button
                  type="button"
                  onClick={() => setFormFor(null)}
                  className="cd-btn cd-btn-ghost text-[11px] px-2 py-1"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openForm(item)}
                className="cd-btn cd-btn-soft text-[11px] px-2.5 py-1 self-start"
              >
                발행 처리
              </button>
            )}
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
