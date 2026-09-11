"use client";

// 목록 항목을 끌어 순서를 바꾸는 공용 훅(2026-09-11 사용자 요청 — 첨부파일 순서).
// 계약 상세의 대금 지급 단계 표(app/(app)/contracts/page.tsx)와 같은 HTML5 드래그 방식이라
// 별도 라이브러리를 들이지 않는다. 첨부 순서는 곧 메일 동봉 순서라 사용자가 직접 정해야 한다.

import { useState, type DragEvent } from "react";

export interface DragOrder {
  /** 행에 펼쳐 넣을 드래그 속성. */
  rowProps: (index: number) => {
    draggable: boolean;
    onDragStart: () => void;
    onDragOver: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDrop: (e: DragEvent) => void;
  };
  /** 행에 덧붙일 상태 클래스(끌는 중=흐리게, 놓을 자리=강조). */
  rowClass: (index: number) => string;
  dragging: boolean;
}

/** items 를 끌어 옮긴 새 배열을 onReorder 로 돌려준다(원본은 바꾸지 않는다). */
export function useDragOrder<T>(items: T[], onReorder: (next: T[]) => void): DragOrder {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const drop = (dropIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === dropIndex) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved);
    onReorder(next);
  };

  return {
    dragging: dragIndex !== null,
    rowProps: (index) => ({
      draggable: true,
      onDragStart: () => setDragIndex(index),
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        if (overIndex !== index) setOverIndex(index);
      },
      onDragEnd: () => {
        setDragIndex(null);
        setOverIndex(null);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        drop(index);
      },
    }),
    rowClass: (index) =>
      (dragIndex === index ? "opacity-50 " : "") +
      (overIndex === index && dragIndex !== null && dragIndex !== index ? "cd-tint-primary " : ""),
  };
}
