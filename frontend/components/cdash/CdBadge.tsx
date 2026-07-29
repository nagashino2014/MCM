"use client";

// cdash 공통 뱃지/카운트 — cdash.css .cd-pill-* 재사용(G0).
// CdBadge: 상태 라벨(승인/반려/진행 등). CdCount: 숫자 카운트(안읽음·미결재, 사이드바/탭용).

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CdBadgeTone = "idle" | "info" | "success" | "warn" | "error" | "secondary" | "outline";

const TONE_CLASS: Record<CdBadgeTone, string> = {
  idle: "cd-pill-idle",
  info: "cd-pill-info",
  success: "cd-success-bg cd-success-text",
  warn: "cd-warn-bg cd-warn-text",
  error: "cd-error-bg cd-error-text",
  secondary: "cd-pill-secondary",
  outline: "cd-pill-outline",
};

export interface CdBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: CdBadgeTone;
  icon?: ReactNode;
}

export function CdBadge({ tone = "idle", icon, className, children, ...rest }: CdBadgeProps) {
  return (
    <span className={cn("cd-pill inline-flex items-center gap-1", TONE_CLASS[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}

export interface CdCountProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  /** 99 초과 시 "99+" 표기(기본 99). */
  max?: number;
  tone?: "primary" | "error";
}

/** 숫자 카운트 뱃지 — 0 이면 렌더하지 않는다(사이드바·탭 안읽음 표시용).
 *  primary 톤은 그라데이션 원형(Soft Glass Ink 뱃지 규정). */
export function CdCount({ count, max = 99, tone = "primary", className, ...rest }: CdCountProps) {
  if (!count || count <= 0) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-extrabold leading-none",
        tone === "primary" && "cd-grad-fill",
        className
      )}
      style={tone === "error" ? { background: "var(--cd-error)", color: "#fff" } : undefined}
      {...rest}
    >
      {text}
    </span>
  );
}
