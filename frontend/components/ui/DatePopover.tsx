"use client";

// 날짜 입력 공용 달력 팝오버(2026-11-11) — AutoDateInput·CdDateInput 이 함께 쓴다.
// YYYYMMDD 타이핑은 그대로 두고, 입력란 오른쪽 달력 아이콘(또는 Alt+↓)으로 달력에서 골라 넣는 길을 더한다.
// ★ 입력란을 감싸는 요소를 만들지 않는다 — 사용처마다 input 에 폭·flex 클래스를 직접 주고 있어
//   래퍼가 끼면 배치가 바뀐다. 아이콘은 input 의 배경 그림이고, 그 자리를 누르면 달력이 열린다.
// ★ 포털은 .cdash 루트 밖이라 토큰이 안 풀린다 → cdash-vars + data-theme 를 직접 붙인다(CdModal 과 같은 규칙).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { cn } from "@/lib/utils";

const ICON_ZONE = 26; // 입력란 오른쪽 끝에서 달력 아이콘이 차지하는 폭(px)
const POPOVER_WIDTH = 264;
const POPOVER_HEIGHT = 332;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// lucide calendar — 배경 그림은 currentColor 를 못 쓰므로 라이트·다크 양쪽에서 읽히는 중간 회색으로 고정한다.
const ICON_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b93a7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2v4M16 2v4'/%3E%3Crect width='18' height='18' x='3' y='4' rx='2'/%3E%3Cpath d='M3 10h18'/%3E%3C/svg%3E\")";

const pad = (n: number) => String(n).padStart(2, "0");
export const toIsoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** YYYY-MM-DD 가 실제 날짜면 [연, 월, 일], 아니면 null */
export function parseIsoDate(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? [y, mo, d] : null;
}

/** 한 달 달력 칸(일요일 시작, 6주 42칸) — 앞뒤 달 날짜로 채운다 */
export function monthCells(year: number, month: number): { iso: string; day: number; inMonth: boolean; weekday: number }[] {
  const start = new Date(year, month - 1, 1);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      iso: toIsoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()),
      day: dt.getDate(),
      inMonth: dt.getMonth() === month - 1,
      weekday: dt.getDay(),
    };
  });
}

