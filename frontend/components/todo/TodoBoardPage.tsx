"use client";

// /todo 페이지 컨테이너(시안 v4, §19) — CdPageHeader(제목 아래 태그 버튼 4개: 오늘·지연·이번 주·공유받음 = 필터) + 흰 캔버스 카드 하나.
// 캔버스 상단 바(54px): 좌측 범위 탭(CdTabs underline: 내 할 일 | 공유받음 | 프로젝트 ▾ — 프로젝트는 CdDropdown 으로 보드 목록 + "+ 새 프로젝트 보드")
//   / 우측 필터(결재 일정 · 완료 숨김 · 담당자 ▾) + 보기 세그먼트(목록·보드·캘린더). 캘린더 보기는 /calendar?tags=todo 로 이동.
// URL: ?scope=my|shared|board:<id>&view=list|board&item=&new=1 (구 ?tab=my|board|calendar|shared&board= 호환). 상세 드로어는 ?item= 로 연다.
// 데이터는 useTodoData 인스턴스 3개(my·shared 상시, board 는 보드 범위/보드 보기일 때).

import "@/components/cdash/cdash.css";
import "./todo.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Calendar, Check, ChevronDown, Kanban, List, Plus } from "lucide-react";
import { CdButton, CdDropdown, CdPageHeader, CdTabs, useCdToast, useCdashTheme, type CdMenuItem } from "@/components/cdash";
import { DEFAULT_TODO_PREFS, type TodoBoard, type TodoBoardMember, type TodoItem, type TodoItemDetail, type TodoPrefs } from "@/lib/todo/types";
import { useTodoData, apiCall } from "./useTodoData";
import { QuickAddBar } from "./QuickAddBar";
import { MyTodoList, type QuickFilter } from "./MyTodoList";
import { SharedList } from "./SharedList";
import { KanbanBoard } from "./KanbanBoard";
import { TodoDetailDrawer } from "./TodoDetailDrawer";
import { BoardCreateModal } from "./BoardCreateModal";
import { BoardMembersModal } from "./BoardMembersModal";
import { tintStyle } from "./TodoRow";
import { effectiveDate, localToday, weekEnd, type SortMode } from "./todo-utils";

type ScopeKind = "my" | "shared" | "board";
type ScopeTab = "my" | "shared" | "none";
type View = "list" | "board";
const SORT_LABELS: Record<SortMode, string> = { manual: "수동", date: "날짜순", priority: "우선순위순" };

const isTypingTarget = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

/** URL → 범위·보기 (구 ?tab= 호환). */
function parseScope(sp: URLSearchParams): { kind: ScopeKind; boardId: string | null; view: View; calendar: boolean } {
  const scope = sp.get("scope");
  const viewRaw = sp.get("view");
  const tab = sp.get("tab");
  let kind: ScopeKind = "my";
  let boardId: string | null = null;
  let view: View = viewRaw === "board" ? "board" : "list";
  let calendar = viewRaw === "calendar";
  if (scope === "shared") kind = "shared";
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
  if (kind === "shared") view = "list";
  return { kind, boardId, view, calendar };
}

