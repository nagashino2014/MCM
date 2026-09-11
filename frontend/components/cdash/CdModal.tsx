"use client";

// cdash 공통 모달/드로어 — createPortal 기반(G0).
// ★ 포털은 .cdash 루트 밖이라 토큰이 안 풀린다 → 루트에 cdash-vars + cd-fields-white + data-theme 자동 부여(CLAUDE.md 규칙 내장).
// ESC 닫기·백드롭 클릭 닫기·바디 스크롤 잠금 포함.

import { useEffect, useId, useRef, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { cn } from "@/lib/utils";

interface OverlayBaseProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** 하단 고정 액션 영역(버튼들). */
  footer?: ReactNode;
  /** 백드롭 클릭으로 닫기(기본 true). 폼 작성 중 오닫힘 방지 시 false. */
  closeOnBackdrop?: boolean;
}

const overlayStack: HTMLElement[] = [];
let originalOverflow = "";
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useOverlayBehavior(open: boolean, onClose: () => void, panelRef: RefObject<HTMLDivElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!overlayStack.length) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    overlayStack.push(panel);
    const isTop = () => overlayStack[overlayStack.length - 1] === panel;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]'));
    const focusFirst = () => (focusables()[0] ?? panel).focus();
    const frame = requestAnimationFrame(focusFirst);
    const onKey = (event: KeyboardEvent) => {
      // 기존 화면은 별도 포털의 PDF 뷰어 등을 이 모달 위에 열 수 있다.
      if (!isTop() || event.defaultPrevented || !panel.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = focusables();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      const index = overlayStack.indexOf(panel);
      if (index >= 0) overlayStack.splice(index, 1);
      if (!overlayStack.length) document.body.style.overflow = originalOverflow;
      const remaining = overlayStack[overlayStack.length - 1];
      if (previousFocus?.isConnected && (!remaining || remaining.contains(previousFocus))) previousFocus.focus();
    };
  }, [open, panelRef]);
}

export interface CdModalProps extends OverlayBaseProps {
  /** 최대 폭 preset. */
  size?: "sm" | "md" | "lg" | "xl";
}

const MODAL_SIZE: Record<NonNullable<CdModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function CdModal({ open, onClose, title, children, footer, size = "md", closeOnBackdrop = true }: CdModalProps) {
  const { theme } = useCdashTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayBehavior(open, onClose, panelRef);
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-theme={theme}
      style={{ background: "var(--cd-overlay)" }}
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-labelledby={title != null ? titleId : undefined}
        aria-label={title == null ? "대화상자" : undefined}
        role="dialog"
        aria-modal="true"
        // 모달 본체는 스크림 위에 뜨므로 반드시 불투명(--cd-card-solid).
        // 글라스 토큰(--cd-card)을 쓰면 뒤 화면이 그대로 비쳐 읽을 수 없다.
        className={cn("rounded-lg border cd-border-c w-full max-h-[85vh] flex flex-col", MODAL_SIZE[size])}
        style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow-dialog)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b cd-border-c shrink-0">
            <h2 id={titleId} className="text-base font-semibold cd-text">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center cd-text-muted hover:cd-soft-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer != null && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5 border-t cd-border-c shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}

export interface CdDrawerProps extends OverlayBaseProps {
  /** 열리는 방향(기본 right). */
  side?: "right" | "left";
  /** 폭(px 기준 tailwind width 클래스 지정, 기본 max-w-xl). */
  widthClass?: string;
}

/** 사이드 드로어 — 상세 패널·필터 패널용. */
export function CdDrawer({ open, onClose, title, children, footer, side = "right", widthClass = "max-w-xl", closeOnBackdrop = true }: CdDrawerProps) {
  const { theme } = useCdashTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayBehavior(open, onClose, panelRef);
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[100]"
      data-theme={theme}
      style={{ background: "var(--cd-overlay)" }}
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-labelledby={title != null ? titleId : undefined}
        aria-label={title == null ? "대화상자" : undefined}
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute top-0 bottom-0 w-full flex flex-col border cd-border-c",
          widthClass,
          side === "right" ? "right-0" : "left-0"
        )}
        // 드로어도 스크림 위에 뜨므로 불투명 배경(위 CdModal 과 같은 이유).
        style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow-sheet)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b cd-border-c shrink-0">
            <h2 id={titleId} className="text-base font-semibold cd-text">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center cd-text-muted hover:cd-soft-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer != null && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5 border-t cd-border-c shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
