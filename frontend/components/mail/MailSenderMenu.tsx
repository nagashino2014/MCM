"use client";

// 메일 목록 보낸 사람 팝업(10-21) — 주소를 누르면 메일 쓰기·주소록 추가·주소 복사·차단 + 보낸 사람으로 검색 + 메일 분류 지정.
// 메일 분류 지정 = 이 주소로 온 받은편지함 메일을 그 분류로 묶고, 이후 수신 메일도 자동 분류(lib/mail/sender-rules.ts, 마이그 305).
// 포털은 .cdash 루트 밖이라 cdash-vars + data-theme 를 직접 붙인다(CdModal 과 같은 규칙).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, Copy, FolderInput, PenSquare, Search, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { useCdToast } from "@/components/cdash/CdToast";
import type { MailCategory } from "@/lib/mail/categories";

const MENU_W = 300;

export interface MailSenderMenuState {
  address: string;
  /** 누른 요소의 화면 좌표 — 그 아래에 연다. */
  anchor: { left: number; top: number; bottom: number };
}

export function MailSenderMenu({
  state,
  categories,
  currentCategoryId,
  onClose,
  onCompose,
  onAddContact,
  onBlock,
  onSearch,
  onAssignCategory,
}: {
  state: MailSenderMenuState | null;
  categories: MailCategory[];
  /** 이 주소에 지정된 자동 분류(없으면 null). */
  currentCategoryId: string | null;
  onClose: () => void;
  onCompose: (address: string) => void;
  onAddContact: (address: string) => void;
  onBlock: (address: string) => void;
  onSearch: (address: string) => void;
  onAssignCategory: (address: string, categoryId: string | null) => void;
}) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 화면 밖으로 나가지 않게 — 아래 공간이 모자라면 위로 연다.
  useLayoutEffect(() => {
    if (!state) return;
    const h = panelRef.current?.offsetHeight ?? 360;
    const left = Math.max(8, Math.min(state.anchor.left, window.innerWidth - MENU_W - 8));
    const below = state.anchor.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, state.anchor.top - h - 6) : below;
    setPos({ left, top });
  }, [state, categories.length, currentCategoryId]);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = (e: Event) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [state, onClose]);

  if (!state || typeof document === "undefined") return null;
  const { address } = state;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast("주소를 복사했습니다.", "success");
    } catch {
      toast("주소를 복사하지 못했습니다.", "error");
    }
  };

  const quick: { key: string; label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] = [
    { key: "compose", label: "메일 쓰기", icon: <PenSquare className="w-5 h-5" />, onClick: run(() => onCompose(address)) },
    { key: "contact", label: "주소록 추가", icon: <UserPlus className="w-5 h-5" />, onClick: run(() => onAddContact(address)) },
    { key: "copy", label: "주소 복사", icon: <Copy className="w-5 h-5" />, onClick: run(() => void copy()) },
    { key: "block", label: "차단", icon: <Ban className="w-5 h-5" />, onClick: run(() => onBlock(address)), danger: true },
  ];

  return createPortal(
    <div className="cdash-vars cd-fields-white" data-theme={theme}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`${address} 메뉴`}
        className="fixed z-[110] rounded-lg border cd-border-c overflow-hidden"
        style={{
          left: pos?.left ?? state.anchor.left,
          top: pos?.top ?? state.anchor.bottom + 6,
          width: MENU_W,
          visibility: pos ? "visible" : "hidden",
          background: "var(--cd-card-solid)",
          boxShadow: "var(--cd-shadow-popover)",
        }}
      >
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-3">
          <p className="flex-1 min-w-0 text-[13px] font-bold cd-text break-all">{address}</p>
          <button type="button" onClick={onClose} className="shrink-0 p-1 cd-text-faint hover:text-[color:var(--cd-text)]" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 px-2 pb-3">
          {quick.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={q.onClick}
              className={cn(
                "flex flex-col items-center gap-1.5 py-2 text-[11px] cd-row-hover",
                q.danger ? "cd-error-text" : "cd-text-muted hover:text-[color:var(--cd-text)]"
              )}
            >
              {q.icon}
              {q.label}
            </button>
          ))}
        </div>
        <div className="border-t cd-hairline-c py-1.5">
          <button
            type="button"
            onClick={run(() => onSearch(address))}
            className="w-full text-left px-4 py-2.5 text-sm cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover flex items-center gap-2"
          >
            <Search className="w-4 h-4" /> 보낸 사람으로 검색
          </button>
        </div>
        <div className="border-t cd-hairline-c py-1.5">
          <p className="px-4 pt-1 pb-1.5 text-[11px] font-bold cd-text-faint flex items-center gap-1.5">
            <FolderInput className="w-3.5 h-3.5" /> 메일 분류 지정 <span className="font-normal">— 이후 받는 메일도 자동 분류</span>
          </p>
          {categories.length === 0 ? (
            <p className="px-4 pb-2 text-xs cd-text-faint">받은편지함 아래 [새 카테고리]로 분류를 먼저 만드세요.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {categories.map((c) => {
                const on = c.folderId === currentCategoryId;
                return (
                  <button
                    key={c.folderId}
                    type="button"
                    onClick={run(() => onAssignCategory(address, c.folderId))}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm flex items-center gap-2 cd-row-hover",
                      on ? "cd-text font-bold" : "cd-text-muted hover:text-[color:var(--cd-text)]"
                    )}
                    aria-pressed={on}
                  >
                    <Check className={cn("w-4 h-4 shrink-0", on ? "cd-text-primary" : "opacity-0")} />
                    <span className="truncate">{c.name}</span>
                  </button>
                );
              })}
              {currentCategoryId && (
                <button
                  type="button"
                  onClick={run(() => onAssignCategory(address, null))}
                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 cd-row-hover cd-text-faint hover:text-[color:var(--cd-text)]"
                >
                  <X className="w-4 h-4 shrink-0" /> 자동 분류 해제
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
