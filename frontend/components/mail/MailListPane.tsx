"use client";

// 메일 3-pane 중앙 — 메시지 목록(G2-2/3): 검색·체크 일괄작업·별표·안읽음 강조.
// 폴더별 가용 액션이 다르다(inbox=보관/스팸/휴지통, trash=복원/영구삭제 …).

import { useState } from "react";
import {
  Archive,
  Inbox,
  Loader2,
  MailOpen,
  MailX,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CdCheckbox } from "@/components/cdash/CdField";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdIconButton } from "@/components/cdash/CdButton";
import type { MailListItem } from "@/lib/mail/messages";
import type { MailDraft } from "@/lib/mail/drafts";

/** 그룹웨어 관례 날짜 — 오늘 HH:mm / 올해 M.D / 이전 YYYY.M.D */
export function fmtListDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}.${d.getDate()}`;
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export type BulkAction = { action: string; target?: string };

export function MailListPane({
  folder,
  items,
  drafts,
  loading,
  activeId,
  q,
  onSearch,
  onRefresh,
  onOpen,
  onOpenDraft,
  onBulk,
  onToggleStar,
}: {
  folder: string;
  items: MailListItem[];
  drafts: MailDraft[];
  loading: boolean;
  activeId: string | null;
  q: string;
  onSearch: (q: string) => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onOpenDraft: (d: MailDraft) => void;
  onBulk: (ids: string[], act: BulkAction) => void;
  onToggleStar: (id: string, star: boolean) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qInput, setQInput] = useState(q);
  const isDrafts = folder === "drafts";

  const toggleAll = () => {
    setSelected((prev) => (prev.size === items.length && items.length > 0 ? new Set() : new Set(items.map((m) => m.messageId))));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const runBulk = (act: BulkAction) => {
    if (!selected.size) return;
    onBulk([...selected], act);
    setSelected(new Set());
  };

  // 폴더별 일괄 액션 구성.
  const bulkButtons: { key: string; label: string; icon: React.ReactNode; act: BulkAction; danger?: boolean }[] =
    folder === "inbox"
      ? [
          { key: "read", label: "읽음", icon: <MailOpen className="w-4 h-4" />, act: { action: "read" } },
          { key: "unread", label: "안읽음", icon: <MailX className="w-4 h-4" />, act: { action: "unread" } },
          { key: "archive", label: "보관", icon: <Archive className="w-4 h-4" />, act: { action: "move", target: "archive" } },
          { key: "spam", label: "스팸", icon: <ShieldAlert className="w-4 h-4" />, act: { action: "move", target: "spam" } },
          { key: "trash", label: "삭제", icon: <Trash2 className="w-4 h-4" />, act: { action: "trash" }, danger: true },
        ]
      : folder === "trash"
        ? [
            { key: "restore", label: "복원", icon: <RotateCcw className="w-4 h-4" />, act: { action: "restore" } },
            { key: "delete", label: "영구삭제", icon: <Trash2 className="w-4 h-4" />, act: { action: "delete" }, danger: true },
          ]
        : folder === "archive" || folder === "spam"
          ? [
              { key: "inbox", label: "받은편지함", icon: <Inbox className="w-4 h-4" />, act: { action: "move", target: "inbox" } },
              { key: "trash", label: "삭제", icon: <Trash2 className="w-4 h-4" />, act: { action: "trash" }, danger: true },
            ]
          : [{ key: "trash", label: "삭제", icon: <Trash2 className="w-4 h-4" />, act: { action: "trash" }, danger: true }];

  return (
    <div className="flex flex-col h-full border-r cd-border-c min-w-0">
      {/* 검색 + 새로고침 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b cd-border-c">
        <div className="flex items-center gap-1.5 flex-1 rounded-lg border cd-border-c px-2.5 py-1.5 min-w-0">
          <Search className="w-3.5 h-3.5 cd-text-faint shrink-0" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch(qInput)}
            placeholder="메일 검색(제목·발신·본문)"
            className="flex-1 bg-transparent outline-none text-sm cd-text placeholder:cd-text-faint min-w-0"
          />
          {q && (
            <button
              onClick={() => {
                setQInput("");
                onSearch("");
              }}
              className="cd-text-faint hover:opacity-70"
              aria-label="검색 지우기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <CdIconButton label="새로고침" size="sm" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4" />
        </CdIconButton>
      </div>

      {/* 일괄 액션 툴바(드래프트 폴더 제외) */}
      {!isDrafts && (
        <div className="flex items-center gap-0.5 px-3 py-1.5 border-b cd-border-c text-xs">
          <CdCheckbox checked={selected.size > 0 && selected.size === items.length} onChange={toggleAll} aria-label="전체 선택" />
          {selected.size > 0 ? (
            <>
              <span className="cd-text-faint ml-1 mr-2">{selected.size}건</span>
              {bulkButtons.map((b) => (
                <button
                  key={b.key}
                  onClick={() => runBulk(b.act)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
                    b.danger ? "cd-error-text hover:cd-error-bg" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                  )}
                  title={b.label}
                >
                  {b.icon}
                  <span className="hidden xl:inline">{b.label}</span>
                </button>
              ))}
            </>
          ) : (
            <span className="cd-text-faint ml-1">{loading ? "" : `${isDrafts ? drafts.length : items.length}건`}</span>
          )}
        </div>
      )}

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 cd-text-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : isDrafts ? (
          drafts.length === 0 ? (
            <CdEmptyState title="임시보관함이 비어 있습니다." description="작성 중 자동 저장된 메일이 여기에 보관됩니다." />
          ) : (
            <ul className="divide-y cd-border-c">
              {drafts.map((d) => (
                <li key={d.draftId}>
                  <button onClick={() => onOpenDraft(d)} className="w-full text-left px-3 py-2.5 flex flex-col gap-0.5 cd-row-hover">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate cd-text">{d.subject || "(제목 없음)"}</span>
                      <span className="text-[11px] cd-text-faint shrink-0">{fmtListDate(d.updatedAt)}</span>
                    </div>
                    <span className="text-xs cd-text-faint truncate">받는 사람: {d.to || "-"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : items.length === 0 ? (
          <CdEmptyState title={q ? "검색 결과가 없습니다." : "메일이 없습니다."} />
        ) : (
          <ul className="divide-y cd-border-c">
            {items.map((m) => {
              const unread = !m.isRead && folder === "inbox";
              const who = folder === "sent" ? m.toAddrs.map((a) => a.name || a.address).join(", ") : m.fromAddr ?? "-";
              return (
                <li key={m.messageId} className={cn(activeId === m.messageId && "cd-tint-primary")}>
                  <div className="flex items-start gap-2 px-3 py-2.5 cd-row-hover">
                    <span className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                      <CdCheckbox checked={selected.has(m.messageId)} onChange={() => toggleOne(m.messageId)} aria-label="선택" />
                    </span>
                    <button
                      onClick={() => onToggleStar(m.messageId, !m.isStarred)}
                      className="pt-0.5 shrink-0"
                      aria-label={m.isStarred ? "별표 해제" : "별표"}
                    >
                      <Star
                        className={cn("w-4 h-4", m.isStarred ? "fill-[var(--cd-warning)] text-[color:var(--cd-warning)]" : "cd-text-faint")}
                      />
                    </button>
                    <button onClick={() => onOpen(m.messageId)} className="flex-1 min-w-0 text-left flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("text-xs truncate", unread ? "font-bold cd-text" : "cd-text-muted")}>{who}</span>
                        <span className="text-[11px] cd-text-faint shrink-0">{fmtListDate(m.createdAt)}</span>
                      </div>
                      <span className={cn("text-sm truncate", unread ? "font-bold cd-text" : "cd-text")}>
                        {m.subject || "(제목 없음)"}
                        {m.hasAttachments && <Paperclip className="inline w-3 h-3 ml-1 cd-text-faint" />}
                      </span>
                      {m.snippet && <span className="text-xs cd-text-faint truncate">{m.snippet}</span>}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
