"use client";

// 내 할 일(목록, 시안 v4) — 열 머리글(업무·예정·마감·담당) + 그룹 헤더 44px(지연=파스텔 빨강 pill · 오늘=파스텔 파랑 pill + "10월 13일 월요일" + 건수) + 행.
// 섹션: 지연 · 오늘 · 내일 · 이번 주(남은 날짜 묶음) · 다음 주 이후(접힘) · 날짜 없음. 결재 일정은 같은 날짜 묶음에 틴트 행.
// 결재 대기(kind "pending" — 내가 결재할 차례, 2026-10-13)는 결재 일정 토글과 무관하게 "오늘" 그룹 맨 위(일정 결재 행보다 앞)에 두고,
//   헤더 건수에는 넣지 않되 헤더 우측에 "결재 대기 N" 보조 라벨로 보인다.
// 헤더 태그 버튼 필터(오늘·지연·이번 주)는 filter prop 으로 받아 섹션을 거른다. 키보드 ↑/↓·Space·Enter.
// 완료(2026-10-14): 완료 항목은 날짜 섹션에 넣지 않고 맨 아래 DoneSection("완료 N건 · 펼치기")에 모은다. 방금 완료된 행(justDoneIds)은
//   상위가 status 를 원복해 넘기므로 2초 동안 원래 섹션에 "완료됨 · 되돌리기"로 남는다.

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { CdButton, CdEmptyState } from "@/components/cdash";
import type { TodoApprovalEvent, TodoItem } from "@/lib/todo/types";
import { comparePosition } from "@/lib/todo/position";
import { ApprovalRow, TodoColumnHeader, TodoRow, type Density, type TimeCell } from "./TodoRow";
import { DoneSection } from "./DoneSection";
import { addDays, approvalSection, compareInSection, effectiveDate, longDateKo, md, sectionOf, weekEnd, type SectionKey, type SortMode } from "./todo-utils";

type Entry = { kind: "item"; item: TodoItem; date: string; time: string } | { kind: "ref"; ev: TodoApprovalEvent; date: string; time: string };

export type QuickFilter = "today" | "overdue" | "week" | null;

interface Group {
  key: string;
  /** pill(지연·오늘) 또는 일반 라벨 */
  label: string;
  pill?: "over" | "today";
  when?: string;
  timeCell: TimeCell;
  entries: Entry[];
}

/** 완료 섹션·유예 행 공용 prop(내 할 일·보드 목록·공유받음). */
export interface DoneListProps {
  /** 서버 완료 건수(보관 제외). */
  doneCount: number;
  /** 헤더 "완료 N" 태그 클릭 — 값이 바뀌면 완료 섹션을 펼치고 스크롤. */
  doneOpenRequest?: number;
  /** 2초 유예 중인 행 id — 상위가 status 를 원복해 items 에 남겨 둔다. */
  justDoneIds?: ReadonlySet<string>;
  onUndo?: (item: TodoItem) => void;
  onSettled?: (item: TodoItem) => void;
  onShowArchive?: () => void;
}

export interface MyTodoListProps extends DoneListProps {
  /** 미완 + 완료(status done) 항목을 함께 받는다 — 완료는 DoneSection 으로 분리한다. */
  items: TodoItem[];
  approvalEvents: TodoApprovalEvent[];
  showApproval: boolean;
  today: string;
  weekStart: 0 | 1;
  density: Density;
  sortMode: SortMode;
  selectedId: string | null;
  loaded: boolean;
  filter?: QuickFilter;
  /** 빈 상태 문구 덮어쓰기(맡긴 일 탭 등) */
  emptyTitle?: string;
  emptyDescription?: string;
  /** 열 머리글 아래 삽입(퀵애드 고스트 행) */
  top?: ReactNode;
  onOpen: (item: TodoItem) => void;
  onComplete: (item: TodoItem, done: boolean) => void | Promise<boolean | void>;
  onNew: () => void;
}

/** 리스트 컨테이너 키보드 — ↑/↓ 로 행 사이 포커스 이동. */
export function rowListKeyNav(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".todo-row[tabindex]"));
  if (!rows.length) return;
  const idx = rows.indexOf(document.activeElement as HTMLElement);
  e.preventDefault();
  const next = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
  rows[next]?.focus();
}

