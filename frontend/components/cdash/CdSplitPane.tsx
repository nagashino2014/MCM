"use client";

// cdash 공통 스플릿 페인 — 드래그 리사이즈 2분할(G0). 메일 3-pane 은 이걸 중첩해 구성.
// 좌(또는 상) 페인 폭을 px 로 제어, localStorage 키 지정 시 폭 기억. 최소/최대 제한.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CdSplitPaneProps {
  /** 첫 번째(좌측) 페인. */
  first: ReactNode;
  /** 두 번째(우측) 페인 — 남는 공간 전부. */
  second: ReactNode;
  defaultSize?: number; // px
  minSize?: number;
  maxSize?: number;
  /** 폭 기억 localStorage 키(선택). */
  storageKey?: string;
  /** 좁은 화면에서 first 를 숨기고 second 만(반응형은 부모가 제어). */
  hideFirst?: boolean;
  className?: string;
}

export function CdSplitPane({
  first,
  second,
  defaultSize = 280,
  minSize = 180,
  maxSize = 560,
  storageKey,
  hideFirst,
  className,
}: CdSplitPaneProps) {
  const [size, setSize] = useState(defaultSize);
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 저장된 폭 복원(클라이언트 전용).
  useEffect(() => {
    if (!storageKey) return;
    const saved = Number(localStorage.getItem(storageKey));
    if (saved && saved >= minSize && saved <= maxSize) setSize(saved);
  }, [storageKey, minSize, maxSize]);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const next = Math.min(Math.max(e.clientX - rect.left, minSize), maxSize);
      setSize(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) {
        setSize((s) => {
          localStorage.setItem(storageKey, String(s));
          return s;
        });
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [minSize, maxSize, storageKey]);

  return (
    <div ref={rootRef} className={cn("flex min-h-0 min-w-0 h-full", className)}>
      {!hideFirst && (
        <>
          <div style={{ width: size }} className="shrink-0 min-h-0 overflow-hidden flex flex-col">
            {first}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onMouseDown}
            className="w-1 shrink-0 cursor-col-resize transition-colors hover:bg-[var(--cd-primary-soft)]"
          />
        </>
      )}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">{second}</div>
    </div>
  );
}
