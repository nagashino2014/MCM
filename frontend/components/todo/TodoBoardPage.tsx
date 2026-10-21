"use client";

// /todo 페이지 컨테이너(시안 v4, §19) — CdPageHeader(제목 아래 태그 버튼 4개: 오늘·지연·이번 주·공유받음 = 필터) + 흰 캔버스 카드 하나.
// 캔버스 상단 바(54px): 좌측 범위 탭(CdTabs underline: 내 할 일 | 공유받음 | 프로젝트 ▾ — 프로젝트는 CdDropdown 으로 보드 목록 + "+ 새 프로젝트 보드")
//   / 우측 필터(결재 일정 · 담당자 ▾) + 보기 세그먼트(목록·보드·캘린더). 캘린더 보기는 /calendar?tags=todo 로 이동.
// URL: ?scope=my|shared|board:<id>&view=list|board&item=&new=1&archived=1 (구 ?tab=my|board|calendar|shared&board= 호환). 상세 드로어는 ?item= 로 연다.
// 데이터는 useTodoData 인스턴스 3개(my·shared 상시, board 는 보드 범위/보드 보기일 때) + 보관함(archived=1 일 때).
// 완료(2026-10-14 보완): "완료 숨김/표시" 토글을 없애고 목록마다 맨 아래 완료 섹션(완료 N건 · 펼치기)을 둔다. 헤더 태그 "완료 N" 은 그 섹션을 펼친다.
//   체크 → 완료 조건(completeRules)이 있으면 CompleteConfirmModal 먼저(서버 409 도 같은 모달) → 성공 시 2초 동안 행이 "완료됨 · 되돌리기"로 남고(justDone) 완료 섹션으로 이동.
//   완료 행 체크 해제·토스트·상세의 "되돌리기" = done=false. 보관함(?archived=1)은 30일 지난 완료만 보이고 거기서도 되돌릴 수 있다.

import "@/components/cdash/cdash.css";
import { CdHelp } from "@/components/cdash/CdHelp";
import "./todo.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AlignHorizontalDistributeStart, ArrowLeft, Calendar, Check, ChevronDown, Kanban, List, Plus, Settings2, Trash2 } from "lucide-react";
import { CdButton, CdDropdown, CdEmptyState, CdPageHeader, CdTabs, useCdToast, useCdashTheme, type CdMenuItem } from "@/components/cdash";
import { DEFAULT_TODO_PREFS, type TodoBoard, type TodoBoardMember, type TodoItem, type TodoItemDetail, type TodoPrefs, type TodoStatus } from "@/lib/todo/types";
import { hasAnyCompleteRule } from "@/lib/todo/completion";
import { useTodoData, apiCall, type CompleteRulesFailure } from "./useTodoData";
import { GroupHeader, MyTodoList, rowListKeyNav, type QuickFilter } from "./MyTodoList";
import { SharedList } from "./SharedList";
import { KanbanBoard } from "./KanbanBoard";
import { TodoTimeline } from "./TodoTimeline";
import { TodoPrefsModal } from "./TodoPrefsModal";
import { BoardDeleteModal } from "./BoardDeleteModal";
import { TodoDetailDrawer, type TodoDraftInit } from "./TodoDetailDrawer";
import { BoardCreateModal } from "./BoardCreateModal";
import { BoardMembersModal } from "./BoardMembersModal";
import { CompleteConfirmModal, type CompleteConfirmTarget } from "./CompleteConfirmModal";
import { TodoColumnHeader, TodoRow, tintStyle } from "./TodoRow";
import { effectiveDate, localToday, weekEnd, type SortMode } from "./todo-utils";

type ScopeKind = "my" | "shared" | "delegated" | "board";
type ScopeTab = "my" | "shared" | "delegated" | "none";
type View = "list" | "board" | "timeline";
const SORT_LABELS: Record<SortMode, string> = { manual: "수동", date: "날짜순", priority: "우선순위순" };

type TodoSource = ReturnType<typeof useTodoData>;
/** 완료 확인 모달 상태 — 모달이 닫힐 때 resolve(성공 여부)로 행·카드에 결과를 돌려준다. */
interface ConfirmState {
  target: CompleteConfirmTarget;
  source: TodoSource;
  failure: CompleteRulesFailure | null;
  /** 유예(2초 "완료됨 · 되돌리기") 적용 여부 — 목록 행만 true, 칸반 카드는 열이 바로 바뀌므로 false. */
  grace: boolean;
  resolve: (ok: boolean) => void;
}

const isTypingTarget = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

/** URL → 범위·보기 (구 ?tab= 호환). archived=1 은 보관함(30일 지난 완료) 보기. */
function parseScope(sp: URLSearchParams): { kind: ScopeKind; boardId: string | null; view: View; calendar: boolean; archived: boolean } {
  const scope = sp.get("scope");
  const viewRaw = sp.get("view");
  const tab = sp.get("tab");
  const archived = sp.get("archived") === "1";
  let kind: ScopeKind = "my";
  let boardId: string | null = null;
  let view: View = viewRaw === "board" ? "board" : viewRaw === "timeline" ? "timeline" : "list";
  let calendar = viewRaw === "calendar";
  if (scope === "shared") kind = "shared";
  else if (scope === "delegated") kind = "delegated";
  else if (scope?.startsWith("board:")) {
    kind = "board";
    boardId = scope.slice(6) || null;
  } else if (!scope && tab) {
    if (tab === "shared") kind = "shared";
    else if (tab === "board") {
      const b = sp.get("board");
      if (b) {
        kind = "board";
        boardId = b;
      }
      view = "board";
    } else if (tab === "calendar") calendar = true;
  }
  if (kind === "shared" || kind === "delegated") view = "list";
  return { kind, boardId, view, calendar, archived };
}

