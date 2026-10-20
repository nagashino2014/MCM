"use client";

// 공유받음(view=shared, 시안 v4) — 열 머리글 + 그룹 헤더("나에게 배정" · "참조" · 보드별) + 행(TodoRow 재사용, 예정 열은 M/D).
// 완료(2026-10-14): 완료 항목은 그룹에 넣지 않고 맨 아래 DoneSection("완료 N건 · 펼치기")에 모은다. 유예 행(justDoneIds)은 상위가 status 를 원복해 넘긴다.

import { useMemo } from "react";
import { Users } from "lucide-react";
import { CdEmptyState } from "@/components/cdash";
import type { TodoBoard, TodoItem } from "@/lib/todo/types";
import { TodoColumnHeader, TodoRow, type Density } from "./TodoRow";
import { GroupHeader, rowListKeyNav, type DoneListProps } from "./MyTodoList";
import { DoneSection } from "./DoneSection";
import { compareInSection } from "./todo-utils";

export interface SharedListProps extends DoneListProps {
  items: TodoItem[];
  boards: TodoBoard[];
  myUserId: string | null;
  today: string;
  density: Density;
  selectedId: string | null;
  loaded: boolean;
  onOpen: (item: TodoItem) => void;
  onComplete: (item: TodoItem, done: boolean) => void | Promise<boolean | void>;
}

export function SharedList({ items, boards, myUserId, today, density, selectedId, loaded, doneCount, doneOpenRequest, justDoneIds, onUndo, onSettled, onShowArchive, onOpen, onComplete }: SharedListProps) {
  const groups = useMemo(() => {
    const assigned: TodoItem[] = [];
    const watched: TodoItem[] = [];
    const byBoard = new Map<string, TodoItem[]>();
    const done: TodoItem[] = [];
    for (const it of items) {
      if (it.parentItemId) continue;
      if (it.status === "done") {
        done.push(it);
        continue;
      }
      const board = boards.find((b) => b.boardId === it.boardId);
      if (myUserId && it.assigneeUserId === myUserId) assigned.push(it);
      else if (board && board.kind !== "personal") {
        if (!byBoard.has(it.boardId)) byBoard.set(it.boardId, []);
        byBoard.get(it.boardId)!.push(it);
      } else watched.push(it);
    }
    assigned.sort(compareInSection);
    watched.sort(compareInSection);
    for (const l of byBoard.values()) l.sort(compareInSection);
    return { assigned, watched, byBoard, done };
  }, [items, boards, myUserId]);

  const total = groups.assigned.length + groups.watched.length + Array.from(groups.byBoard.values()).reduce((n, l) => n + l.length, 0);
  const doneSection = (
    <DoneSection items={groups.done} count={doneCount} today={today} density={density} selectedId={selectedId} openRequest={doneOpenRequest} onOpen={onOpen} onComplete={onComplete} onShowArchive={onShowArchive} />
  );

  if (loaded && total === 0) {
    return (
      <div className="todo-canvas-body" data-layout="groups" onKeyDown={rowListKeyNav}>
        <CdEmptyState icon={<Users className="w-6 h-6" />} title="공유받은 할 일이 없습니다" description="다른 사람이 나를 담당·참조로 지정하거나, 내가 멤버인 보드에 할 일이 생기면 여기에 보입니다." />
        {doneSection}
      </div>
    );
  }

  const section = (key: string, title: string, list: TodoItem[], trailing?: (it: TodoItem) => string | null) => {
    if (!list.length) return null;
    return (
      <div key={key} className="todo-rows" aria-label={title}>
        <GroupHeader label={title} count={list.length} />
        {list.map((it) => (
          <TodoRow
            key={it.itemId}
            item={it}
            today={today}
            density={density}
            selected={selectedId === it.itemId}
            timeCell="date"
            trailing={trailing?.(it) ?? undefined}
            justDone={justDoneIds?.has(it.itemId)}
            onOpen={onOpen}
            onComplete={onComplete}
            onUndo={onUndo}
            onSettled={onSettled}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="todo-canvas-body" data-layout="groups" onKeyDown={rowListKeyNav}>
      <TodoColumnHeader />
      {section("assigned", "나에게 배정", groups.assigned, (it) => (it.ownerName ? `${it.ownerName} 요청` : null))}
      {section("watched", "참조", groups.watched, (it) => (it.ownerName ? `${it.ownerName} 공유` : null))}
      {Array.from(groups.byBoard.entries()).map(([boardId, list]) => {
        const b = boards.find((x) => x.boardId === boardId);
        return section(`board-${boardId}`, b ? (b.projectName ?? b.name) : "보드", list, (it) => it.ownerName ?? null);
      })}
      {doneSection}
    </div>
  );
}
