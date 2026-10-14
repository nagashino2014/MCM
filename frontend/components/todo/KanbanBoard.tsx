"use client";

// 보드(칸반, 시안 v4) — 보드 정보 행(프로젝트명 + 색 사각 · 발주처 · 계약번호 · 멤버 이름 · 안내 · 멤버 관리) → 28px → 열(폭 264 · 간격 28 · 배경 없음).
// 열 헤더 = 파스텔 칩(상태 매핑/이름/순환) + 건수 + WIP 초과 "권장 N건 초과" 라벨. 카드 = 흰 바탕 1px 경계 8px + 좌측 4px 띠(보드 색, 지연은 --todo-late).
// DnD(@hello-pangea/dnd 18): 드래그 중 회전 없음(경계 primary + popover 그림자), 드롭 위치는 placeholder 자리에 2px primary 삽입선 + 양끝 점.
// 완료·보류 열은 보드 아래 가로 접힘 행("완료 7 · 최근 ○○ '제목' 시각" / "보류 0" / "완료 펼치기") — 펼치면 열로 전개.
// 키보드 대체 경로 = 카드 ⋯ 메뉴(왼쪽/오른쪽 열·맨 위/맨 아래) + aria-live 공지. 시각 규칙은 todo.css 의 todo-* 클래스에만 둔다.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { ChevronRight, MessageSquare, MoreHorizontal, Plus } from "lucide-react";
import { CdButton, CdCheckbox, CdDropdown, CdEmptyState, CdIconButton, CdInput, CdModal, CdSelect, useCdToast, type CdMenuItem } from "@/components/cdash";
import { TODO_STATUSES, TODO_STATUS_LABELS, type TodoBoard, type TodoBoardMember, type TodoColumn, type TodoCompleteRules, type TodoItem, type TodoItemDetail, type TodoStatus } from "@/lib/todo/types";
import { comparePosition } from "@/lib/todo/position";
import { completeRulesSummary, hasAnyCompleteRule } from "@/lib/todo/completion";
import { DueText, MiniSegments, PriorityLabel, tintStyle, type Density } from "./TodoRow";
import { CompleteRulesFields } from "./CompleteRulesFields";
import { apiCall, type MoveArgs } from "./useTodoData";
import { columnTone, contextParts, contractShort, dueBadge, isFoldedColumn, md, relativeTime } from "./todo-utils";

const NONE_COL = "__none__";

export interface KanbanBoardProps {
  board: TodoBoard | null;
  items: TodoItem[];
  today: string;
  density: Density;
  selectedId: string | null;
  loading: boolean;
  loaded: boolean;
  /** 멤버 관리 모달이 닫힐 때 올려 멤버 이름을 다시 읽는다. */
  membersVersion?: number;
  onOpen: (item: TodoItem) => void;
  onMove: (itemId: string, move: MoveArgs, optimisticStatus?: TodoStatus) => Promise<TodoItemDetail | null>;
  /**
   * 완료 열(status_map=done)로 옮기는 카드에 완료 조건(276)이 있을 때 — 상위가 완료 확인 모달을 띄우고 완료 API 로 처리한다(열은 서버가 옮김).
   * 취소·미충족이면 false → 카드는 원위치.
   */
  onCompleteRequest: (item: TodoItem) => Promise<boolean>;
  onCreate: (input: Record<string, unknown>) => Promise<TodoItemDetail | null>;
  onBoardUpdated: (board: TodoBoard) => void;
  onManageMembers: () => void;
}