export function TodoBoardPage() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const sp = useSearchParams();
  const { data: session } = useSession();
  const myUserId = ((session?.user as { id?: string } | undefined)?.id as string | undefined) ?? null;
  const myName = session?.user?.name ?? null;

  const parsed = useMemo(() => parseScope(new URLSearchParams(sp.toString())), [sp]);
  const itemParam = sp.get("item");
  // ?item= 직접 진입 시 서버(드로어 없음)와 클라이언트(포털 드로어) 첫 렌더가 달라 hydration 오류 → 마운트 뒤에만 드로어를 그린다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const newParam = sp.get("new");

  const [prefs, setPrefs] = useState<TodoPrefs | null>(null);
  // §29-3 2차 설정 모달(알림·표시)
  const [prefsOpen, setPrefsOpen] = useState(false);
  // 보드 삭제 확인(2026-10-20) — 만든 사람만, 개인 기본 보드 제외
  const [deleteBoardTarget, setDeleteBoardTarget] = useState<TodoBoard | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("date");
  // 완료 유예(2초) 중인 행 — id → 완료 전 상태(목록에는 그 상태로 되돌려 넘겨 원래 섹션에 남긴다).
  const [justDone, setJustDone] = useState<Map<string, TodoStatus>>(() => new Map());
  const [doneOpenRequest, setDoneOpenRequest] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [membersVersion, setMembersVersion] = useState(0);
  const today = useMemo(() => localToday(), []);

  // ── URL query ──
  const setQuery = useCallback(
    (patch: Partial<Record<"scope" | "view" | "item" | "new" | "archived" | "title" | "linkKind" | "linkId" | "linkLabel", string | null>>) => {
      const next = new URLSearchParams(sp.toString());
      // 구 파라미터는 새 형식으로 정리
      next.delete("tab");
      next.delete("board");
      if (!next.get("scope")) next.set("scope", parsed.kind === "board" && parsed.boardId ? `board:${parsed.boardId}` : parsed.kind);
      if (!next.get("view")) next.set("view", parsed.view);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (next.get("scope") === "my") next.delete("scope");
      if (next.get("view") === "list") next.delete("view");
      const q = next.toString();
      router.replace(q ? `/todo?${q}` : "/todo", { scroll: false });
    },
    [router, sp, parsed]
  );

  // 캘린더 보기(구 ?tab=calendar 포함)는 일정 화면으로
  useEffect(() => {
    if (parsed.calendar) router.replace("/calendar?tags=todo&from=todo");
  }, [parsed.calendar, router]);

  // ── 설정 ──
  useEffect(() => {
    apiCall<{ prefs: TodoPrefs }>("/api/todo/prefs")
      .then((d) => setPrefs(d.prefs))
      .catch(() => setPrefs({ userId: myUserId ?? "", ...DEFAULT_TODO_PREFS }));
    // myUserId 는 fallback 표시에만 쓰므로 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchPrefs = useCallback(
    async (patch: Partial<TodoPrefs>) => {
      const prev = prefs;
      setPrefs((p) => (p ? { ...p, ...patch } : p));
      try {
        const d = await apiCall<{ prefs: TodoPrefs }>("/api/todo/prefs", { method: "PATCH", body: JSON.stringify(patch) });
        setPrefs(d.prefs);
      } catch (e) {
        setPrefs(prev);
        toast(`설정을 저장하지 못했습니다 — ${(e as Error).message}`, "error");
      }
    },
    [prefs, toast]
  );

  const showApproval = prefs?.showApprovalEvents ?? true;
  const density = prefs?.cardDensity ?? "comfortable";
  const weekStart = prefs?.weekStart ?? 1;

  // ── 데이터 — 완료 항목은 항상 함께 받는다(완료 섹션·완료 N 태그). 보관함은 archived=1 일 때만. ──
  const my = useTodoData({ view: "my", done: true, withApproval: showApproval }, true);
  const shared = useTodoData({ view: "shared", done: true }, true);
  // §26-2 맡긴 일 — 내가 만들었고 담당이 남인 작업
  const delegated = useTodoData({ view: "delegated", done: true }, true);
  const boards = my.boards.length ? my.boards : shared.boards;
  const personalBoardId = boards.find((b) => b.kind === "personal" && b.isDefault)?.boardId ?? boards.find((b) => b.isDefault)?.boardId ?? boards[0]?.boardId ?? null;
  const scopeBoardId = parsed.kind === "board" && parsed.boardId && boards.some((b) => b.boardId === parsed.boardId) ? parsed.boardId : null;
  const scope: ScopeKind = parsed.kind === "board" ? (scopeBoardId || !boards.length ? "board" : "my") : parsed.kind;
  const archivedMode = parsed.archived;
  const view: View = scope === "shared" || scope === "delegated" ? "list" : parsed.view;
  // 활성 보드 — 보드 범위면 그 보드, 내 할 일의 보드 보기면 개인 보드
  const activeBoardId = scope === "board" ? scopeBoardId : view === "board" ? personalBoardId : null;
  const board = boards.find((b) => b.boardId === activeBoardId) ?? null;
  const boardData = useTodoData({ view: "board", boardId: activeBoardId, done: true, withApproval: showApproval }, !!activeBoardId);
  const archive = useTodoData({ view: scope, boardId: scope === "board" ? activeBoardId : null, archivedOnly: true }, archivedMode);

  useEffect(() => {
    setAssigneeFilter(null);
  }, [activeBoardId]);

  // 유예 중인 행은 완료 전 상태로 되돌려 넘긴다(원래 섹션에 "완료됨 · 되돌리기"로 남도록).
  const withGrace = useCallback(
    (items: TodoItem[]) => (justDone.size ? items.map((i) => (justDone.has(i.itemId) ? { ...i, status: justDone.get(i.itemId)! } : i)) : items),
    [justDone]
  );
  const justDoneIds = useMemo(() => new Set(justDone.keys()), [justDone]);
  const myItems = useMemo(() => withGrace(my.items), [my.items, withGrace]);
  const sharedItems = useMemo(() => withGrace(shared.items), [shared.items, withGrace]);
  const delegatedItems = useMemo(() => withGrace(delegated.items), [delegated.items, withGrace]);
  // 상세 드로어 댓글 입력란의 내 아바타 사진 — 새 API 없이 목록 응답의 owner/assignee 사진 맵에서 내 userId 와 같은 것을 찾는다.
  const myPhotoUrl = useMemo(() => {
    if (!myUserId) return null;
    for (const it of [...my.items, ...shared.items, ...boardData.items]) {
      if (it.ownerUserId === myUserId && it.ownerPhotoUrl) return it.ownerPhotoUrl;
      if (it.assigneeUserId === myUserId && it.assigneePhotoUrl) return it.assigneePhotoUrl;
    }
    return null;
  }, [my.items, shared.items, boardData.items, myUserId]);
  const boardItems = useMemo(() => {
    const list = withGrace(boardData.items);
    if (!assigneeFilter) return list;
    return list.filter((i) => (assigneeFilter === "__none__" ? !i.assigneeUserId : i.assigneeUserId === assigneeFilter));
  }, [boardData.items, withGrace, assigneeFilter]);
  const doneCount = scope === "my" ? my.doneCount : scope === "shared" ? shared.doneCount : scope === "delegated" ? delegated.doneCount : boardData.doneCount;

  // ── 통계(태그 버튼 건수) ──
  const stats = useMemo(() => {
    const we = weekEnd(today, weekStart);
    let overdue = 0;
    let td = 0;
    let week = 0;
    for (const it of my.items) {
      if (it.parentItemId || it.status === "done") continue;
      const d = effectiveDate(it);
      if (!d) continue;
      if (d < today) overdue++;
      else if (d === today) td++;
      if (d >= today && d <= we) week++;
    }
    return { overdue, today: td, week, shared: shared.items.filter((i) => !i.parentItemId && i.status !== "done").length, done: doneCount };
  }, [my.items, shared.items, today, weekStart, doneCount]);

  // ── 새 할 일(2026-10-20) — [새 할 일] 버튼·?new=1(메일·메신저·탑바 프리필)은 우측 드로어의 작성 양식으로, N 키는 퀵애드(기호 입력) 그대로 ──
  // 기본 보드 = 보고 있는 프로젝트 보드 → 개인 기본 보드. 저장하면 같은 드로어가 일반 상세(?item=)로 바뀐다.
  const draftInit = useMemo<TodoDraftInit | null>(
    () =>
      newParam === "1" && !itemParam
        ? { boardId: scope === "board" ? scopeBoardId : null, title: sp.get("title"), linkKind: sp.get("linkKind"), linkId: sp.get("linkId"), linkLabel: sp.get("linkLabel") }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newParam, itemParam]
  );

  const itemParamRef = useRef(itemParam);
  itemParamRef.current = itemParam;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || itemParamRef.current) return;
      e.preventDefault();
      // 2026-10-20: 텍스트 퀵애드 줄 삭제(사용자 요청) — N 키도 새 할 일 작성 드로어로
      openNewRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openNewRef = useRef<() => void>(() => {});
  const openNew = () => {
    setQuery({ new: "1", item: null, ...(scope === "shared" || scope === "delegated" ? { scope: "my" } : {}) });
  };
  openNewRef.current = openNew;

  // ── 범위·보기 전환 ──
  const goScope = (kind: "my" | "shared" | "delegated") => {
    setQuickFilter(null);
    setQuery({ scope: kind, view: kind === "shared" || kind === "delegated" ? "list" : view });
  };
  const goBoard = (boardId: string, nextView?: View) => {
    setQuickFilter(null);
    setQuery({ scope: `board:${boardId}`, view: nextView ?? view });
  };
  const goView = (v: View | "calendar") => {
    if (v === "calendar") {
      router.push("/calendar?tags=todo&from=todo");
      return;
    }
    if (scope === "shared" && (v === "board" || v === "timeline")) return;
    setQuery({ view: v });
  };
  const toggleQuickFilter = (f: Exclude<QuickFilter, null>) => {
    const next = quickFilter === f && scope === "my" && view === "list" ? null : f;
    setQuickFilter(next);
    if (scope !== "my" || view !== "list") setQuery({ scope: "my", view: "list" });
  };

  // ── 공통 동작 ──
  // §25-4: 상세는 별도 페이지(/todo/[itemId]). 돌아올 목록 query 를 남기고 이동한다.
  const openItem = (item: TodoItem | string) => {
    const id = typeof item === "string" ? item : item.itemId;
    setQuery({ item: id, new: null, title: null, linkKind: null, linkId: null, linkLabel: null });
  };
  const closeItem = () => setQuery({ item: null, new: null, title: null, linkKind: null, linkId: null, linkLabel: null });

  const upsertAll = useCallback(
    (item: TodoItemDetail) => {
      my.upsertItem(item, { addIfMissing: false });
      shared.upsertItem(item, { addIfMissing: false });
      boardData.upsertItem(item, { addIfMissing: false });
    },
    [my, shared, boardData]
  );
  const removeAll = useCallback(
    (id: string) => {
      my.removeItemLocal(id);
      shared.removeItemLocal(id);
      boardData.removeItemLocal(id);
    },
    [my, shared, boardData]
  );
  const createdAll = useCallback(
    (item: TodoItem) => {
      if (!item.parentItemId && (item.assigneeUserId ?? item.ownerUserId) === myUserId) my.upsertItem(item);
      if (!item.parentItemId && item.boardId === activeBoardId) boardData.upsertItem(item);
    },
    [my, boardData, activeBoardId, myUserId]
  );

  // ── 완료 흐름(2026-10-14) ──
  const graceDrop = useCallback((itemId: string) => {
    setJustDone((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  /** 되돌리기(done=false) — 유예 취소 + 서버. 보관함에서 되돌리면 보관도 풀리므로 목록들을 다시 읽는다. */
  const reopenIn = useCallback(
    (source: TodoSource) => async (item: TodoItem): Promise<boolean> => {
      graceDrop(item.itemId);
      const res = await source.completeItem(item.itemId, false);
      if (!res || !res.item) return false;
      upsertAll(res.item);
      if (source === archive) {
        void my.reload();
        void shared.reload();
        void boardData.reload();
      }
      return true;
    },
    [graceDrop, upsertAll, archive, my, shared, boardData]
  );

  /** 완료 성공 뒤 — 목록 갱신 + 유예 등록(grace) + "완료 · 되돌리기" 토스트. */
  const afterComplete = useCallback(
    (source: TodoSource, item: TodoItem, res: { item: TodoItemDetail; next: TodoItem | null }, grace: boolean) => {
      upsertAll(res.item);
      if (res.next) createdAll(res.next);
      if (grace) setJustDone((prev) => new Map(prev).set(item.itemId, item.status === "done" ? "todo" : item.status));
      toast(
        <span className="inline-flex items-center gap-2">
          완료
          <button type="button" className="todo-tbtn" data-active="true" onClick={() => void reopenIn(source)(item)}>
            되돌리기
          </button>
        </span>,
        "success",
        5000
      );
    },
    [upsertAll, createdAll, toast, reopenIn]
  );

  /** 완료 조건이 있거나 서버가 거절했을 때 — 모달을 띄우고 결과를 Promise 로 돌려준다. */
  const openConfirm = useCallback(
    (source: TodoSource, item: TodoItem, failure: CompleteRulesFailure | null, grace: boolean) =>
      new Promise<boolean>((resolve) => {
        setConfirm({ target: item, source, failure, grace, resolve });
      }),
    []
  );

  /**
   * 체크(행·카드) → 완료/되돌리기. 완료는 규칙이 있으면 모달 먼저, 없으면 즉시 — 서버 409(code complete_rules)면 모달로 안내.
   * grace=true(목록)면 성공 뒤 2초 유예(justDone). 성공 여부를 돌려 행이 체크를 비울지 정한다.
   */
  const completeIn = useCallback(
    (source: TodoSource, grace = true) =>
      async (item: TodoItem, done: boolean): Promise<boolean> => {
        if (!done) return reopenIn(source)(item);
        if (hasAnyCompleteRule(item.completeRules)) return openConfirm(source, item, null, grace);
        const res = await source.completeItem(item.itemId, true);
        if (!res) return false;
        if (res.rules) return openConfirm(source, item, res.rules, grace);
        afterComplete(source, item, res, grace);
        return true;
      },
    [reopenIn, openConfirm, afterComplete]
  );

  const confirmComplete = async (note: string | null) => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      const res = await confirm.source.completeItem(confirm.target.itemId, true, { completionNote: note });
      if (res && res.rules) {
        setConfirm({ ...confirm, failure: res.rules });
        return;
      }
      const item = confirm.source.items.find((i) => i.itemId === confirm.target.itemId) ?? (confirm.target as unknown as TodoItem);
      if (res) afterComplete(confirm.source, item, res, confirm.grace);
      confirm.resolve(!!res);
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };
  const cancelConfirm = () => {
    if (!confirm || confirmBusy) return;
    confirm.resolve(false);
    setConfirm(null);
  };

  const showDoneList = () => {
    if (archivedMode || view === "board") setQuery({ archived: null, view: "list" });
    setDoneOpenRequest((n) => n + 1);
  };
  const showArchive = () => setQuery({ archived: "1", view: "list" });
  const doneListProps = (source: TodoSource) => ({
    doneCount: source.doneCount,
    doneOpenRequest,
    justDoneIds,
    onUndo: (item: TodoItem) => void reopenIn(source)(item),
    onSettled: (item: TodoItem) => graceDrop(item.itemId),
    onShowArchive: showArchive,
  });

  const createIn = (source: typeof my) => async (input: Record<string, unknown>) => {
    const created = await source.createItem(input);
    if (created) {
      if (source !== my) createdAll(created);
      else if (created.boardId === activeBoardId) boardData.upsertItem(created);
    }
    return created;
  };

  const onBoardUpdated = (b: TodoBoard) => {
    my.upsertBoard(b);
    shared.upsertBoard(b);
    boardData.upsertBoard(b);
  };
  const canDeleteBoard = (b: TodoBoard | null | undefined) => !!b && b.kind !== "personal" && !b.isDefault && !!myUserId && b.ownerUserId === myUserId;
  const onBoardDeleted = (boardId: string) => {
    const name = deleteBoardTarget?.projectName ?? deleteBoardTarget?.name ?? "보드";
    setDeleteBoardTarget(null);
    my.setBoards((list) => list.filter((b) => b.boardId !== boardId));
    shared.setBoards((list) => list.filter((b) => b.boardId !== boardId));
    if (scopeBoardId === boardId) goScope("my");
    void my.reload();
    toast(`'${name}' 보드를 삭제했습니다.`, "success");
  };

  const onMembersChanged = (members: TodoBoardMember[]) => {
    if (!board) return;
    onBoardUpdated({ ...board, memberCount: members.length });
    setMembersVersion((n) => n + 1);
  };

  // ── 프로젝트 탭 드롭다운(내 프로젝트 · 부서 · 공유 보드 + 새 보드) ──
  // 프로젝트 바로가기 아이콘 — ▾ 메뉴와 같은 순서(내 프로젝트 → 부서 → 공유 보드), 보관된 보드 제외
  const projectChips = useMemo(
    () => (["project", "dept", "shared"] as const).flatMap((k) => boards.filter((b) => b.kind === k && !b.archivedAt)),
    [boards]
  );
  const projectMenu: CdMenuItem[] = useMemo(() => {
    const items: CdMenuItem[] = [];
    const groups: { label: string; list: TodoBoard[] }[] = [
      { label: "내 프로젝트", list: boards.filter((b) => b.kind === "project" && !b.archivedAt) },
      { label: "부서", list: boards.filter((b) => b.kind === "dept" && !b.archivedAt) },
      { label: "공유 보드", list: boards.filter((b) => b.kind === "shared" && !b.archivedAt) },
    ];
    for (const g of groups) {
      if (!g.list.length) continue;
      items.push({ key: `h-${g.label}`, label: <span className="text-[11px] font-semibold tracking-wide cd-text-faint">{g.label}</span>, disabled: true, onSelect: () => {} });
      for (const b of g.list) {
        items.push({
          key: b.boardId,
          label: (
            <span className="inline-flex items-center gap-2 min-w-0">
              <span className="todo-scope-sq" style={tintStyle(b.colorHex)} aria-hidden="true" />
              <span className="truncate">{b.projectName ?? b.name}</span>
              {b.clientName && <span className="cd-text-faint text-[12px] truncate">{b.clientName}</span>}
              {canDeleteBoard(b) && (
                <span
                  role="button"
                  tabIndex={0}
                  className="todo-tpl-del ml-auto"
                  title="보드 삭제"
                  aria-label={`${b.projectName ?? b.name} 보드 삭제`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteBoardTarget(b);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteBoardTarget(b);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </span>
              )}
            </span>
          ),
          icon: b.boardId === scopeBoardId ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <span className="inline-block w-3.5" />,
          onSelect: () => goBoard(b.boardId),
        });
      }
    }
    items.push({ key: "new", label: "+ 새 프로젝트 보드", icon: <Plus className="w-3.5 h-3.5" aria-hidden="true" />, onSelect: () => setCreateOpen(true) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, scopeBoardId, view]);

  // ── 담당자 필터(보드 범위) ──
  const assigneeMenu: CdMenuItem[] = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of boardData.items) if (it.assigneeUserId && it.assigneeName) seen.set(it.assigneeUserId, it.assigneeName);
    const mk = (key: string | null, label: string): CdMenuItem => ({
      key: key ?? "all",
      label,
      icon: assigneeFilter === key ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <span className="inline-block w-3.5" />,
      onSelect: () => setAssigneeFilter(key),
    });
    return [mk(null, "담당자 전체"), ...Array.from(seen.entries()).map(([id, name]) => mk(id, name)), mk("__none__", "담당 없음")];
  }, [boardData.items, assigneeFilter]);
  const assigneeLabel = assigneeFilter == null ? "담당자 전체" : assigneeFilter === "__none__" ? "담당 없음" : (boardData.items.find((i) => i.assigneeUserId === assigneeFilter)?.assigneeName ?? "담당자");

  const displayMenu: CdMenuItem[] = [
    ...(["date", "priority", "manual"] as SortMode[]).map((m) => ({
      key: `sort-${m}`,
      label: `정렬 · ${SORT_LABELS[m]}`,
      icon: sortMode === m ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <span className="inline-block w-3.5" />,
      onSelect: () => setSortMode(m),
    })),
    ...(["comfortable", "compact"] as const).map((d) => ({
      key: `density-${d}`,
      label: `밀도 · ${d === "compact" ? "좁게" : "보통"}`,
      icon: density === d ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <span className="inline-block w-3.5" />,
      onSelect: () => void patchPrefs({ cardDensity: d }),
    })),
  ];

  const sharedCount = sharedItems.filter((i) => !i.parentItemId && i.status !== "done").length;
  const delegatedCount = delegatedItems.filter((i) => !i.parentItemId && i.status !== "done").length;
  // 범위 탭 개수(2026-10-20) — 미완료 상위 할 일 수를 원문자(원 안 숫자)로. 프로젝트는 선택된 프로젝트 보드 기준.
  const myCount = myItems.filter((i) => !i.parentItemId && i.status !== "done").length;
  const projectCount = scope === "board" && board && board.kind !== "personal" ? boardData.items.filter((i) => !i.parentItemId && i.status !== "done").length : null;
  const tabN = (n: number | null) => (n == null ? null : <span className="todo-tab-n" aria-label={`${n}건`}>{n}</span>);
  const scopeTab: ScopeTab = scope === "my" ? "my" : scope === "shared" ? "shared" : scope === "delegated" ? "delegated" : "none";
  const boardLabel = board ? (board.kind === "personal" ? "개인 보드" : (board.projectName ?? board.name)) : null;

  const tagButton = (tone: "today" | "over" | "week" | "shared" | "done", label: string, count: number, pressed: boolean, onClick: () => void) => (
    <button type="button" className="todo-tag" data-tone={tone} aria-pressed={pressed} onClick={onClick}>
      {label} <b>{count}</b>
    </button>
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5" data-theme={theme}>
      <div className="todo-page todo-vars flex min-h-0 flex-1 flex-col gap-4">
        <CdPageHeader
          title="할 일"
          help={
            <div className="grid gap-2 text-sm">
              <p>개인 업무·미팅·약속을 한 줄로 적어 관리합니다. 출장·휴가·교육·초과근무 같은 결재 일정은 종류 아이콘이 붙은 읽기 전용 줄로 함께 보여 주며, '문서 열기'로 결재 문서를 엽니다. 출장·초과근무는 To-do 에서 만들지 않고 전자결재에서 기안합니다.</p>
              <p>오른쪽 위 <b>새 할 일</b>을 누르면 상세와 같은 양식이 열립니다. 항목을 채우고 <b>저장</b>하면 만들어집니다.</p>
              <p>범위 탭 '프로젝트' 오른쪽 색 아이콘을 누르면 그 프로젝트 보드로 바로 갑니다. '프로젝트 ▾'에서 계약관리 용역을 골라 프로젝트 보드를 만들면 용역명·발주처·색을 할 일이 물려받고, 수행인력이 멤버로 자동 추가됩니다. 할 일은 만든 사람만 봅니다. 담당·참조로 사람을 붙이거나 프로젝트·부서 보드로 옮길 때만 상대에게 보입니다.</p>
              <p>
                완료한 할 일은 목록 맨 아래 <b>완료 N건</b> 묶음에 모이고(헤더의 '완료' 태그로 바로 펼침), 체크를 다시 누르거나 상세의 '되돌리기'로 실수 완료를 복구합니다. 완료 30일이 지나면 보관함으로 내려가며 '보관함 보기'에서 되돌릴 수 있습니다.
                상세 '부가 설정 › 완료 조건'(하위 작업 모두 완료 · 완료 메모 입력 · 검토 단계 경유 · 선행 작업 모두 완료)을 켜 두면 완료 전에 확인 창이 뜹니다. 프로젝트·부서 보드는 '기본 완료 조건'을 정해 새 할 일에 물려줍니다.
              </p>
              <p>
                키보드: <b>N</b> 새 할 일 · <b>↑/↓</b> 이동 · <b>Space</b> 완료 · <b>Enter</b> 상세 · 상세에서 <b>Alt+1~5</b> 상태 · <b>Ctrl+Enter</b> 댓글 · <b>Esc</b> 닫기.
              </p>
            </div>
          }
          subtitle={
            <div className="todo-tags" role="group" aria-label="요약 필터">
              {tagButton("today", "오늘", stats.today, scope === "my" && view === "list" && quickFilter === "today", () => toggleQuickFilter("today"))}
              {tagButton("over", "지연", stats.overdue, scope === "my" && view === "list" && quickFilter === "overdue", () => toggleQuickFilter("overdue"))}
              {tagButton("week", "이번 주", stats.week, scope === "my" && view === "list" && quickFilter === "week", () => toggleQuickFilter("week"))}
              {tagButton("shared", "공유받음", stats.shared, scope === "shared", () => (scope === "shared" ? goScope("my") : goScope("shared")))}
              {tagButton("done", "완료", stats.done, archivedMode, showDoneList)}
            </div>
          }
          actions={
            <CdButton variant="primary" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={openNew}>
              새 할 일
            </CdButton>
          }
        />

        <section className="cd-card todo-canvas" aria-label="할 일">
          <div className="todo-bar">
            <div className="todo-scope">
              <CdTabs<ScopeTab>
                variant="underline"
                active={scopeTab}
                onChange={(k) => {
                  if (k === "my" || k === "shared" || k === "delegated") goScope(k);
                }}
                items={[
                  { key: "my", label: <>내 할 일{tabN(myCount)}</> },
                  { key: "shared", label: <>공유받음{tabN(sharedCount)}</> },
                  { key: "delegated", label: <>맡긴 일{tabN(delegatedCount)}</> },
                ]}
              />
              <div className="cd-tabs" data-variant="underline" role="presentation">
                <CdDropdown
                  align="left"
                  menuWidthClass="w-80"
                  trigger={() => (
                    <button type="button" className="cd-tab" role="tab" aria-selected={scope === "board"} aria-label="프로젝트 보드 선택">
                      프로젝트
                      {tabN(projectCount)}
                      <ChevronDown className="todo-scope-caret" aria-hidden="true" />
                    </button>
                  )}
                  items={projectMenu}
                />
              </div>
              {/* 프로젝트 바로가기(2026-10-20 사용자 요청) — 보드별 색 아이콘, 마우스를 올리면 이름, 누르면 그 보드로. 만들기·삭제는 왼쪽 ▾ 메뉴. */}
              {projectChips.length > 0 && (
                <div className="todo-proj-chips" role="group" aria-label="프로젝트 바로가기">
                  {projectChips.map((b) => {
                    const name = b.projectName ?? b.name;
                    const active = scope === "board" && scopeBoardId === b.boardId;
                    return (
                      <button
                        key={b.boardId}
                        type="button"
                        className="todo-proj-chip"
                        data-tip={name}
                        aria-label={`${name} 보드 열기`}
                        aria-pressed={active}
                        onClick={() => goBoard(b.boardId)}
                      >
                        <span className="todo-proj-sq" style={tintStyle(b.colorHex)} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
              <span className="inline-flex items-center">
                <CdHelp topic="todo.scope" />
              </span>
            </div>
            <div className="todo-views">
              <div className="todo-flt">
                {scope !== "shared" && (
                  <button type="button" className="todo-tbtn" data-active={showApproval ? "true" : undefined} aria-pressed={showApproval} onClick={() => void patchPrefs({ showApprovalEvents: !showApproval })}>
                    {showApproval && <Check strokeWidth={2.6} aria-hidden="true" />}
                    결재 일정
                  </button>
                )}
                {scope === "board" && (
                  <CdDropdown
                    menuWidthClass="w-48"
                    trigger={() => (
                      <button type="button" className="todo-tbtn" data-active={assigneeFilter ? "true" : undefined}>
                        {assigneeLabel}
                        <ChevronDown aria-hidden="true" />
                      </button>
                    )}
                    items={assigneeMenu}
                  />
                )}
                {view === "list" && scope !== "shared" && (
                  <CdDropdown
                    menuWidthClass="w-48"
                    trigger={() => (
                      <button type="button" className="todo-tbtn">
                        {SORT_LABELS[sortMode]}
                        <ChevronDown aria-hidden="true" />
                      </button>
                    )}
                    items={displayMenu}
                  />
                )}
              </div>
              <div className="todo-seg-view overflow-hidden" role="group" aria-label="보기 방식">
                <button type="button" className="cd-choice" data-active={view === "list" ? "true" : undefined} aria-pressed={view === "list"} onClick={() => goView("list")}>
                  <List aria-hidden="true" />
                  목록
                </button>
                <button type="button" className="cd-choice" data-active={view === "board" ? "true" : undefined} aria-pressed={view === "board"} disabled={scope === "shared"} title={scope === "shared" ? "공유받음은 목록으로만 봅니다" : undefined} onClick={() => goView("board")}>
                  <Kanban aria-hidden="true" />
                  보드
                </button>
                <button type="button" className="cd-choice" data-active={view === "timeline" ? "true" : undefined} aria-pressed={view === "timeline"} disabled={scope === "shared" || scope === "delegated"} title={scope === "shared" || scope === "delegated" ? "이 범위는 목록으로만 봅니다" : "기간·마일스톤·선행 관계를 시간축에"} onClick={() => goView("timeline")}>
                  <AlignHorizontalDistributeStart aria-hidden="true" />
                  타임라인
                </button>
                <button type="button" className="cd-choice" onClick={() => goView("calendar")}>
                  <Calendar aria-hidden="true" />
                  캘린더
                </button>
              </div>
              <button type="button" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center todo-pf-btn" aria-label="할 일 설정" title="할 일 설정 — 아침·주간 요약, 알림 시각, 표시" disabled={!prefs} onClick={() => setPrefsOpen(true)}>
                <Settings2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {archivedMode && (
            <div className="todo-canvas-body" data-layout="groups" onKeyDown={rowListKeyNav}>
              <div className="todo-rows" aria-label="보관함">
                <GroupHeader
                  label="보관함"
                  when="완료 30일이 지나 자동 보관된 할 일"
                  count={archive.items.length}
                  action={
                    <button type="button" className="todo-tbtn" onClick={() => setQuery({ archived: null })}>
                      <ArrowLeft aria-hidden="true" />
                      돌아가기
                    </button>
                  }
                />
                {archive.loading && !archive.loaded ? (
                  <div className="todo-loading">불러오는 중…</div>
                ) : archive.items.filter((i) => i.archivedAt).length === 0 ? (
                  <CdEmptyState title="보관된 할 일이 없습니다" description="완료 후 30일이 지난 할 일이 여기에 모입니다. 체크를 다시 누르면 목록으로 되돌아갑니다." />
                ) : (
                  <>
                    <TodoColumnHeader />
                    {archive.items
                      .filter((i) => i.archivedAt)
                      .map((it) => (
                        <TodoRow key={it.itemId} item={it} today={today} density={density} selected={itemParam === it.itemId} timeCell="date" onOpen={openItem} onComplete={completeIn(archive, false)} />
                      ))}
                  </>
                )}
              </div>
            </div>
          )}

          {!archivedMode && scope === "my" && view === "list" && (
            <>
              {my.loading && !my.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <MyTodoList
                  items={myItems}
                  approvalEvents={my.approvalEvents}
                  showApproval={showApproval}
                  today={today}
                  weekStart={weekStart}
                  density={density}
                  sortMode={sortMode}
                  selectedId={itemParam}
                  loaded={my.loaded}
                  filter={quickFilter}
                  {...doneListProps(my)}
                  onOpen={openItem}
                  onComplete={completeIn(my)}
                  onNew={openNew}
                />
              )}
            </>
          )}

          {!archivedMode && scope === "board" && view === "list" && (
            <>
              {boardData.loading && !boardData.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <MyTodoList
                  items={boardItems}
                  approvalEvents={boardData.approvalEvents}
                  showApproval={showApproval}
                  today={today}
                  weekStart={weekStart}
                  density={density}
                  sortMode={sortMode}
                  selectedId={itemParam}
                  loaded={boardData.loaded}
                  {...doneListProps(boardData)}
                  onOpen={openItem}
                  onComplete={completeIn(boardData)}
                  onNew={openNew}
                />
              )}
            </>
          )}

          {/* §29-1 타임라인 — 내 할 일 / 프로젝트 보드 */}
          {!archivedMode && view === "timeline" && (scope === "my" || scope === "board") && (
            <TodoTimeline
              items={scope === "board" ? boardItems : myItems}
              today={today}
              selectedId={itemParam}
              loading={scope === "board" ? boardData.loading && !boardData.loaded : my.loading && !my.loaded}
              onOpen={openItem}
              onPatch={(id, patch, optimistic) => (scope === "board" ? boardData : my).patchItem(id, patch, optimistic)}
            />
          )}

          {!archivedMode && view === "board" && scope !== "shared" && (
            <>
              <KanbanBoard
                board={board}
                items={boardItems}
                today={today}
                density={density}
                selectedId={itemParam}
                loading={boardData.loading}
                loaded={boardData.loaded}
                membersVersion={membersVersion}
                onOpen={openItem}
                onMove={boardData.moveItem}
                onCompleteRequest={(item) => completeIn(boardData, false)(item, true)}
                onCreate={createIn(boardData)}
                onBoardUpdated={onBoardUpdated}
                onManageMembers={() => setMembersOpen(true)}
                onRequestDelete={canDeleteBoard(board) ? () => setDeleteBoardTarget(board) : undefined}
              />
            </>
          )}

          {!archivedMode && scope === "delegated" && (
            <>
              {delegated.loading && !delegated.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <MyTodoList
                  items={delegatedItems}
                  approvalEvents={[]}
                  showApproval={false}
                  today={today}
                  weekStart={weekStart}
                  density={density}
                  sortMode={sortMode}
                  selectedId={itemParam}
                  loaded={delegated.loaded}
                  filter={null}
                  emptyTitle="맡긴 일이 없습니다"
                  emptyDescription="내가 만든 할 일의 담당을 다른 사람으로 지정하면 여기에 모입니다. 담당 열에서 누가 맡았는지 보입니다."
                  {...doneListProps(delegated)}
                  onOpen={openItem}
                  onComplete={completeIn(delegated)}
                  onNew={openNew}
                />
              )}
            </>
          )}

          {!archivedMode && scope === "shared" && (
            <>
              {shared.loading && !shared.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <SharedList items={sharedItems} boards={boards} myUserId={myUserId} today={today} density={density} selectedId={itemParam} loaded={shared.loaded} {...doneListProps(shared)} onOpen={openItem} onComplete={completeIn(shared)} />
              )}
            </>
          )}
        </section>
      </div>


      <CompleteConfirmModal open={!!confirm} target={confirm?.target ?? null} failure={confirm?.failure} busy={confirmBusy} onConfirm={(note) => void confirmComplete(note)} onClose={cancelConfirm} />

      {prefsOpen && prefs && <TodoPrefsModal prefs={prefs} onPatch={patchPrefs} onClose={() => setPrefsOpen(false)} />}
          <BoardDeleteModal board={deleteBoardTarget} onClose={() => setDeleteBoardTarget(null)} onDeleted={onBoardDeleted} />

      {/* 상세·작성 — 우측 드로어(2026-10-20 사용자 요청으로 페이지 방식에서 복귀, 폭 확대) */}
      {mounted && (
        <TodoDetailDrawer
          itemId={itemParam}
          draft={draftInit}
          boards={boards}
          prefs={prefs}
          myUserId={myUserId}
          myName={myName}
          myPhotoUrl={myPhotoUrl}
          today={today}
          onClose={closeItem}
          onItemChanged={(item) => {
            upsertAll(item);
            if (item.status === "done") graceDrop(item.itemId);
            else if (archivedMode) {
              // 보관함 항목을 상세에서 되돌리면 보관이 풀려 목록으로 돌아간다 — 목록들을 다시 읽는다.
              void my.reload();
              void shared.reload();
              void boardData.reload();
            }
          }}
          onItemCreated={createdAll}
          onItemDeleted={removeAll}
          onOpenItem={(id) => openItem(id)}
          onDraftSaved={(item) => openItem(item.itemId)}
        />
      )}

      <BoardCreateModal
        open={createOpen}
        boards={boards}
        onClose={() => setCreateOpen(false)}
        onCreated={(b) => {
          onBoardUpdated(b);
          goBoard(b.boardId, "board");
        }}
        onOpenBoard={(id) => goBoard(id, "board")}
      />

      <BoardMembersModal open={membersOpen} board={board} myUserId={myUserId} onClose={() => setMembersOpen(false)} onChanged={onMembersChanged} />
    </div>
  );
}
