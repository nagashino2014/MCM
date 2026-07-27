"use client";

// 메일 3-pane 좌측 — 폴더 트리 + 안읽음 카운트 + 내 주소(G2-2/12).
// 받은편지함: 클릭 시 하단에 카테고리 드롭다운 리스트(필터·관리). 보관함: 하위에 카테고리 폴더(연동).
// 하단: 수신 확인 · 메일 설정.

import { useState } from "react";
import { Archive, ChevronDown, ChevronRight, Inbox, MailCheck, PencilLine, Plus, Send, Settings2, ShieldAlert, Trash2, Mail, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CdCount } from "@/components/cdash/CdBadge";
import type { MailFolderInfo } from "@/lib/mail/messages";
import type { MailCategory } from "@/lib/mail/categories";

const FOLDER_ICON: Record<string, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: PencilLine,
  archive: Archive,
  spam: ShieldAlert,
  trash: Trash2,
};

export function MailFolderPane({
  folders,
  categories,
  active,
  activeCategory,
  draftCount,
  address,
  onSelect,
  onSelectCategory,
  onCreateCategory,
  onDeleteCategory,
}: {
  folders: MailFolderInfo[];
  categories: MailCategory[];
  active: string;
  /** 받은편지함 카테고리 필터(폴더 id, "" = 전체). */
  activeCategory: string;
  draftCount: number;
  address: string | null;
  onSelect: (kind: string) => void;
  onSelectCategory: (folderId: string) => void;
  onCreateCategory: () => void;
  onDeleteCategory: (cat: MailCategory) => void;
}) {
  const [inboxOpen, setInboxOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(true);

  return (
    <div className="flex flex-col h-full border-r cd-border-c">
      <div className="px-3 py-3 border-b cd-border-c">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center cd-soft-primary shrink-0">
            <Mail className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold cd-text truncate">내 메일함</p>
            <p className="text-[11px] cd-text-faint truncate" title={address ?? undefined}>
              {address ?? "-"}
            </p>
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        {folders.map((f) => {
          const kind = f.systemKind ?? f.folderId;
          const Icon = (f.systemKind && FOLDER_ICON[f.systemKind]) || Inbox;
          const isActive = active === kind;
          const count = f.systemKind === "drafts" ? draftCount : f.unread;
          const isInbox = f.systemKind === "inbox";
          const isArchive = f.systemKind === "archive";
          return (
            <div key={f.folderId} className="flex flex-col gap-0.5">
              <button
                onClick={() => {
                  onSelect(kind);
                  if (isInbox) setInboxOpen((v) => !v);
                }}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive ? "cd-soft-primary font-semibold" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  {isInbox && (inboxOpen ? <ChevronDown className="w-3 h-3 opacity-50" /> : <ChevronRight className="w-3 h-3 opacity-50" />)}
                </span>
                {f.systemKind === "drafts" || f.systemKind === "trash" || f.systemKind === "sent" ? (
                  count > 0 && <span className="text-[11px] cd-text-faint">{count}</span>
                ) : (
                  <CdCount count={count} />
                )}
              </button>

              {/* 받은편지함 — 카테고리 드롭다운 리스트(필터·관리, G2-12) */}
              {isInbox && inboxOpen && (
                <div className="ml-5 flex flex-col gap-0.5 border-l cd-border-c pl-2">
                  <button
                    onClick={() => onSelectCategory("")}
                    className={cn(
                      "text-left px-2 py-1.5 rounded-md text-xs transition-colors",
                      active === "inbox" && !activeCategory ? "cd-soft-primary font-semibold" : "cd-text-faint hover:text-[color:var(--cd-text)]"
                    )}
                  >
                    전체
                  </button>
                  {categories.map((c) => (
                    <span key={c.folderId} className="flex items-center group">
                      <button
                        onClick={() => onSelectCategory(c.folderId)}
                        className={cn(
                          "flex-1 text-left px-2 py-1.5 rounded-md text-xs truncate transition-colors",
                          active === "inbox" && activeCategory === c.folderId
                            ? "cd-soft-primary font-semibold"
                            : "cd-text-faint hover:text-[color:var(--cd-text)]"
                        )}
                      >
                        {c.name}
                      </button>
                      <button
                        onClick={() => onDeleteCategory(c)}
                        className="opacity-0 group-hover:opacity-100 cd-text-faint hover:cd-error-text p-1"
                        title="카테고리 삭제"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={onCreateCategory}
                    className="text-left px-2 py-1.5 rounded-md text-xs cd-text-faint hover:text-[color:var(--cd-primary)] flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> 새 카테고리
                  </button>
                </div>
              )}

              {/* 보관함 — 카테고리 연동 하위 폴더 */}
              {isArchive && categories.length > 0 && (
                <>
                  <button
                    onClick={() => setArchiveOpen((v) => !v)}
                    className="ml-5 text-left px-2 py-0.5 text-[10px] cd-text-faint flex items-center gap-1"
                  >
                    {archiveOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} 카테고리 폴더
                  </button>
                  {archiveOpen &&
                    categories.map((c) => {
                      const key = `user:${c.folderId}`;
                      return (
                        <button
                          key={c.folderId}
                          onClick={() => onSelect(key)}
                          className={cn(
                            "ml-5 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs border-l cd-border-c pl-2 transition-colors",
                            active === key ? "cd-soft-primary font-semibold" : "cd-text-faint hover:text-[color:var(--cd-text)]"
                          )}
                        >
                          <span className="truncate">{c.name}</span>
                          {c.total > 0 && <span className="text-[10px]">{c.total}</span>}
                        </button>
                      );
                    })}
                </>
              )}
            </div>
          );
        })}

        {/* 수신 확인(G2-10) · 메일 설정(G2-12) */}
        <div className="my-1 border-t cd-border-c" />
        <button
          onClick={() => onSelect("receipts")}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            active === "receipts" ? "cd-soft-primary font-semibold" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
          )}
        >
          <MailCheck className="w-4 h-4 shrink-0" />
          <span className="truncate">수신 확인</span>
        </button>
        <button
          onClick={() => onSelect("settings")}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            active === "settings" ? "cd-soft-primary font-semibold" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
          )}
        >
          <Settings2 className="w-4 h-4 shrink-0" />
          <span className="truncate">메일 설정</span>
        </button>
      </nav>
    </div>
  );
}
