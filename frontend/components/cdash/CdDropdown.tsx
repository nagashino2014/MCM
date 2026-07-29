"use client";

// cdash 공통 드롭다운 메뉴 — 트리거 + 항목 리스트(G0). 탑바 "+새로 작성"·행 액션 메뉴용.
// 외부 클릭/ESC 닫기. 인라인 렌더(포털 아님 — 트리거 기준 절대배치)라 cdash 스코프 안에서 토큰 상속.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CdMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface CdDropdownProps {
  /** 트리거 렌더러 — open 상태를 받아 버튼을 반환. */
  trigger: (open: boolean) => ReactNode;
  items: CdMenuItem[];
  align?: "left" | "right";
  className?: string;
  menuWidthClass?: string;
}

export function CdDropdown({ trigger, items, align = "right", className, menuWidthClass = "w-48" }: CdDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <div onClick={() => setOpen((v) => !v)} className="inline-flex">
        {trigger(open)}
      </div>
      {open && (
        <div
          className={cn(
            // 항목이 많은 메뉴(지역·업종 등)가 잘리지 않도록 스크롤. 배경은 불투명(글라스 위 겹침 방지).
            "absolute top-[calc(100%+6px)] z-50 rounded-xl overflow-y-auto max-h-[320px] py-1.5 border cd-border-c",
            menuWidthClass,
            align === "right" ? "right-0" : "left-0"
          )}
          style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow)" }}
          role="menu"
        >
          {items.map((it) => (
            <button
              key={it.key}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cn(
                "w-full text-left px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50",
                it.danger ? "cd-error-text hover:cd-error-bg" : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
