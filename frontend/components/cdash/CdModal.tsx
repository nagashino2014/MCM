"use client";

// cdash 공통 모달/드로어 — createPortal 기반(G0).
// ★ 포털은 .cdash 루트 밖이라 토큰이 안 풀린다 → 루트에 cdash-vars + cd-fields-white + data-theme 자동 부여(CLAUDE.md 규칙 내장).
// ESC 닫기·백드롭 클릭 닫기·바디 스크롤 잠금 포함.

import { useEffect, type ReactNode } from "react";
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

function useOverlayBehavior(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);
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
  useOverlayBehavior(open, onClose);
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cdash cdash-vars cd-fields-white fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-theme={theme}
      style={{ background: "rgba(0,0,0,0.45)" }}
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn("cd-card-bg rounded-2xl border cd-border-c w-full max-h-[85vh] flex flex-col", MODAL_SIZE[size])}
        style={{ boxShadow: "var(--cd-shadow)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b cd-border-c shrink-0">
            <h2 className="text-base font-bold cd-text">{title}</h2>
            <button onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg cd-text-muted hover:cd-soft-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer != null && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t cd-border-c shrink-0">{footer}</div>
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
  useOverlayBehavior(open, onClose);
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cdash cdash-vars cd-fields-white fixed inset-0 z-[100]"
      data-theme={theme}
      style={{ background: "rgba(0,0,0,0.45)" }}
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "cd-card-bg absolute top-0 bottom-0 w-full flex flex-col border cd-border-c",
          widthClass,
          side === "right" ? "right-0 rounded-l-2xl" : "left-0 rounded-r-2xl"
        )}
        style={{ boxShadow: "var(--cd-shadow)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b cd-border-c shrink-0">
            <h2 className="text-base font-bold cd-text">{title}</h2>
            <button onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg cd-text-muted hover:cd-soft-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer != null && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t cd-border-c shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