export function TodoBoardPage() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const sp = useSearchParams();
  const { data: session } = useSession();
  const myUserId = ((session?.user as { id?: string } | undefined)?.id as string | undefined) ?? null;

  const parsed = useMemo(() => parseScope(new URLSearchParams(sp.toString())), [sp]);
  const itemParam = sp.get("item");
  // ?item= 직접 진입 시 서버(드로어 없음)와 클라이언트(포털 드로어) 첫 렌더가 달라 hydration 오류 → 마운트 뒤에만 드로어를 그린다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const newParam = sp.get("new");

  const [prefs, setPrefs] = useState<TodoPrefs | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [membersVersion, setMembersVersion] = useState(0);
  const today = useMemo(() => localToday(), []);

  // ── URL query ──
  const setQuery = useCallback(
    (patch: Partial<Record<"scope" | "view" | "item" | "new", string | null>>) => {
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
    if (parsed.calendar) router.replace("/calendar?tags=todo");
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

  // ── 데이터 ──
  const my = useTodoData({ view: "my", done: showDone, withApproval: showApproval }, true);
  const shared = useTodoData({ view: "shared", done: showDone }, true);
  const boards = my.boards.length ? my.boards : shared.boards;
  const personalBoardId = boards.find((b) => b.kind === "personal" && b.isDefault)?.boardId ?? boards.find((b) => b.isDefault)?.boardId ?? boards[0]?.boardId ?? null;
  const scopeBoardId = parsed.kind === "board" && parsed.boardId && boards.some((b) => b.boardId === parsed.boardId) ? parsed.boardId : null;
  const scope: ScopeKind = parsed.kind === "board" ? (scopeBoardId || !boards.length ? "board" : "my") : parsed.kind;
  const view: View = scope === "shared" ? "list" : parsed.view;
  // 활성 보드 — 보드 범위면 그 보드, 내 할 일의 보드 보기면 개인 보드
  const activeBoardId = scope === "board" ? scopeBoardId : view === "board" ? personalBoardId : null;
  const board = boards.find((b) => b.boardId === activeBoardId) ?? null;
  const boardData = useTodoData({ view: "board", boardId: activeBoardId, done: showDone, withApproval: showApproval }, !!activeBoardId);

  useEffect(() => {
    setAssigneeFilter(null);
  }, [activeBoardId]);

  const visible = useCallback((items: TodoItem[]) => (showDone ? items : items.filter((i) => i.status !== "done")), [showDone]);
  const myItems = useMemo(() => visible(my.items), [my.items, visible]);
  const sharedItems = useMemo(() => visible(shared.items), [shared.items, visible]);
  const boardItems = useMemo(() => {
    const list = visible(boardData.items);
    if (!assigneeFilter) return list;
    return list.filter((i) => (assigneeFilter === "__none__" ? !i.assigneeUserId : i.assigneeUserId === assigneeFilter));
  }, [boardData.items, visible, assigneeFilter]);

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
    return { overdue, today: td, week, shared: shared.items.filter((i) => !i.parentItemId && i.status !== "done").length };
  }, [my.items, shared.items, today, weekStart]);

  // ── 퀵애드 열기(?new=1 · N 키 · 새 할 일 버튼) ──
  useEffect(() => {
    if (newParam === "1") {
      setQuickOpen((n) => n + 1);
      setQuery({ new: null, ...(scope === "shared" ? { scope: "my" } : {}) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam]);

  const itemParamRef = useRef(itemParam);
  itemParamRef.current = itemParam;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || itemParamRef.current) return;
      e.preventDefault();
      setQuickOpen((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openNew = () => {
    if (scope === "shared") setQuery({ scope: "my" });
    setQuickOpen((n) => n + 1);
  };

  // ── 범위·보기 전환 ──
  const goScope = (kind: "my" | "shared") => {
    setQuickFilter(null);
    setQuery({ scope: kind, view: kind === "shared" ? "list" : view });
  };
  const goBoard = (boardId: string, nextView?: View) => {
    setQuickFilter(null);
    setQuery({ scope: `board:${boardId}`, view: nextView ?? view });
  };
  const goView = (v: View | "calendar") => {
    if (v === "calendar") {
      router.push("/calendar?tags=todo");
      return;
    }
    if (scope === "shared" && v === "board") return;
    setQuery({ view: v });
  };
  const toggleQuickFilter = (f: Exclude<QuickFilter, null>) => {
    const next = quickFilter === f && scope === "my" && view === "list" ? null : f;
    setQuickFilter(next);
    if (scope !== "my" || view !== "list") setQuery({ scope: "my", view: "list" });
  };

  // ── 공통 동작 ──
  const openItem = (item: TodoItem | string) => setQuery({ item: typeof item === "string" ? item : item.itemId });
  const closeItem = () => setQuery({ item: null });

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

  const completeWithUndo = (source: typeof my) => async (item: TodoItem, done: boolean) => {
    const res = await source.completeItem(item.itemId, done);
    if (!res) return;
    if (done) {
      toast(
        <span className="inline-flex items-center gap-2">
          완료
          <button type="button" className="todo-tbtn" data-active="true" onClick={() => void source.completeItem(item.itemId, false)}>
            되돌리기
          </button>
        </span>,
        "success",
        5000
      );
    }
    upsertAll(res.item);
  };

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

  const onMembersChanged = (members: TodoBoardMember[]) => {
    if (!board) return;
    onBoardUpdated({ ...board, memberCount: members.length });
    setMembersVersion((n) => n + 1);
  };

  // ── 프로젝트 탭 드롭다운(내 프로젝트 · 부서 · 공유 보드 + 새 보드) ──
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

  const sharedCount = sharedItems.filter((i) => !i.parentItemId).length;
  const scopeTab: ScopeTab = scope === "my" ? "my" : scope === "shared" ? "shared" : "none";
  const boardLabel = board ? (board.kind === "personal" ? "개인 보드" : (board.projectName ?? board.name)) : null;
  const quickAddPlaceholder = scope === "board" && board ? `${boardLabel}에 할 일 추가 — #열이름 으로 열 지정` : undefined;

  const tagButton = (tone: "today" | "over" | "week" | "shared", label: string, count: number, pressed: boolean, onClick: () => void) => (
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
              <p>
                입력줄에 <b>내일 오후 3시 ○○사 미팅 !높음 @홍길동 10/30까지</b> 처럼 적으면 날짜·시각·우선순위·담당·마감을 자동으로 알아봅니다. 잘못 알아본 칩은 × 로 해제하면 그 단어가 제목에 남습니다.
              </p>
              <p>범위 탭의 '프로젝트 ▾'에서 계약관리 용역을 골라 프로젝트 보드를 만들면 용역명·발주처·색을 할 일이 물려받고, 수행인력이 멤버로 자동 추가됩니다. 할 일은 만든 사람만 봅니다. 담당·참조로 사람을 붙이거나 프로젝트·부서 보드로 옮길 때만 상대에게 보입니다.</p>
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
                  if (k === "my" || k === "shared") goScope(k);
                }}
                items={[
                  { key: "my", label: "내 할 일" },
                  { key: "shared", label: "공유받음", count: sharedCount || undefined },
                ]}
              />
              <div className="cd-tabs" data-variant="underline" role="presentation">
                <CdDropdown
                  align="left"
                  menuWidthClass="w-80"
                  trigger={() => (
                    <button type="button" className="cd-tab" role="tab" aria-selected={scope === "board"} aria-label="프로젝트 보드 선택">
                      {scope === "board" && board && <span className="todo-scope-sq" style={tintStyle(board.colorHex)} aria-hidden="true" />}
                      {scope === "board" && board ? `프로젝트 · ${boardLabel}` : "프로젝트"}
                      <ChevronDown className="todo-scope-caret" aria-hidden="true" />
                    </button>
                  )}
                  items={projectMenu}
                />
              </div>
            </div>
            <div className="todo-views">
              <div className="todo-flt">
                {scope !== "shared" && (
                  <button type="button" className="todo-tbtn" data-active={showApproval ? "true" : undefined} aria-pressed={showApproval} onClick={() => void patchPrefs({ showApprovalEvents: !showApproval })}>
                    {showApproval && <Check strokeWidth={2.6} aria-hidden="true" />}
                    결재 일정
                  </button>
                )}
                <button type="button" className="todo-tbtn" data-active={showDone ? "true" : undefined} aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>
                  {showDone && <Check strokeWidth={2.6} aria-hidden="true" />}
                  {showDone ? `완료 표시(${prefs?.showDoneDays ?? 7}일)` : "완료 숨김"}
                </button>
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
                <button type="button" className="cd-choice" onClick={() => goView("calendar")}>
                  <Calendar aria-hidden="true" />
                  캘린더
                </button>
              </div>
            </div>
          </div>

          {scope === "my" && view === "list" && (
            <>
              {my.loading && !my.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <MyTodoList
                  items={myItems}
                  approvalEvents={my.approvalEvents}
                  showApproval={showApproval}
                  showDone={showDone}
                  today={today}
                  weekStart={weekStart}
                  density={density}
                  sortMode={sortMode}
                  selectedId={itemParam}
                  loaded={my.loaded}
                  filter={quickFilter}
                  top={<QuickAddBar boards={boards} currentBoardId={personalBoardId} prefs={prefs} onCreate={createIn(my)} openRequest={quickOpen} />}
                  onOpen={openItem}
                  onComplete={completeWithUndo(my)}
                  onNew={openNew}
                />
              )}
            </>
          )}

          {scope === "board" && view === "list" && (
            <>
              {boardData.loading && !boardData.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <MyTodoList
                  items={boardItems}
                  approvalEvents={boardData.approvalEvents}
                  showApproval={showApproval}
                  showDone={showDone}
                  today={today}
                  weekStart={weekStart}
                  density={density}
                  sortMode={sortMode}
                  selectedId={itemParam}
                  loaded={boardData.loaded}
                  top={<QuickAddBar boards={boards} currentBoardId={activeBoardId} prefs={prefs} onCreate={createIn(boardData)} openRequest={quickOpen} placeholder={quickAddPlaceholder} />}
                  onOpen={openItem}
                  onComplete={completeWithUndo(boardData)}
                  onNew={openNew}
                />
              )}
            </>
          )}

          {view === "board" && scope !== "shared" && (
            <>
              <QuickAddBar boards={boards} currentBoardId={activeBoardId} prefs={prefs} onCreate={createIn(boardData)} openRequest={quickOpen} placeholder={quickAddPlaceholder ?? (board ? "개인 보드에 할 일 추가 — #열이름 으로 열 지정" : "할 일 추가")} />
              <KanbanBoard
                board={board}
                items={boardItems}
                today={today}
                density={density}
                showDone={showDone}
                selectedId={itemParam}
                loading={boardData.loading}
                loaded={boardData.loaded}
                membersVersion={membersVersion}
                onOpen={openItem}
                onMove={boardData.moveItem}
                onCreate={createIn(boardData)}
                onBoardUpdated={onBoardUpdated}
                onManageMembers={() => setMembersOpen(true)}
              />
            </>
          )}

          {scope === "shared" && (
            <>
              {shared.loading && !shared.loaded ? (
                <div className="todo-loading">불러오는 중…</div>
              ) : (
                <SharedList items={sharedItems} boards={boards} myUserId={myUserId} today={today} density={density} showDone={showDone} selectedId={itemParam} loaded={shared.loaded} onOpen={openItem} onComplete={completeWithUndo(shared)} />
              )}
            </>
          )}
        </section>
      </div>

      {mounted && <TodoDetailDrawer itemId={itemParam} boards={boards} prefs={prefs} myUserId={myUserId} today={today} onClose={closeItem} onItemChanged={upsertAll} onItemCreated={createdAll} onItemDeleted={removeAll} onOpenItem={(id) => openItem(id)} />}

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
