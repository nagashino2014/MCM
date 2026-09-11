"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";

export interface CdHelpProps {
  label: string;
  children: ReactNode;
}

/** 선택해서 읽는 설명. 오류·필수 조건·작업 결과는 도움말 밖에 표시한다. */
export function CdHelp({ label, children }: CdHelpProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    panel.style.maxWidth = `${Math.max(0, width - 32)}px`;
    panel.style.maxHeight = `${Math.max(0, height - 32)}px`;
    const bounds = panel.getBoundingClientRect();
    const left = Math.max(leftEdge + 16, Math.min(anchor.left, leftEdge + width - bounds.width - 16));
    const below = anchor.bottom + 8;
    const top = below + bounds.height <= topEdge + height - 16
      ? below
      : Math.max(topEdge + 16, anchor.top - bounds.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, []);

  const close = useCallback((restoreFocus = true) => {
    panelRef.current?.hidePopover();
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, position]);

  return (
    <div
      className="inline-flex shrink-0 align-middle"
      onKeyDown={(event) => {
        if (event.key === "Escape" && panelRef.current?.matches(":popover-open")) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="cd-help-trigger inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent cd-text-muted hover:bg-[color:var(--cd-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--cd-primary)]"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const panel = panelRef.current;
          if (!panel) return;
          if (panel.matches(":popover-open")) {
            close();
          } else {
            panel.showPopover();
            position();
            closeRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        <CircleHelp size={16} strokeWidth={1.65} aria-hidden="true" />
      </button>
      <div
        ref={panelRef}
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="cd-help-popover fixed m-0 w-[360px] overflow-auto rounded-lg border cd-border-c p-4 text-left text-[13px] font-normal leading-relaxed cd-text"
        style={{
          inset: "auto",
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100dvh - 32px)",
          background: "var(--cd-popover, var(--cd-card-solid))",
          boxShadow: "var(--cd-shadow-popover)",
          overflowWrap: "anywhere",
        }}
        onToggle={(event) => {
          const isOpen = event.newState === "open";
          setOpen(isOpen);
          if (!isOpen && panelRef.current?.contains(document.activeElement)) {
            triggerRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <strong id={`${id}-title`} className="pt-1 font-semibold">{label}</strong>
          <button
            ref={closeRef}
            type="button"
            aria-label="도움말 닫기"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md cd-text-muted hover:bg-[color:var(--cd-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--cd-primary)]"
            onClick={() => close()}
          >
            <X size={16} strokeWidth={1.65} aria-hidden="true" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
