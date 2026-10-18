"use client";

// 할 일 상세 페이지(§25-4, /todo/[itemId]) — 드로어 본문(TodoDetailDrawer mode="page")을 2열 레이아웃으로 그린다.
// 보드·설정·세션은 목록 페이지와 같은 API 로 읽고, "목록으로"는 직전 목록(scope/view)으로 돌아간다(sessionStorage 에 마지막 목록 query 보관).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import type { TodoBoard, TodoPrefs } from "@/lib/todo/types";
import { TodoDetailDrawer } from "./TodoDetailDrawer";
import { apiCall } from "./useTodoData";
import { localToday } from "./todo-utils";
import "@/components/cdash/cdash.css";
import "./todo.css";

export const TODO_LIST_QUERY_KEY = "todo:last-list-query";

/** 목록 페이지가 저장해 둔 마지막 query(scope/view) — 상세에서 돌아갈 곳. 없으면 내 할 일 목록. */
export function todoListHref(): string {
  try {
    const q = typeof window !== "undefined" ? window.sessionStorage.getItem(TODO_LIST_QUERY_KEY) : null;
    return q ? `/todo?${q}` : "/todo?view=list";
  } catch {
    return "/todo?view=list";
  }
}

export function TodoDetailPage({ itemId }: { itemId: string }) {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const { data: session } = useSession();
  const myUserId = ((session?.user as { id?: string } | undefined)?.id as string | undefined) ?? null;
  const myName = session?.user?.name ?? null;
  const today = useMemo(() => localToday(), []);
  const [boards, setBoards] = useState<TodoBoard[]>([]);
  const [prefs, setPrefs] = useState<TodoPrefs | null>(null);

  useEffect(() => {
    let alive = true;
    apiCall<{ boards: TodoBoard[] }>("/api/todo/boards")
      .then((d) => {
        if (alive) setBoards(d.boards ?? []);
      })
      .catch(() => {});
    apiCall<{ prefs: TodoPrefs }>("/api/todo/prefs")
      .then((d) => {
        if (alive && d.prefs) setPrefs(d.prefs);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const goList = () => router.push(todoListHref());

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5" data-theme={theme}>
      <TodoDetailDrawer
        mode="page"
        itemId={itemId}
        boards={boards}
        prefs={prefs}
        myUserId={myUserId}
        myName={myName}
        myPhotoUrl={null}
        today={today}
        onClose={goList}
        onItemChanged={() => {}}
        onItemCreated={() => {}}
        onItemDeleted={goList}
        onOpenItem={(id) => router.push(`/todo/${encodeURIComponent(id)}`)}
      />
    </div>
  );
}
