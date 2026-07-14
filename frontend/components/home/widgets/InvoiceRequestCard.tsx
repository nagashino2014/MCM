"use client";

import { useMemo, useState } from "react";
import { FileText, ChevronDown, ChevronRight, Folder, FolderOpen, Send, X } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";

interface Milestone {
  milestoneId: string;
  stageLabel: string | null;
  stageOrder: number;
  amount: number | null;
  requested: boolean;
  requestedAt: string | null;
  requestNote: string | null;
}
interface ContractNode {
  contractId: string;
  contractTitle: string | null;
  serviceType: string | null;
  facilityName: string | null;
  milestones: Milestone[];
}

function fmtAmount(amount: number | null): string {
  if (amount == null) return "-";
  return amount.toLocaleString("ko-KR") + "원";
}

/** ISO 시각 → "N일 전"(대략). */
function ago(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "오늘";
  return `${days}일 전`;
}

/** H10 — 내 참여 계약의 미발행 대금단위 트리 + 발행 요청. */
export function InvoiceRequestCard() {
  const w = useHomeWidget<{ contracts: ContractNode[] }>("/api/home/invoice-requests/mine");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const contracts = w.status === "ok" ? w.data.contracts : [];
  const pendingCount = useMemo(
    () => contracts.reduce((sum, c) => sum + c.milestones.filter((m) => !m.requested).length, 0),
    [contracts]
  );

  if (w.status === "forbidden") return null;

  const toggle = (contractId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  };

  const request = async (contractId: string, milestoneId: string) => {
    const note = window.prompt("발행 요청 메모(선택). 비워도 됩니다.") ?? "";
    setBusy(milestoneId);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/milestones/${milestoneId}/invoice-request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note }),
        }
      );
      if (res.ok) w.reload();
      else {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "발행 요청에 실패했습니다.");
      }
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (contractId: string, milestoneId: string) => {
    setBusy(milestoneId);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/milestones/${milestoneId}/invoice-request`,
        { method: "DELETE" }
      );
      if (res.ok) w.reload();
      else {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "요청 취소에 실패했습니다.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <HomeCard
      icon={<FileText className="w-4 h-4" />}
      title="세금계산서 발행 요청"
      count={pendingCount}
      accent="#5D87FF"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && contracts.length === 0}
      emptyText="발행 요청할 대금 단계가 없습니다."
    >
      <div className="flex flex-col gap-2">
        {contracts.map((c) => {
          const style = resolveServiceTypeStyle(c.serviceType);
          const isOpen = !collapsed.has(c.contractId);
          const ParentIcon = isOpen ? FolderOpen : Folder;
          return (
            <div key={c.contractId} className="rounded-lg border cd-border-c overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(c.contractId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[color:var(--cd-surface)]"
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 cd-text-faint shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />
                )}
                <ParentIcon className="w-4 h-4 fill-current shrink-0" style={{ color: style.parentColor }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">{c.contractTitle ?? "제목 없음"}</span>
                  {c.facilityName && (
                    <span className="block text-[11px] cd-text-faint truncate">{c.facilityName}</span>
                  )}
                </span>
                <span className="text-[11px] cd-text-faint shrink-0">{c.milestones.length}단계</span>
              </button>
              {isOpen &&
                c.milestones.map((m) => (
                  <div
                    key={m.milestoneId}
                    className="flex items-center gap-2 pl-9 pr-3 py-2 border-t cd-border-c text-xs"
                  >
                    <Folder className="w-3.5 h-3.5 fill-current shrink-0" style={{ color: style.childColor }} />
                    <span className="flex-1 min-w-0 truncate cd-text">{m.stageLabel ?? "단계"}</span>
                    <span className="font-mono cd-text-faint shrink-0 tabular-nums">{fmtAmount(m.amount)}</span>
                    {m.requested ? (
                      <span className="flex items-center gap-1 shrink-0">
                        <span
                          className="text-[10px] rounded px-1.5 py-0.5"
                          style={{ background: "color-mix(in srgb, #13DEB9 18%, transparent)", color: "#13DEB9" }}
                        >
                          요청됨 · {ago(m.requestedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => cancel(c.contractId, m.milestoneId)}
                          disabled={busy === m.milestoneId}
                          className="cd-text-faint hover:cd-text disabled:opacity-40"
                          title="요청 취소(본인만)"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => request(c.contractId, m.milestoneId)}
                        disabled={busy === m.milestoneId}
                        className="cd-btn cd-btn-primary text-[11px] px-2 py-1 shrink-0 disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" />
                        발행 요청
                      </button>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </HomeCard>
  );
}
