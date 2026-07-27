"use client";

// cdash 공통 버튼 — cdash.css 의 .cd-btn-* 클래스를 감싸는 React 레이어(G0).
// CSS 재발명 없이 기존 클래스 조합만: 시각 정합이 기존 화면과 자동 일치한다.
// 설계: docs/groupware-ux-overhaul-blueprint.md §4.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type CdButtonVariant = "primary" | "soft" | "ghost" | "danger";
export type CdButtonSize = "md" | "sm";

export interface CdButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: CdButtonVariant;
  size?: CdButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode; // 좌측 아이콘(lucide 등)
}

const VARIANT_CLASS: Record<CdButtonVariant, string> = {
  primary: "cd-btn-primary",
  soft: "cd-btn-soft",
  ghost: "cd-btn-ghost",
  danger: "cd-btn-danger",
};

export const CdButton = forwardRef<HTMLButtonElement, CdButtonProps>(function CdButton(
  { variant = "ghost", size = "md", block, loading, icon, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "cd-btn inline-flex items-center justify-center gap-1.5",
        VARIANT_CLASS[variant],
        size === "sm" && "cd-btn-sm",
        block && "cd-btn-block",
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export interface CdIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 접근성 라벨(필수) — 아이콘만 있는 버튼이므로 반드시 지정. */
  label: string;
  size?: CdButtonSize;
  active?: boolean;
}

/** 아이콘 전용 버튼(탑바·툴바용). */
export const CdIconButton = forwardRef<HTMLButtonElement, CdIconButtonProps>(function CdIconButton(
  { label, size = "md", active, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-xl transition-colors inline-flex items-center justify-center",
        size === "sm" ? "p-1.5" : "p-2.5",
        active
          ? "cd-soft-primary"
          : "cd-text-muted hover:bg-[var(--cd-primary-soft)] hover:text-[color:var(--cd-primary)]",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