function CardBody({ item, today, menu, onOpen }: { item: TodoItem; today: string; menu: CdMenuItem[]; onOpen: (item: TodoItem) => void }) {
  const badge = dueBadge(item, today, true);
  const ctx = contextParts(item);
  const ctxText = ctx.primary === "내부" && !ctx.client ? null : [ctx.primary, ctx.client].filter(Boolean).join(" · ");
  return (
    <>
      <div className="todo-card-tt">
        <PriorityLabel priority={item.priority} />
        <span>{item.title}</span>
      </div>
      {ctxText && <div className="todo-card-ctx">{ctxText}</div>}
      <div className="todo-card-ft">
        {badge ? <DueText badge={badge} /> : item.doDate ? <span>{md(item.doDate)}</span> : null}
        {item.subtaskTotal > 0 && <MiniSegments done={item.subtaskDone} total={item.subtaskTotal} />}
        {item.commentCount > 0 && (
          <span className="todo-sub" title="댓글">
            <MessageSquare aria-hidden="true" />
            {item.commentCount}
          </span>
        )}
        <span className="todo-spacer" />
        <span className="todo-who-txt" data-none={item.assigneeName ? undefined : "true"}>
          {item.assigneeName ?? "담당 없음"}
        </span>
      </div>
      <div className="todo-card-menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <CdDropdown
          menuWidthClass="w-44"
          trigger={() => (
            <button type="button" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center" aria-label={`${item.title} 메뉴`}>
              <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          items={[{ key: "open", label: "상세 열기", onSelect: () => onOpen(item) }, ...menu]}
        />
      </div>
    </>
  );
}

export function KanbanBoard({ board, items, today, density, selectedId, loading, loaded, membersVersion = 0, onOpen, onMove, onCompleteRequest, onCreate, onBoardUpdated, onManageMembers }: KanbanBoardProps) {
  const { toast } = useCdToast();
  const [members, setMembers] = useState<TodoBoardMember[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [colOrder, setColOrder] = useState<string[] | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [colEdit, setColEdit] = useState<TodoColumn | null>(null);
  const [colDelete, setColDelete] = useState<TodoColumn | null>(null);
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const composing = useRef(false);

  const boardId = board?.boardId ?? null;
  const boardKind = board?.kind ?? null;
  const canManage = board?.myRole === "admin";
  const canWrite = !!board && board.myRole !== "viewer";

  useEffect(() => {
    setColOrder(null);
    setAddingIn(null);
    setNewTitle("");
    setUnfolded(new Set());
  }, [boardId]);

  useEffect(() => {
    if (!boardId || boardKind === "personal") {
      setMembers([]);
      return;
    }
    let cancelled = false;
    apiCall<{ members: TodoBoardMember[] }>(`/api/todo/boards/${encodeURIComponent(boardId)}/members`)
      .then((d) => {
        if (!cancelled) setMembers(d.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, boardKind, membersVersion]);

  const allColumns = useMemo(() => {
    if (!board) return [];
    const sorted = [...board.columns].sort((a, b) => comparePosition(a.position, b.position));
    if (!colOrder) return sorted;
    const byId = new Map(sorted.map((c) => [c.columnId, c]));
    const ordered = colOrder.map((id) => byId.get(id)).filter((c): c is TodoColumn => !!c);
    for (const c of sorted) if (!colOrder.includes(c.columnId)) ordered.push(c);
    return ordered;
  }, [board, colOrder]);

  /** 보드에 열로 펼쳐진 열(완료·보류는 펼친 것만) / 아래 접힘 행에 놓이는 열 */
  const columns = useMemo(() => allColumns.filter((c) => !isFoldedColumn(c) || unfolded.has(c.columnId)), [allColumns, unfolded]);
  const folded = useMemo(() => allColumns.filter((c) => isFoldedColumn(c) && !unfolded.has(c.columnId)), [allColumns, unfolded]);

  const cardsByCol = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    map.set(NONE_COL, []);
    for (const c of allColumns) map.set(c.columnId, []);
    for (const it of items) {
      if (it.parentItemId) continue;
      const key = it.columnId && map.has(it.columnId) ? it.columnId : NONE_COL;
      map.get(key)!.push(it);
    }
    for (const l of map.values()) l.sort((a, b) => comparePosition(a.position, b.position));
    return map;
  }, [items, allColumns]);

  const statusFor = useCallback(
    (columnId: string | null): TodoStatus | undefined => {
      if (!board?.columnStatusMap || !columnId) return undefined;
      return board.columns.find((c) => c.columnId === columnId)?.statusMap ?? undefined;
    },
    [board]
  );

  const colName = useCallback((columnId: string | null) => (columnId ? (board?.columns.find((c) => c.columnId === columnId)?.name ?? "열") : "열 미배정"), [board]);

  const moveCard = useCallback(
    async (item: TodoItem, columnId: string | null, index: number | "top" | "bottom") => {
      const list = (cardsByCol.get(columnId ?? NONE_COL) ?? []).filter((x) => x.itemId !== item.itemId);
      const i = index === "top" ? 0 : index === "bottom" ? list.length : Math.max(0, Math.min(index, list.length));
      const move: MoveArgs = { columnId };
      if (list.length) {
        if (i > 0) move.afterItemId = list[i - 1].itemId;
        else move.beforeItemId = list[0].itemId;
      }
      const nextStatus = statusFor(columnId);
      // 완료 열로 옮기는데 완료 조건(276)이 있으면 모달 먼저 — 완료 API 가 열까지 옮기므로 여기서는 이동을 보내지 않는다. 취소면 원위치.
      if (nextStatus === "done" && item.status !== "done" && hasAnyCompleteRule(item.completeRules)) {
        const ok = await onCompleteRequest(item);
        if (ok) setLive(`'${item.title}' 을(를) 완료했습니다.`);
        return;
      }
      setLive(`'${item.title}' 을(를) ${colName(columnId)} 열로 이동했습니다.`);
      await onMove(item.itemId, move, nextStatus);
    },
    [cardsByCol, statusFor, colName, onMove, onCompleteRequest]
  );

  const saveDefaultRules = async (rules: TodoCompleteRules) => {
    if (!boardId) return;
    setBusy(true);
    try {
      const d = await apiCall<{ board: TodoBoard }>(`/api/todo/boards/${encodeURIComponent(boardId)}`, { method: "PATCH", body: JSON.stringify({ defaultCompleteRules: rules }) });
      onBoardUpdated(d.board);
      setRulesOpen(false);
      toast("기본 완료 조건을 저장했습니다", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, type, draggableId } = result;
    if (!destination) return;
    if (type === "column") {
      if (source.index === destination.index || !boardId) return;
      const visible = columns.map((c) => c.columnId);
      const [moved] = visible.splice(source.index, 1);
      visible.splice(destination.index, 0, moved);
      // 전체 순서 = 보이는 열 순서를 기준으로 접힌 열은 원래 상대 위치에 남긴다
      const ids = allColumns.map((c) => c.columnId).filter((id) => !visible.includes(id));
      ids.push(...visible);
      setColOrder(ids);
      const patch: Record<string, unknown> = { columnId: moved };
      if (destination.index > 0) patch.afterColumnId = visible[destination.index - 1];
      else patch.beforeColumnId = visible[1];
      try {
        const d = await apiCall<{ board: TodoBoard }>(`/api/todo/boards/${encodeURIComponent(boardId)}/columns`, { method: "PATCH", body: JSON.stringify(patch) });
        onBoardUpdated(d.board);
      } catch (e) {
        toast(`저장하지 못했습니다. 입력은 유지됩니다 — ${(e as Error).message}`, "error");
      } finally {
        setColOrder(null);
      }
      return;
    }
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    const item = items.find((x) => x.itemId === draggableId);
    if (!item) return;
    await moveCard(item, destination.droppableId === NONE_COL ? null : destination.droppableId, destination.index);
  };

  // ── 열 CRUD(POST/PATCH/DELETE /api/todo/boards/[id]/columns → { board }) ──
  const columnsApi = async (method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, query?: string): Promise<TodoBoard | null> => {
    if (!boardId) return null;
    setBusy(true);
    try {
      const d = await apiCall<{ board: TodoBoard }>(`/api/todo/boards/${encodeURIComponent(boardId)}/columns${query ? `?${query}` : ""}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      onBoardUpdated(d.board);
      return d.board;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submitNewCard = async (columnId: string | null) => {
    const title = newTitle.trim();
    if (!title || !boardId) return;
    setBusy(true);
    const created = await onCreate({ title, boardId, columnId: columnId ?? undefined });
    setBusy(false);
    if (created) setNewTitle("");
  };

  const submitNewCol = async () => {
    const name = newColName.trim();
    if (!name) return;
    const b = await columnsApi("POST", { name });
    if (b) {
      setAddingCol(false);
      setNewColName("");
    }
  };

  const onNewCardKey = (e: KeyboardEvent<HTMLInputElement>, columnId: string | null) => {
    if (e.key === "Enter" && !composing.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submitNewCard(columnId);
    } else if (e.key === "Escape") {
      setAddingIn(null);
      setNewTitle("");
    }
  };

  const cardMenu = (item: TodoItem, columnId: string | null): CdMenuItem[] => {
    const idx = columns.findIndex((c) => c.columnId === columnId);
    const left = idx > 0 ? columns[idx - 1] : null;
    const right = idx >= 0 && idx + 1 < columns.length ? columns[idx + 1] : columnId === null && columns.length ? columns[0] : null;
    const list = cardsByCol.get(columnId ?? NONE_COL) ?? [];
    const pos = list.findIndex((x) => x.itemId === item.itemId);
    const foldedTargets: CdMenuItem[] = folded.map((c) => ({ key: `to-${c.columnId}`, label: `${c.name} 열로`, disabled: !item.canEdit, onSelect: () => void moveCard(item, c.columnId, "bottom") }));
    return [
      { key: "left", label: left ? `왼쪽 열로 (${left.name})` : "왼쪽 열로", disabled: !left || !item.canEdit, onSelect: () => left && void moveCard(item, left.columnId, "bottom") },
      { key: "right", label: right ? `오른쪽 열로 (${right.name})` : "오른쪽 열로", disabled: !right || !item.canEdit, onSelect: () => right && void moveCard(item, right.columnId, "bottom") },
      ...foldedTargets,
      { key: "top", label: "맨 위로", disabled: pos <= 0 || !item.canEdit, onSelect: () => void moveCard(item, columnId, "top") },
      { key: "bottom", label: "맨 아래로", disabled: pos < 0 || pos >= list.length - 1 || !item.canEdit, onSelect: () => void moveCard(item, columnId, "bottom") },
    ];
  };

  const renderCards = (columnId: string | null, droppableId: string) => {
    const cards = cardsByCol.get(droppableId) ?? [];
    return (
      <Droppable droppableId={droppableId} type="card" isDropDisabled={!canWrite}>
        {(dp, ds) => (
          <div ref={dp.innerRef} {...dp.droppableProps} className="todo-cards" data-over={ds.isDraggingOver ? "true" : undefined}>
            {cards.map((it, i) => {
              const badge = dueBadge(it, today, true);
              return (
                <Draggable key={it.itemId} draggableId={it.itemId} index={i} isDragDisabled={!it.canEdit}>
                  {(p, s) => (
                    <article
                      ref={p.innerRef}
                      {...p.draggableProps}
                      {...p.dragHandleProps}
                      className="todo-card"
                      data-dragging={s.isDragging ? "true" : undefined}
                      data-density={density === "compact" ? "compact" : undefined}
                      data-done={it.status === "done" ? "true" : undefined}
                      data-late={badge?.tone === "over" ? "true" : undefined}
                      data-selected={selectedId === it.itemId ? "true" : undefined}
                      style={{ ...p.draggableProps.style, ...tintStyle(it.boardColor) }}
                      role="button"
                      aria-label={it.title}
                      onClick={() => onOpen(it)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) {
                          e.preventDefault();
                          onOpen(it);
                        }
                      }}
                    >
                      <CardBody item={it} today={today} menu={cardMenu(it, columnId)} onOpen={onOpen} />
                    </article>
                  )}
                </Draggable>
              );
            })}
            {/* 드롭 위치 — placeholder 자리에 삽입선(2px primary + 양끝 점) */}
            <div className="todo-ph" data-active={ds.isDraggingOver ? "true" : undefined}>
              {ds.isDraggingOver && <div className="todo-ins" aria-hidden="true" />}
              {dp.placeholder}
            </div>
            {cards.length === 0 && !ds.isDraggingOver && <div className="todo-emptycol">카드를 여기로 옮기세요</div>}
          </div>
        )}
      </Droppable>
    );
  };

  const renderAdd = (columnId: string | null) => {
    const key = columnId ?? NONE_COL;
    if (!canWrite) return null;
    if (addingIn === key) {
      return (
        <div className="todo-col-addform">
          <input
            autoFocus
            className="cd-input"
            value={newTitle}
            placeholder="할 일 제목 — Enter 생성 · Esc 취소"
            aria-label="새 할 일 제목"
            disabled={busy}
            onChange={(e) => setNewTitle(e.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => onNewCardKey(e, columnId)}
          />
          <div className="todo-actions">
            <CdButton variant="primary" size="sm" loading={busy} onClick={() => void submitNewCard(columnId)}>
              추가
            </CdButton>
            <CdButton
              variant="ghost"
              size="sm"
              onClick={() => {
                setAddingIn(null);
                setNewTitle("");
              }}
            >
              취소
            </CdButton>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="todo-col-add"
        onClick={() => {
          setAddingIn(key);
          setNewTitle("");
        }}
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
        할 일 추가
      </button>
    );
  };

  const toneIndex = (col: TodoColumn) => allColumns.findIndex((c) => c.columnId === col.columnId);
  const projectTitle = board ? (board.kind === "personal" ? "개인 보드" : (board.projectName ?? board.name)) : "";
  const memberNames = members.map((m) => m.name).filter(Boolean);

  return (
    <div className="todo-canvas-body">
      {/* 보드 정보 행 */}
      {board && (
        <div className="todo-info" style={tintStyle(board.colorHex)}>
          <span className="todo-info-pj">
            <i className="todo-info-sq" aria-hidden="true" />
            <span>{projectTitle}</span>
          </span>
          {(board.clientName || board.contractId) && (
            <>
              <span className="todo-sep">·</span>
              <span>
                {board.clientName ? `발주처 ${board.clientName}` : ""}
                {board.clientName && board.contractId ? " · " : ""}
                {board.contractId ? `계약 ${contractShort(board.contractId)}` : ""}
              </span>
            </>
          )}
          {board.kind !== "personal" && (
            <>
              <span className="todo-sep">·</span>
              <span>{memberNames.length ? `멤버 ${memberNames.slice(0, 6).join(", ")}${memberNames.length > 6 ? ` 외 ${memberNames.length - 6}` : ""}` : `멤버 ${board.memberCount}`}</span>
            </>
          )}
          <span className="todo-spacer" />
          {board.columnStatusMap && <span>열을 옮기면 상태가 함께 바뀝니다</span>}
          {hasAnyCompleteRule(board.defaultCompleteRules) && <span title="이 보드에서 만드는 할 일에 물려주는 완료 조건">기본 완료 조건 {completeRulesSummary(board.defaultCompleteRules)}</span>}
          {board.kind !== "personal" && (
            <button type="button" className="todo-link" onClick={onManageMembers}>
              멤버 관리
            </button>
          )}
          {canManage && (
            <CdDropdown
              menuWidthClass="w-52"
              trigger={() => (
                <button type="button" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center" aria-label="보드 메뉴">
                  <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              items={[
                { key: "rules", label: "기본 완료 조건…", onSelect: () => setRulesOpen(true) },
                ...(board.kind !== "personal" ? [{ key: "members", label: "멤버 관리", onSelect: onManageMembers }] : []),
              ]}
            />
          )}
        </div>
      )}

      <div className="todo-sr-only" aria-live="polite">
        {live}
      </div>

      {!board ? (
        <CdEmptyState title="보드가 없습니다" description="보드 목록을 불러오는 중이거나 접근할 수 있는 보드가 없습니다." />
      ) : (
        <DragDropContext onDragEnd={(r) => void onDragEnd(r)}>
          <Droppable droppableId="board" direction="horizontal" type="column" isDropDisabled={!canManage}>
            {(bp) => (
              <div ref={bp.innerRef} {...bp.droppableProps} className="todo-board" aria-label="칸반 보드" aria-busy={loading || undefined}>
                {(cardsByCol.get(NONE_COL)?.length ?? 0) > 0 && (
                  <section className="todo-col" aria-label="열 미배정">
                    <div className="todo-colh">
                      <span className="todo-col-chip" data-tone="todo">열 미배정</span>
                      <span className="todo-col-n">{cardsByCol.get(NONE_COL)?.length ?? 0}</span>
                    </div>
                    {renderCards(null, NONE_COL)}
                    {renderAdd(null)}
                  </section>
                )}
                {columns.map((col, idx) => {
                  const cards = cardsByCol.get(col.columnId) ?? [];
                  const over = col.wipLimit != null && cards.length > col.wipLimit;
                  const tone = columnTone(col, toneIndex(col));
                  const isFold = isFoldedColumn(col);
                  return (
                    <Draggable key={col.columnId} draggableId={`col-${col.columnId}`} index={idx} isDragDisabled={!canManage}>
                      {(cp) => (
                        <section ref={cp.innerRef} {...cp.draggableProps} className="todo-col" data-collapsed={col.collapsed ? "true" : undefined} aria-label={col.name}>
                          {col.collapsed ? (
                            <>
                              <CdIconButton label={`${col.name} 열 펼치기`} size="sm" disabled={!canManage} onClick={() => void columnsApi("PATCH", { columnId: col.columnId, collapsed: false })}>
                                <ChevronRight className="w-4 h-4" aria-hidden="true" />
                              </CdIconButton>
                              <div className="todo-col-vname" {...cp.dragHandleProps}>
                                {col.name}
                              </div>
                              <span className="todo-col-n">{cards.length}</span>
                            </>
                          ) : (
                            <>
                              <div className="todo-colh" {...cp.dragHandleProps}>
                                <span className="todo-col-chip" data-tone={tone} title={col.statusMap && board.columnStatusMap ? `→ ${TODO_STATUS_LABELS[col.statusMap]}` : undefined}>
                                  {col.name}
                                </span>
                                <span className="todo-col-n">{cards.length}</span>
                                {over && <span className="todo-col-lim">권장 {col.wipLimit}건 초과</span>}
                                <span className="todo-col-dots">
                                  <CdDropdown
                                    menuWidthClass="w-52"
                                    trigger={() => (
                                      <button type="button" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center" aria-label={`${col.name} 열 메뉴`}>
                                        <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                                      </button>
                                    )}
                                    items={[
                                      { key: "edit", label: "이름 변경 · 상태 매핑 · WIP", disabled: !canManage, onSelect: () => setColEdit(col) },
                                      ...(isFold
                                        ? [{ key: "fold", label: "아래 접힘 행으로", onSelect: () => setUnfolded((s) => { const n = new Set(s); n.delete(col.columnId); return n; }) }]
                                        : [{ key: "collapse", label: "접기", disabled: !canManage, onSelect: () => void columnsApi("PATCH", { columnId: col.columnId, collapsed: true }) }]),
                                      { key: "delete", label: "삭제", danger: true, disabled: !canManage, onSelect: () => setColDelete(col) },
                                    ]}
                                  />
                                </span>
                              </div>
                              {renderCards(col.columnId, col.columnId)}
                              {renderAdd(col.columnId)}
                            </>
                          )}
                        </section>
                      )}
                    </Draggable>
                  );
                })}
                {bp.placeholder}
                {canManage &&
                  (addingCol ? (
                    <div className="todo-addcol-form">
                      <input
                        autoFocus
                        className="cd-input"
                        value={newColName}
                        placeholder="열 이름 — Enter 추가 · Esc 취소"
                        aria-label="새 열 이름"
                        onChange={(e) => setNewColName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void submitNewCol();
                          } else if (e.key === "Escape") {
                            setAddingCol(false);
                            setNewColName("");
                          }
                        }}
                      />
                      <div className="todo-actions flex gap-1.5">
                        <CdButton variant="primary" size="sm" loading={busy} onClick={() => void submitNewCol()}>
                          추가
                        </CdButton>
                        <CdButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAddingCol(false);
                            setNewColName("");
                          }}
                        >
                          취소
                        </CdButton>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="todo-addcol" onClick={() => setAddingCol(true)}>
                      <Plus className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />열 추가
                    </button>
                  ))}
                {!loaded && loading && <div className="todo-loading">불러오는 중…</div>}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* 완료·보류 접힘 행 */}
      {board && folded.length > 0 && (
        <div className="todo-folded" aria-label="접힌 열">
          {folded.map((col) => {
            const cards = cardsByCol.get(col.columnId) ?? [];
            const recent = col.statusMap === "done" || /완료/.test(col.name) ? [...cards].sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))[0] : null;
            return (
              <span key={col.columnId}>
                <span className="todo-col-chip" data-tone={columnTone(col, toneIndex(col))}>
                  {col.name}
                </span>
                {cards.length}
                {recent && (
                  <span className="todo-mu">
                    · 최근 {recent.assigneeName ?? recent.ownerName ?? ""} ‘{recent.title}’ {relativeTime(recent.completedAt ?? recent.updatedAt)}
                  </span>
                )}
              </span>
            );
          })}
          <span className="todo-spacer" />
          {folded.map((col) => (
            <button key={`open-${col.columnId}`} type="button" className="todo-link" onClick={() => setUnfolded((s) => new Set(s).add(col.columnId))}>
              {col.name} 펼치기
            </button>
          ))}
        </div>
      )}

      {colEdit && (
        <ColumnEditModal
          column={colEdit}
          busy={busy}
          onClose={() => setColEdit(null)}
          onSave={async (patch) => {
            const b = await columnsApi("PATCH", { columnId: colEdit.columnId, ...patch });
            if (b) setColEdit(null);
          }}
        />
      )}
      {board && rulesOpen && <BoardRulesModal board={board} busy={busy} onClose={() => setRulesOpen(false)} onSave={saveDefaultRules} />}
      <CdModal
        open={!!colDelete}
        onClose={() => setColDelete(null)}
        title="열 삭제"
        size="sm"
        footer={
          <>
            <CdButton variant="ghost" onClick={() => setColDelete(null)}>
              취소
            </CdButton>
            <CdButton
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (!colDelete) return;
                const b = await columnsApi("DELETE", undefined, `columnId=${encodeURIComponent(colDelete.columnId)}`);
                if (b) setColDelete(null);
              }}
            >
              삭제
            </CdButton>
          </>
        }
      >
        <p className="text-sm cd-text">
          '{colDelete?.name}' 열을 삭제합니다. 열에 있던 할 일 {cardsByCol.get(colDelete?.columnId ?? "")?.length ?? 0}건은 삭제되지 않고 '열 미배정'으로 남습니다.
        </p>
      </CdModal>
    </div>
  );
}

function ColumnEditModal({ column, busy, onClose, onSave }: { column: TodoColumn; busy: boolean; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(column.name);
  const [statusMap, setStatusMap] = useState<string>(column.statusMap ?? "");
  const [wip, setWip] = useState<string>(column.wipLimit != null ? String(column.wipLimit) : "");
  const [collapsed, setCollapsed] = useState(column.collapsed);
  const invalidWip = wip !== "" && (!/^\d+$/.test(wip) || Number(wip) < 1);
  return (
    <CdModal
      open
      onClose={onClose}
      title="열 설정"
      size="sm"
      footer={
        <>
          <CdButton variant="ghost" onClick={onClose}>
            취소
          </CdButton>
          <CdButton variant="primary" loading={busy} disabled={!name.trim() || invalidWip} onClick={() => void onSave({ name: name.trim(), statusMap: statusMap || null, wipLimit: wip === "" ? null : Number(wip), collapsed })}>
            저장
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <CdInput label="열 이름" required value={name} maxLength={40} onChange={(e) => setName(e.target.value)} error={!name.trim() ? "열 이름을 입력하세요." : undefined} />
        <CdSelect label="상태 매핑" hint="이 열에 놓인 할 일의 상태가 자동으로 바뀝니다(보드의 열↔상태 매핑이 켜진 경우). 완료·보류로 매핑한 열은 보드 아래 접힘 행으로 내려갑니다." value={statusMap} onChange={(e) => setStatusMap(e.target.value)}>
          <option value="">매핑 없음</option>
          {TODO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TODO_STATUS_LABELS[s]}
            </option>
          ))}
        </CdSelect>
        <CdInput label="WIP 권장 건수" hint="초과하면 열 헤더에 '권장 N건 초과' 라벨이 표시됩니다(이동은 막지 않음)." inputMode="numeric" value={wip} onChange={(e) => setWip(e.target.value)} error={invalidWip ? "1 이상의 정수를 입력하세요." : undefined} placeholder="없음" />
        <CdCheckbox label="열 접기" checked={collapsed} onChange={(e) => setCollapsed(e.target.checked)} />
      </div>
    </CdModal>
  );
}

/** 보드 ⋯ 메뉴 › 기본 완료 조건(276) — 이 보드에서 새로 만드는 할 일에 물려주는 완료 조건. 기존 할 일에는 소급하지 않는다. */
function BoardRulesModal({ board, busy, onClose, onSave }: { board: TodoBoard; busy: boolean; onClose: () => void; onSave: (rules: TodoCompleteRules) => Promise<void> }) {
  const [rules, setRules] = useState<TodoCompleteRules>(board.defaultCompleteRules);
  return (
    <CdModal
      open
      onClose={onClose}
      title="기본 완료 조건"
      size="sm"
      footer={
        <>
          <CdButton variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </CdButton>
          <CdButton variant="primary" loading={busy} onClick={() => void onSave(rules)}>
            저장
          </CdButton>
        </>
      }
    >
      <div className="todo-vars todo-modal">
        <p className="text-sm cd-text-muted">
          {board.kind === "personal" ? "개인 보드" : (board.projectName ?? board.name)}에서 새로 만드는 할 일에 자동으로 붙는 완료 조건입니다. 이미 있는 할 일은 상세의 '부가 설정 › 완료 조건'에서 따로 바꿉니다.
        </p>
        <CompleteRulesFields value={rules} hints onChange={setRules} />
      </div>
    </CdModal>
  );
}
