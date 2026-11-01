"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * 자동완성 목록 닫기 — 목록이 열린 동안 ref 바깥을 클릭하거나, 포커스가 바깥으로 옮겨 가거나(Tab),
 * Esc 를 누르면 onDismiss 를 부른다. 결재 양식의 계약·업체 검색 목록이 다른 곳을 눌러도
 * 남아 있던 문제(2026-10-30 사내 테스트 피드백)를 공용으로 해결한다.
 */
export function useOutsideDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const outside = (target: EventTarget | null) => {
      const el = ref.current;
      return !!el && target instanceof Node && !el.contains(target);
    };
    const onPointer = (e: PointerEvent) => {
      if (outside(e.target)) cb.current();
    };
    const onFocus = (e: FocusEvent) => {
      if (outside(e.target)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, active]);
}
