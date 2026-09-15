"use client";

// cdash 공통 탭 — 폴더/보기 전환(G0). 제어 컴포넌트(활성 키는 부모 state).
// variant: "underline"(페이지 섹션) | "pill"(카드 내부 필터). 카운트 뱃지 슬롯 지원.

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CdCount } from "@/components/cdash/CdBadge";

export interface CdTabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
  /** 실제 탭 패널의 id. 제공하면 aria-controls로 연결한다. */
  panelId?: string;
}

export interface CdTabsProps<K extends string = string> {
  items: CdTabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  variant?: "underline" | "pill";
  className?: string;
}

export function CdTabs<K extends string = string>({ items, active, onChange, variant = "underline", className }: CdTabsProps<K>) {
  const id = useId();
  const enabled = items.filter((item) => !item.disabled);
  const tabStop = enabled.some((item) => item.key === active) ? active : enabled[0]?.key;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: K) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !enabled.length) return;
    event.preventDefault();
    const current = enabled.findIndex((item) => item.key === key);
    const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[index];
    onChange(next.key);
    document.getElementById(`${id}-${next.key}`)?.focus();
  };
  return (
    <div className={cn("cd-tabs", className)} role="tablist" data-variant={variant}>
      {items.map((t) => (
        <button
            key={t.key}
            id={`${id}-${t.key}`}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            aria-controls={t.panelId}
            tabIndex={t.key === tabStop ? 0 : -1}
          disabled={t.disabled}
            onClick={() => onChange(t.key)}
            onKeyDown={(event) => onKeyDown(event, t.key)}
            className="cd-tab"
        >
          {t.icon}
          {t.label}
          {t.count != null && <CdCount count={t.count} />}
        </button>
      ))}
    </div>
  );
}
