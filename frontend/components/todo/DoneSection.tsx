"use client";

// 완료 목록 섹션(276, 2026-10-14) — 내 할 일·공유받음·보드 목록 맨 아래에 항상 두는 "완료 N건 · 펼치기" 접힘 묶음.
// 펼치면 최근 완료 순(서버 completed_at 내림차순) 회색 취소선 행(TodoRow — 완료 시각·완료 메모 1줄 보조), 체크를 다시 누르면 되돌리기.
// 하단 "보관함(30일 지난 완료) 보기" 링크 → ?archived=1(보관 목록만). 헤더 태그 "완료 N" 을 누르면 openRequest 가 올라 펼치고 스크롤한다.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TodoItem } from "@/lib/todo/types";
import { GroupHeader } from "./MyTodoList";
import { TodoRow, type Density } from "./TodoRow";

export interface DoneSectionProps {
  /** 완료 항목(상위 작업만). 서버가 completed_at 내림차순으로 준 순서를 그대로 쓴다. */
  items: TodoItem[];
  /** 서버 완료 건수(보관 제외). 목록보다 많을 수 있다(낙관 반영 중). */
  count: number;
  today: string;
  density: Density;
  selectedId: string | null;
  /** 헤더 "완료 N" 태그 클릭 — 값이 바뀌면 펼치고 스크롤. */
  openRequest?: number;
  onOpen: (item: TodoItem) => void;
  /** 체크 해제 = 되돌리기(done=false). */
  onComplete: (item: TodoItem, done: boolean) => void | Promise<boolean | void>;
  onShowArchive?: () => void;
}

export function DoneSection({ items, count, today, density, selectedId, openRequest = 0, onOpen, onComplete, onShowArchive }: DoneSectionProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seen.current) return;
    seen.current = openRequest;
    setOpen(true);
    window.setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }, [openRequest]);

  const n = Math.max(count, items.length);
  return (
    <div ref={ref} className="todo-rows todo-done-sec" aria-label="완료" data-empty={n === 0 ? "true" : undefined}>
      <GroupHeader
        label={`완료 ${n}건`}
        count={n}
        action={
          n > 0 ? (
            <button type="button" className="todo-tbtn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "접기" : "펼치기"}
              {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </button>
          ) : undefined
        }
      />
      {open && items.length > 0 ? (
        items.map((it) => <TodoRow key={it.itemId} item={it} today={today} density={density} selected={selectedId === it.itemId} timeCell="date" onOpen={onOpen} onComplete={onComplete} />)
      ) : (
        <div className="todo-empty">{n > 0 ? `완료 ${n}건이 접혀 있습니다. 체크를 다시 누르면 되돌릴 수 있습니다.` : "완료한 할 일이 없습니다."}</div>
      )}
      {onShowArchive && (
        <div className="todo-done-foot">
          <button type="button" className="todo-link" onClick={onShowArchive}>
            보관함(30일 지난 완료) 보기
          </button>
        </div>
      )}
    </div>
  );
}
