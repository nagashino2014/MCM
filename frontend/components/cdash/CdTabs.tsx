"use client";

// cdash 공통 탭 — 폴더/보기 전환(G0). 제어 컴포넌트(활성 키는 부모 state).
// variant: "underline"(페이지 섹션) | "pill"(카드 내부 필터). 카운트 뱃지 슬롯 지원.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CdCount } from "@/components/cdash/CdBadge";

export interface CdTabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface CdTabsProps<K extends string = string> {
  items: CdTabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  variant?: "underline" | "pill";
  className?: string;
}

export function CdTabs<K extends string = string>({ items, active, onChange, variant = "underline", className }: CdTabsProps<K>) {
  if (variant === "pill") {
    return (
      <div className={cn("flex items-center gap-1 flex-wrap", className)} role="tablist">
        {items.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            disabled={t.disabled}
            onClick={() => onChange(t.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors disabled:opacity-50",
              t.key === active ? "cd-soft-primary font-semibold" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && <CdCount count={t.count} />}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-0.5 border-b cd-border-c", className)} role="tablist">
      {items.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          disabled={t.disabled}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative px-4 py-2.5 text-sm flex items-center gap-1.5 transition-colors -mb-px disabled:opacity-50",
            t.key === active
              ? "font-semibold text-[color:var(--cd-primary)] border-b-2 border-[color:var(--cd-primary)]"
              : "cd-text-muted hover:text-[color:var(--cd-text)] border-b-2 border-transparent"
          )}
        >
          {t.icon}
          {t.label}
          {t.count != null && <CdCount count={t.count} />}
        </button>
      ))}
    </div>
  );
}
