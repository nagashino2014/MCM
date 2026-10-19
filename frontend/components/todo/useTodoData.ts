"use client";

// 할 일 데이터 훅 — GET /api/todo/items 로드 + 낙관적 업데이트(완료·이동·부분 수정) + 실패 시 롤백·토스트.
// 폴링 없음(명시 reload 만). 설계: docs/todo-kanban-blueprint.md §15.

import { useCallback, useEffect, useRef, useState } from "react";
import { useCdToast } from "@/components/cdash";
import type { TodoApprovalEvent, TodoBoard, TodoCompleteRuleKey, TodoItem, TodoItemDetail } from "@/lib/todo/types";
import { between } from "@/lib/todo/position";
import { comparePosition } from "@/lib/todo/position";

export interface TodoQuery {
  view: "my" | "board" | "shared" | "delegated";
  boardId?: string | null;
  from?: string | null;
  to?: string | null;
  /** 완료 포함 — 보관되지 않은 완료 항목을 completed_at 내림차순으로 뒤에 붙인다(완료 목록 섹션용). */
  done?: boolean;
  /** 보관함(완료 30일 경과 자동 보관분)만. */
  archivedOnly?: boolean;
  withApproval?: boolean;
}

export const SAVE_FAIL_MESSAGE = "저장하지 못했습니다. 입력은 유지됩니다";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** API 오류 — 상태 코드·응답 본문을 함께 든다(409 complete_rules 분기용). */
export class TodoApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = "TodoApiError";
    this.status = status;
    this.data = data;
  }
}

/** 완료 조건 미충족 409 응답(lib/todo/route-errors.ts) — 모달 안내용. */
export interface CompleteRulesFailure {
  code: "complete_rules";
  message: string;
  missing: TodoCompleteRuleKey[];
  openSubtasks: number;
}

export function asCompleteRulesFailure(err: unknown): CompleteRulesFailure | null {
  if (!(err instanceof TodoApiError) || err.status !== 409 || err.data.code !== "complete_rules") return null;
  return {
    code: "complete_rules",
    message: err.message,
    missing: (Array.isArray(err.data.missing) ? err.data.missing : []) as TodoCompleteRuleKey[],
    openSubtasks: Number(err.data.openSubtasks ?? 0),
  };
}

export async function apiCall<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const data = await readJson(res);
  if (!res.ok) throw new TodoApiError((data.error as string) || `요청에 실패했습니다 (${res.status})`, res.status, data);
  return data as T;
}

/** 완료 요청 결과 — 성공({ item, next }) · 완료 조건 미충족(rules) · 그 외 실패(null, 토스트 완료). */
export type CompleteOutcome = { item: TodoItemDetail; next: TodoItem | null; rules?: undefined } | { rules: CompleteRulesFailure; item?: undefined } | null;

export interface MoveArgs {
  columnId?: string | null;
  boardId?: string | null;
  afterItemId?: string | null;
  beforeItemId?: string | null;
}