/** 그룹 헤더 — pill(지연/오늘) 또는 라벨 + 날짜 문구 + 건수(+ 결재 대기 N 보조 라벨, 건수에는 미포함). */
export function GroupHeader({ label, pill, when, count, pendingCount = 0, action }: { label: string; pill?: "over" | "today"; when?: string; count: number; pendingCount?: number; action?: ReactNode }) {
  return (
    <div className="todo-gh" data-tone={pill}>
      {pill ? (
        <span className="todo-pill" data-tone={pill}>
          {label}
        </span>
      ) : (
        <span>{label}</span>
      )}
      {when && <span className="todo-gh-w">{when}</span>}
      <span className="todo-gh-n">{count}</span>
      {pendingCount > 0 && (
        <span className="todo-gh-pend" title="내가 결재할 차례인 문서">
          결재 대기 {pendingCount}
        </span>
      )}
      {action}
    </div>
  );
}

export function MyTodoList({
  items,
  approvalEvents,
  showApproval,
  today,
  weekStart,
  density,
  sortMode,
  selectedId,
  loaded,
  filter = null,
  emptyTitle,
  emptyDescription,
  top,
  doneCount,
  doneOpenRequest,
  justDoneIds,
  onUndo,
  onSettled,
  onShowArchive,
  onOpen,
  onComplete,
  onNew,
}: MyTodoListProps) {
  const [showLater, setShowLater] = useState(false);

  const doneItems = useMemo(() => items.filter((i) => !i.parentItemId && i.status === "done"), [items]);
  const { groups, later, laterCount, pendingCount } = useMemo(() => {
    const entries: Entry[] = [];
    for (const it of items) {
      if (it.parentItemId || it.status === "done") continue;
      const date = effectiveDate(it);
      entries.push({ kind: "item", item: it, date: date ?? "", time: it.doTime ?? "~" });
    }
    // 결재 대기(내 차례)는 토글과 무관하게 항상 오늘 — 시각 "" 로 어떤 행보다 앞에 선다(서버 순서 = 긴급 → 상신 오래된 순 유지).
    const pending = approvalEvents.filter((ev) => ev.kind === "pending");
    for (const ev of pending) entries.push({ kind: "ref", ev, date: today, time: "" });
    if (showApproval) {
      for (const ev of approvalEvents) {
        if (ev.kind === "pending") continue;
        if (!approvalSection(ev, today, weekStart)) continue;
        entries.push({ kind: "ref", ev, date: ev.startDate < today ? today : ev.startDate, time: ev.startTime ?? "~" });
      }
    }
    const pendingOrder = new Map(pending.map((ev, i) => [ev.id, i]));
    const cmp = (a: Entry, b: Entry): number => {
      if (a.kind === "item" && b.kind === "item") {
        if (sortMode === "manual") return comparePosition(a.item.position, b.item.position);
        if (sortMode === "priority" && a.item.priority !== b.item.priority) return b.item.priority - a.item.priority;
        return compareInSection(a.item, b.item);
      }
      const ap = a.kind === "ref" && a.ev.kind === "pending";
      const bp = b.kind === "ref" && b.ev.kind === "pending";
      if (ap !== bp) return ap ? -1 : 1;
      if (ap && bp && a.kind === "ref" && b.kind === "ref") return (pendingOrder.get(a.ev.id) ?? 0) - (pendingOrder.get(b.ev.id) ?? 0);
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return a.kind === "ref" ? -1 : 1;
    };
    const we = weekEnd(today, weekStart);
    const tomorrow = addDays(today, 1);
    const bucket: Record<SectionKey, Entry[]> = { overdue: [], today: [], tomorrow: [], thisWeek: [], nextWeek: [], later: [], none: [] };
    for (const e of entries) bucket[sectionOf(e.date || null, today, weekStart)].push(e);
    for (const l of Object.values(bucket)) l.sort(cmp);
    const weekRange = tomorrow < we ? `${md(addDays(tomorrow, 1))} – ${md(we)}` : undefined;
    const countOf = (l: Entry[]) => l.filter((e) => e.kind === "item").length;
    const all: Group[] = [
      { key: "overdue", label: "지연", pill: "over", timeCell: "date", entries: bucket.overdue },
      { key: "today", label: "오늘", pill: "today", when: longDateKo(today), timeCell: "time", entries: bucket.today },
      { key: "tomorrow", label: "내일", when: longDateKo(tomorrow), timeCell: "time", entries: bucket.tomorrow },
      { key: "thisWeek", label: "이번 주", when: weekRange, timeCell: "date", entries: bucket.thisWeek },
      { key: "none", label: "날짜 없음", timeCell: "none", entries: bucket.none },
    ];
    const laterEntries = [...bucket.nextWeek, ...bucket.later].sort(cmp);
    const later: Group = { key: "later", label: "다음 주 이후", timeCell: "date", entries: laterEntries };
    const visible = all.filter((g) => {
      if (filter === "today") return g.key === "today";
      if (filter === "overdue") return g.key === "overdue";
      if (filter === "week") return g.key === "today" || g.key === "tomorrow" || g.key === "thisWeek";
      // 지연·날짜 없음은 비어 있으면 숨기고, 오늘은 항상, 내일·이번 주는 비어 있으면 숨긴다
      if (g.key === "today") return true;
      return g.entries.length > 0;
    });
    return { groups: visible, later, laterCount: countOf(laterEntries), pendingCount: pending.length };
  }, [items, approvalEvents, showApproval, today, weekStart, sortMode, filter]);

  const doneSection = (
    <DoneSection items={doneItems} count={doneCount} today={today} density={density} selectedId={selectedId} openRequest={doneOpenRequest} onOpen={onOpen} onComplete={onComplete} onShowArchive={onShowArchive} />
  );

  const total = items.filter((i) => !i.parentItemId && i.status !== "done").length;
  if (loaded && total === 0 && pendingCount === 0 && (!showApproval || approvalEvents.length === 0)) {
    return (
      <div className="todo-canvas-body" onKeyDown={rowListKeyNav}>
        <TodoColumnHeader />
        {top}
        <CdEmptyState
          icon={<ListChecks className="w-6 h-6" />}
          title={emptyTitle ?? "할 일이 없습니다"}
          description={emptyDescription ?? "위 '할 일 추가' 줄에 한 줄로 적고 Enter 를 누르면 바로 추가됩니다. 날짜·시각·!우선순위·@담당을 같이 적을 수 있습니다."}
          action={
            <CdButton variant="primary" size="sm" onClick={onNew}>
              새 할 일
            </CdButton>
          }
        />
        {doneSection}
      </div>
    );
  }

  const renderEntries = (g: Group) =>
    g.entries.map((e) =>
      e.kind === "item" ? (
        <TodoRow
          key={e.item.itemId}
          item={e.item}
          today={today}
          density={density}
          selected={selectedId === e.item.itemId}
          timeCell={g.timeCell}
          justDone={justDoneIds?.has(e.item.itemId)}
          onOpen={onOpen}
          onComplete={onComplete}
          onUndo={onUndo}
          onSettled={onSettled}
        />
      ) : (
        <ApprovalRow key={`ref-${e.ev.id}`} event={e.ev} today={today} density={density} timeCell={g.timeCell === "none" ? "date" : g.timeCell} />
      )
    );

  return (
    <div className="todo-canvas-body" onKeyDown={rowListKeyNav}>
      <TodoColumnHeader />
      {top}
      {groups.map((g) => (
        <div key={g.key} className="todo-rows" aria-label={g.label}>
          <GroupHeader label={g.label} pill={g.pill} when={g.when} count={g.entries.filter((e) => e.kind === "item").length} pendingCount={g.key === "today" ? pendingCount : 0} />
          {g.entries.length ? renderEntries(g) : <div className="todo-empty">{g.key === "today" ? "오늘 할 일이 없습니다." : "예정된 업무가 없습니다."}</div>}
        </div>
      ))}
      {!filter && (
        <div className="todo-rows" aria-label="다음 주 이후">
          <GroupHeader
            label="다음 주 이후"
            count={laterCount}
            action={
              laterCount > 0 ? (
                <button type="button" className="todo-tbtn" onClick={() => setShowLater((v) => !v)} aria-expanded={showLater}>
                  {showLater ? "접기" : "펼치기"}
                  {showLater ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                </button>
              ) : undefined
            }
          />
          {showLater && laterCount > 0 ? renderEntries(later) : <div className="todo-empty">{laterCount > 0 ? `${laterCount}건이 접혀 있습니다.` : "예정된 업무가 없습니다."}</div>}
        </div>
      )}
      {doneSection}
    </div>
  );
}