function shiftIso(iso: string, days: number, months = 0): string {
  const [y, m, d] = parseIsoDate(iso)!;
  if (months) {
    // 달 이동은 말일을 넘지 않게 맞춘다(1월 31일 → 2월 28일)
    const last = new Date(y, m - 1 + months + 1, 0).getDate();
    const dt = new Date(y, m - 1 + months, Math.min(d, last));
    return toIsoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  const dt = new Date(y, m - 1, d + days);
  return toIsoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function todayIso(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

interface DatePopoverInputProps {
  style: CSSProperties;
  title: string;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  onClick: (event: ReactMouseEvent<HTMLInputElement>) => void;
  onMouseMove: (event: ReactMouseEvent<HTMLInputElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/**
 * 날짜 입력란에 달력 팝오버를 붙인다.
 * 반환한 `inputProps` 를 input 에 펼치고(사용처의 onClick·onKeyDown·style 은 호출 쪽에서 합친다) `popover` 를 곁에 렌더한다.
 * `enabled` 가 false 면(비활성·읽기 전용·월 입력) 아무것도 붙이지 않는다.
 */
export function useDatePopover(params: {
  inputRef: RefObject<HTMLInputElement | null>;
  /** 현재 값 — 완성된 YYYY-MM-DD 일 때만 달력이 그 날짜에서 열린다 */
  value: string;
  onPick: (iso: string) => void;
  enabled: boolean;
}): { inputProps: DatePopoverInputProps | null; popover: ReactNode } {
  const { inputRef, value, onPick, enabled } = params;
  const [open, setOpen] = useState(false);

  const inIconZone = (event: ReactMouseEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX >= rect.right - ICON_ZONE;
  };

  const close = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      if (refocus) inputRef.current?.focus();
    },
    [inputRef]
  );

  if (!enabled) return { inputProps: null, popover: null };

  const inputProps: DatePopoverInputProps = {
    style: {
      backgroundImage: ICON_URL,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 6px center",
      backgroundSize: "14px 14px",
      paddingRight: ICON_ZONE,
    },
    title: "달력에서 고르려면 오른쪽 달력 아이콘을 누르거나 Alt+↓",
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    onClick: (event) => {
      if (inIconZone(event)) setOpen((v) => !v);
    },
    onMouseMove: (event) => {
      event.currentTarget.style.cursor = inIconZone(event) ? "pointer" : "";
    },
    onKeyDown: (event) => {
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
    },
  };

  return {
    inputProps,
    popover: open ? (
      <CalendarPopover
        anchorRef={inputRef}
        value={value}
        onPick={(iso) => {
          onPick(iso);
          close(true);
        }}
        onClose={close}
      />
    ) : null,
  };
}

function CalendarPopover({
  anchorRef,
  value,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<HTMLInputElement | null>;
  value: string;
  onPick: (iso: string) => void;
  onClose: (refocus: boolean) => void;
}) {
  const { theme } = useCdashTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const selected = parseIsoDate(value) ? value : "";
  const today = todayIso();
  // 키보드 초점이 놓인 날짜 — 보이는 달도 이 날짜를 따라간다
  const [cursor, setCursor] = useState(selected || today);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [year, month] = parseIsoDate(cursor)!;

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const below = rect.bottom + 6;
    // 아래 공간이 모자라면 입력란 위로 올리고, 위아래 모두 모자라면 화면 안으로 당긴다(입력란을 덮더라도 달력이 잘리지 않게).
    // 좁은 화면에서는 좌우 8px 안으로 당긴다.
    const fitsBelow = below + POPOVER_HEIGHT <= window.innerHeight - 8;
    const above = rect.top - 6 - POPOVER_HEIGHT;
    const top = fitsBelow ? below : above >= 8 ? above : Math.max(8, window.innerHeight - POPOVER_HEIGHT - 8);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    setPos({ left, top });
  }, [anchorRef]);

  // 초점은 항상 cursor 날짜 칸에 둔다(열릴 때·화살표 이동·달 넘김)
  useEffect(() => {
    if (!pos) return;
    panelRef.current?.querySelector<HTMLButtonElement>(`button[data-iso="${cursor}"]`)?.focus({ preventScroll: true });
  }, [cursor, pos]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    };
    // 팝오버는 화면에 고정돼 있어 바탕이 구르면 입력란과 어긋난다 — 닫는다.
    // 초점 이동만으로도 scroll 이벤트가 올 수 있어, 입력란이 실제로 움직였을 때만 닫는다.
    const at = anchorRef.current?.getBoundingClientRect();
    const onScroll = () => {
      const now = anchorRef.current?.getBoundingClientRect();
      if (!at || !now || Math.abs(now.top - at.top) > 1 || Math.abs(now.left - at.left) > 1) onClose(false);
    };
    const onResize = () => onClose(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [anchorRef, onClose]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const onDay = (event.target as HTMLElement).dataset.iso != null;
    const move: Record<string, () => string> = {
      ArrowLeft: () => shiftIso(cursor, -1),
      ArrowRight: () => shiftIso(cursor, 1),
      ArrowUp: () => shiftIso(cursor, -7),
      ArrowDown: () => shiftIso(cursor, 7),
      Home: () => shiftIso(cursor, -new Date(year, month - 1, parseIsoDate(cursor)![2]).getDay()),
      End: () => shiftIso(cursor, 6 - new Date(year, month - 1, parseIsoDate(cursor)![2]).getDay()),
      PageUp: () => shiftIso(cursor, 0, event.shiftKey ? -12 : -1),
      PageDown: () => shiftIso(cursor, 0, event.shiftKey ? 12 : 1),
    };
    if (event.key === "Escape") {
      // preventDefault — 이 달력을 띄운 모달이 같은 Esc 로 함께 닫히지 않게 한다(CdModal 은 defaultPrevented 를 본다)
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (onDay && move[event.key]) {
      event.preventDefault();
      setCursor(move[event.key]());
    } else if (event.key === "Tab") {
      // 팝오버 안에서만 돈다
      const stops = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])') ?? []);
      const at = stops.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    }
  };

  if (typeof document === "undefined") return null;
  const cells = monthCells(year, month);
  const navButton = "cd-action inline-flex h-7 w-7 items-center justify-center cd-text-muted cd-row-hover";

  return createPortal(
    <div className="cdash-vars" data-theme={theme}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="fixed z-[200] border cd-border-c p-3 text-sm"
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          width: POPOVER_WIDTH,
          visibility: pos ? "visible" : "hidden",
          background: "var(--cd-card-solid)",
          borderRadius: "var(--cd-radius-control)",
          boxShadow: "var(--cd-shadow-popover)",
          color: "var(--cd-text)",
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <button type="button" className={navButton} aria-label="이전 달" onClick={() => setCursor(shiftIso(cursor, 0, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span id={titleId} className="font-semibold tabular-nums" aria-live="polite">
            {year}년 {month}월
          </span>
          <button type="button" className={navButton} aria-label="다음 달" onClick={() => setCursor(shiftIso(cursor, 0, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div role="grid" aria-labelledby={titleId}>
          <div role="row" className="grid grid-cols-7 text-center text-xs cd-text-faint">
            {WEEKDAYS.map((w, i) => (
              <span key={w} role="columnheader" className={cn("py-1", i === 0 && "text-[color:var(--cd-error)]")}>
                {w}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, week) => (
            <div key={week} role="row" className="grid grid-cols-7">
              {cells.slice(week * 7, week * 7 + 7).map((c) => {
                const isSelected = c.iso === selected;
                return (
                  <span key={c.iso} role="gridcell" aria-selected={isSelected} className="flex justify-center py-px">
                    <button
                      type="button"
                      data-iso={c.iso}
                      tabIndex={c.iso === cursor ? 0 : -1}
                      aria-label={`${c.iso}${c.iso === today ? " 오늘" : ""}`}
                      aria-current={c.iso === today ? "date" : undefined}
                      onClick={() => onPick(c.iso)}
                      className={cn(
                        "cd-action h-8 w-8 tabular-nums",
                        !isSelected && "cd-row-hover",
                        !c.inMonth && "opacity-40",
                        !isSelected && c.weekday === 0 && "text-[color:var(--cd-error)]"
                      )}
                      style={
                        isSelected
                          ? { background: "var(--cd-primary-fill, var(--cd-primary))", color: "#fff", fontWeight: 600 }
                          : c.iso === today
                            ? { boxShadow: "inset 0 0 0 1px var(--cd-primary)", fontWeight: 600 }
                            : undefined
                      }
                    >
                      {c.day}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t cd-border-c pt-2 text-xs">
          <button type="button" className="cd-action px-2 py-1 text-[color:var(--cd-primary)] cd-row-hover" onClick={() => onPick(today)}>
            오늘
          </button>
          <button type="button" className="cd-action px-2 py-1 cd-text-muted cd-row-hover" onClick={() => onClose(true)}>
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