export function useTodoData(query: TodoQuery, enabled = true) {
  const { toast } = useCdToast();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [boards, setBoards] = useState<TodoBoard[]>([]);
  const [approvalEvents, setApprovalEvents] = useState<TodoApprovalEvent[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const seq = useRef(0);

  const { view, boardId, from, to, done, archivedOnly, withApproval } = query;
  const canLoad = enabled && (view !== "board" || !!boardId);

  const reload = useCallback(async () => {
    if (!canLoad) return;
    const my = ++seq.current;
    setLoading(true);
    const sp = new URLSearchParams({ view });
    if (view === "board" && boardId) sp.set("board", boardId);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (done) sp.set("done", "1");
    if (archivedOnly) sp.set("archivedOnly", "1");
    if (withApproval) sp.set("withApproval", "1");
    try {
      const data = await apiCall<{ items: TodoItem[]; boards: TodoBoard[]; approvalEvents?: TodoApprovalEvent[]; doneCount?: number }>(`/api/todo/items?${sp.toString()}`);
      if (my !== seq.current) return;
      setItems(data.items ?? []);
      setBoards(data.boards ?? []);
      setApprovalEvents(data.approvalEvents ?? []);
      setDoneCount(Number(data.doneCount ?? 0));
      setError(null);
      setLoaded(true);
    } catch (e) {
      if (my !== seq.current) return;
      setError((e as Error).message);
      toast((e as Error).message, "error");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [canLoad, view, boardId, from, to, done, archivedOnly, withApproval, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── 로컬 갱신 ──
  const upsertItem = useCallback((item: TodoItem, opts: { addIfMissing?: boolean } = {}) => {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.itemId === item.itemId);
      if (i < 0) return opts.addIfMissing === false ? prev : [...prev, item];
      const next = [...prev];
      next[i] = { ...prev[i], ...item };
      return next;
    });
  }, []);

  const removeItemLocal = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((x) => x.itemId !== itemId));
  }, []);

  const upsertBoard = useCallback((board: TodoBoard) => {
    setBoards((prev) => {
      const i = prev.findIndex((b) => b.boardId === board.boardId);
      if (i < 0) return [...prev, board];
      const next = [...prev];
      next[i] = board;
      return next;
    });
  }, []);

  // ── 완료/되돌리기(낙관적) — 완료 조건 미충족 409 는 토스트 없이 rules 로 돌려 호출측이 모달로 안내한다. ──
  const completeItem = useCallback(
    async (itemId: string, isDone: boolean, opts: { completionNote?: string | null } = {}): Promise<CompleteOutcome> => {
      const snapshot = itemsRef.current;
      setItems((prev) =>
        prev.map((x) =>
          x.itemId === itemId
            ? { ...x, status: isDone ? "done" : "todo", completedAt: isDone ? new Date().toISOString() : null, archivedAt: isDone ? x.archivedAt : null }
            : x
        )
      );
      try {
        const data = await apiCall<{ item: TodoItemDetail; next: TodoItem | null }>(`/api/todo/items/${encodeURIComponent(itemId)}/complete`, {
          method: "POST",
          body: JSON.stringify({ done: isDone, ...(opts.completionNote !== undefined ? { completionNote: opts.completionNote } : {}) }),
        });
        upsertItem(data.item);
        if (data.next) upsertItem(data.next);
        setDoneCount((n) => Math.max(0, n + (isDone ? 1 : -1)));
        return data;
      } catch (e) {
        setItems(snapshot);
        const rules = asCompleteRulesFailure(e);
        if (rules) return { rules };
        toast(`${SAVE_FAIL_MESSAGE} — ${(e as Error).message}`, "error");
        return null;
      }
    },
    [toast, upsertItem]
  );

  // ── 부분 수정(낙관적 partial 적용 → PATCH → 결과 반영) ──
  const patchItem = useCallback(
    async (itemId: string, patch: Record<string, unknown>, optimistic?: Partial<TodoItem>): Promise<TodoItemDetail | null> => {
      const snapshot = itemsRef.current;
      if (optimistic) setItems((prev) => prev.map((x) => (x.itemId === itemId ? { ...x, ...optimistic } : x)));
      try {
        const data = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(itemId)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        upsertItem(data.item);
        return data.item;
      } catch (e) {
        if (optimistic) setItems(snapshot);
        toast(`${SAVE_FAIL_MESSAGE} — ${(e as Error).message}`, "error");
        return null;
      }
    },
    [toast, upsertItem]
  );

  /**
   * 열 이동·순서 변경(칸반). 낙관적으로 columnId·position 을 계산해 반영하고 서버에는 after/before id 를 보낸다.
   * 열↔상태 매핑이 있으면 서버가 status 를 바꾸므로 optimisticStatus 로 미리 반영한다.
   */
  const moveItem = useCallback(
    async (itemId: string, move: MoveArgs, optimisticStatus?: TodoItem["status"]): Promise<TodoItemDetail | null> => {
      const cur = itemsRef.current.find((x) => x.itemId === itemId);
      if (!cur) return null;
      const targetCol = move.columnId === undefined ? cur.columnId : move.columnId;
      const targetBoard = move.boardId ?? cur.boardId;
      const siblings = itemsRef.current
        .filter((x) => x.itemId !== itemId && x.boardId === targetBoard && (x.columnId ?? null) === (targetCol ?? null))
        .sort((a, b) => comparePosition(a.position, b.position));
      let position = cur.position;
      if (move.afterItemId || move.beforeItemId) {
        const ai = move.afterItemId ? siblings.findIndex((x) => x.itemId === move.afterItemId) : -1;
        const bi = move.beforeItemId ? siblings.findIndex((x) => x.itemId === move.beforeItemId) : -1;
        const prevPos = ai >= 0 ? siblings[ai].position : bi > 0 ? siblings[bi - 1].position : null;
        const nextPos = bi >= 0 ? siblings[bi].position : ai >= 0 && ai + 1 < siblings.length ? siblings[ai + 1].position : null;
        try {
          position = between(prevPos, nextPos);
        } catch {
          position = cur.position;
        }
      } else if ((targetCol ?? null) !== (cur.columnId ?? null) || targetBoard !== cur.boardId) {
        const last = siblings[siblings.length - 1];
        try {
          position = between(last ? last.position : null, null);
        } catch {
          position = cur.position;
        }
      }
      const optimistic: Partial<TodoItem> = { columnId: targetCol ?? null, boardId: targetBoard, position };
      if (optimisticStatus) {
        optimistic.status = optimisticStatus;
        optimistic.completedAt = optimisticStatus === "done" ? cur.completedAt ?? new Date().toISOString() : null;
      }
      const body: Record<string, unknown> = {};
      if (move.boardId) body.boardId = move.boardId;
      if (move.columnId !== undefined) body.columnId = move.columnId;
      if (move.afterItemId) body.afterItemId = move.afterItemId;
      if (move.beforeItemId) body.beforeItemId = move.beforeItemId;
      return patchItem(itemId, body, optimistic);
    },
    [patchItem]
  );

  const createItem = useCallback(
    async (input: Record<string, unknown>): Promise<TodoItemDetail | null> => {
      try {
        const data = await apiCall<{ item: TodoItemDetail }>("/api/todo/items", { method: "POST", body: JSON.stringify(input) });
        if (!data.item.parentItemId) upsertItem(data.item);
        return data.item;
      } catch (e) {
        toast((e as Error).message, "error");
        return null;
      }
    },
    [toast, upsertItem]
  );

  const deleteItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      const snapshot = itemsRef.current;
      removeItemLocal(itemId);
      try {
        await apiCall(`/api/todo/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
        return true;
      } catch (e) {
        setItems(snapshot);
        toast((e as Error).message, "error");
        return false;
      }
    },
    [removeItemLocal, toast]
  );

  return {
    items,
    boards,
    approvalEvents,
    doneCount,
    loading,
    loaded,
    error,
    reload,
    setItems,
    upsertItem,
    removeItemLocal,
    upsertBoard,
    setBoards,
    completeItem,
    patchItem,
    moveItem,
    createItem,
    deleteItem,
  };
}

export type TodoData = ReturnType<typeof useTodoData>;
