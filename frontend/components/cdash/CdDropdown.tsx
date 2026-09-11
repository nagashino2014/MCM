"use client";

// cdash 공통 드롭다운 메뉴 — 트리거 + 항목 리스트(G0). 탑바 "+새로 작성"·행 액션 메뉴용.
// 외부 클릭/ESC 닫기. 인라인 렌더(포털 아님 — 트리거 기준 절대배치)라 cdash 스코프 안에서 토큰 상속.

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const openAtEnd = useRef(false);
  const renderedTrigger = trigger(open);
  const nativeButton = isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(renderedTrigger) && renderedTrigger.type === "button";
  const focusTrigger = () => (nativeButton ? triggerRef.current?.querySelector("button") : triggerRef.current)?.focus();
  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
  const triggerKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (!nativeButton && event.target !== event.currentTarget)) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key) || (!nativeButton && ["Enter", " "].includes(event.key))) {
      event.preventDefault();
      openAtEnd.current = event.key === "ArrowUp";
      setOpen(true);
    }
  };
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = menuItems();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && buttons.length) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setOpen(false); focusTrigger();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const triggerElement = nativeButton ? triggerRef.current?.querySelector("button") : triggerRef.current;
      const stops = Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
        .filter((el) => !menuRef.current?.contains(el) && el.getClientRects().length > 0);
      const at = stops.indexOf(triggerElement as HTMLElement);
      setOpen(false);
      (stops[at + (event.shiftKey ? -1 : 1)] ?? triggerElement)?.focus();
    }
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const buttons = menuItems();
      (openAtEnd.current ? buttons[buttons.length - 1] : buttons[0])?.focus();
      openAtEnd.current = false;
    });
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); setOpen(false); focusTrigger(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <div
        ref={triggerRef}
        role={nativeButton ? undefined : "button"}
        tabIndex={nativeButton ? undefined : 0}
        aria-haspopup={nativeButton ? undefined : "menu"}
        aria-expanded={nativeButton ? undefined : open}
        aria-controls={nativeButton || !open ? undefined : menuId}
        onKeyDown={nativeButton ? undefined : triggerKey}
        onClick={(event) => {
          if (event.defaultPrevented || (nativeButton && renderedTrigger.props.disabled)) return;
          setOpen((value) => !value);
        }}
        className="cd-action inline-flex rounded-md"
      >
        {nativeButton ? cloneElement(renderedTrigger, {
          type: renderedTrigger.props.type ?? "button",
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? menuId : undefined,
          onKeyDown: (event) => { renderedTrigger.props.onKeyDown?.(event); triggerKey(event); },
        }) : renderedTrigger}
      </div>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          onKeyDown={onMenuKey}
          className={cn(
            // 항목이 많은 메뉴(지역·업종 등)가 잘리지 않도록 스크롤. 배경은 불투명(글라스 위 겹침 방지).
            "absolute top-[calc(100%+6px)] z-50 rounded-lg overflow-y-auto max-h-[min(320px,60dvh)] max-w-[calc(100vw-32px)] py-1.5 border cd-border-c",
            menuWidthClass,
            align === "right" ? "right-0" : "left-0"
          )}
          style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow-popover)" }}
          role="menu"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                focusTrigger();
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
