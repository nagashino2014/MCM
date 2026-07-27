"use client";

// 메일 3-pane 좌측 — 폴더 트리 + 안읽음 카운트 + 내 주소(G2-2).
// 시스템 폴더 아이콘 고정 매핑. 사용자 라벨은 후속(P3+).

import { Archive, Inbox, MailCheck, PencilLine, Send, ShieldAlert, Trash2, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CdCount } from "@/components/cdash/CdBadge";
import type { MailFolderInfo } from "@/lib/mail/messages";

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
  active,
  draftCount,
  address,
  onSelect,
}: {
  folders: MailFolderInfo[];
  active: string;
  draftCount: number;
  address: string | null;
  onSelect: (kind: string) => void;
}) {
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
          return (
            <button
              key={f.folderId}
              onClick={() => onSelect(kind)}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive ? "cd-soft-primary font-semibold" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{f.name}</span>
              </span>
              {f.systemKind === "drafts" || f.systemKind === "trash" || f.systemKind === "sent" ? (
                count > 0 && <span className="text-[11px] cd-text-faint">{count}</span>
              ) : (
                <CdCount count={count} />
              )}
            </button>
          );
        })}

        {/* 수신 확인(G2-10) — 보낸 메일의 수신처별 열람 현황 */}
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
      </nav>
    </div>
  );
}
