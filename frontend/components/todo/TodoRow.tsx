"use client";

// 할 일 행(내 할 일·공유받음·보드 목록 공용, 시안 v4) + 결재 일정 읽기 전용 행 + 열 머리글 + 체크 원·라벨 조각.
// 행 58px: 좌측 4px 파스텔 띠(--todo-tint = item.boardColor) · 체크 원 18px 중립색 · 제목 15px(앞에 높음/낮음 라벨) · 둘째 줄 맥락(색 점 + 용역명 · 발주처 ·
// 하위 미니 분절 바 · 댓글) · 예정 열 · 마감 열(지연/오늘 파스텔 라벨) · 담당(사진 아바타 20px) · 액션. 결재 행은 체크 대신 24px 파스텔 원 아이콘 + 종류 칩 + "문서 열기".
// 완료 애니메이션(§7.5): 체크 원 채움(120ms) → 행 opacity/height 0(240ms) → 제거. prefers-reduced-motion 이면 즉시. 시각 규칙은 todo.css 의 todo-* 에만 둔다.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, MessageSquare } from "lucide-react";
import { CdAvatar } from "@/components/cdash";
import type { TodoApprovalEvent, TodoItem, TodoLinkKind, TodoPriority } from "@/lib/todo/types";
import { TODO_APPROVAL_EVENT_LABELS, TODO_LINK_KIND_LABELS } from "@/lib/todo/types";
import { describeRecurrence } from "@/lib/todo/recurrence";
import { approvalKindIcon, contextParts, dueBadge, md, pendingAgeDays, pendingContextParts, prefersReducedMotion, weekdayKo, type DueBadge } from "./todo-utils";

export type Density = "comfortable" | "compact";
export type TimeCell = "time" | "date" | "none";

export const tintStyle = (hex: string | null | undefined): CSSProperties | undefined => (hex ? ({ "--todo-tint": hex } as CSSProperties) : undefined);

// ── 조각 ──
export function TodoCheck({
  done,
  size = "md",
  label,
  onClick,
  filled,
  dashed,
  state,
}: {
  /** v4: 체크 원은 중립색 — 우선순위는 제목 앞 라벨로만. (호환용으로 받되 쓰지 않는다) */
  priority?: TodoPriority;
  done: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** 애니메이션 중 채움 상태 */
  filled?: boolean;
  /** 추가 행 자리표시(점선) */
  dashed?: boolean;
  /** 하위 작업 행 — 완료(초록 채움)·진행 중(파스텔 파랑) */
  state?: "done" | "doing";
}) {
  const isDone = done || !!filled;
  return (
    <button
      type="button"
      className="todo-check"
      data-done={isDone && !state ? "true" : undefined}
      data-state={state}
      data-size={size === "md" ? undefined : size}
      data-dashed={dashed ? "true" : undefined}
      aria-label={label ?? (done ? "완료 되돌리기" : "완료")}
      aria-pressed={done}
      onClick={onClick}
      tabIndex={dashed ? -1 : undefined}
      aria-hidden={dashed || undefined}
    >
      {(isDone || state === "done") && <Check strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

/** 우선순위 라벨 — 높음(파스텔 빨강)·낮음(회색)만, 보통·없음은 표시하지 않는다. */
export function PriorityLabel({ priority }: { priority: TodoPriority }) {
  if (priority === 3) return <span className="todo-lv" data-level="hi">높음</span>;
  if (priority === 1) return <span className="todo-lv" data-level="lo">낮음</span>;
  return null;
}

/** 마감 라벨 — 지연 파스텔 빨강 "M/D · N일 지남", 오늘 파스텔 주황 "오늘", 그 외 날짜 + 요일(small). */
export function DueCell({ badge, dueDate }: { badge: DueBadge | null; dueDate: string | null }) {
  if (!badge || !dueDate) return <span className="todo-mu">—</span>;
  if (badge.tone === "over") return <span className="todo-due" data-tone="over">{badge.label}</span>;
  if (badge.tone === "today") return <span className="todo-due" data-tone="today">오늘</span>;
  return (
    <>
      {md(dueDate)}
      <span className="todo-sm">{weekdayKo(dueDate)}요일</span>
    </>
  );
}

/** 칸반 카드용 짧은 마감 — 지연/오늘 라벨, 그 외 M/D 텍스트. */
export function DueText({ badge }: { badge: DueBadge | null }) {
  if (!badge) return null;
  if (badge.tone === "over") return <span className="todo-due" data-tone="over">{badge.label}</span>;
  if (badge.tone === "today") return <span className="todo-due" data-tone="today">오늘</span>;
  return <span>{badge.label}</span>;
}

/** 하위 작업 미니 분절 바 n/m (완료 초록·미완 경계색). 7개 초과면 7칸으로 압축. */
export function MiniSegments({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const n = Math.min(total, 7);
  const filled = Math.round((done / total) * n);
  return (
    <span className="todo-sub" title="하위 작업">
      <span className="todo-mini" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <i key={i} data-d={i < filled ? "true" : undefined} />
        ))}
      </span>
      {done}/{total}
    </span>
  );
}

/** 담당 — 사진 아바타 20px + 이름, 없으면 점선 원 "담당 없음". */
export function Assignee({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  if (!name) {
    return (
      <span className="todo-who" data-none="true">
        <span className="todo-av inline-flex rounded-full" aria-hidden="true" />
        <span>담당 없음</span>
      </span>
    );
  }
  return (
    <span className="todo-who">
      <CdAvatar name={name} src={photoUrl} size="xs" className="todo-av" />
      <span>{name}</span>
    </span>
  );
}

/** 열 머리글(업무·예정·마감·담당). */
export function TodoColumnHeader() {
  return (
    <div className="todo-th" aria-hidden="true">
      <span className="todo-c-ck" />
      <span className="todo-c-t">업무</span>
      <span className="todo-c-do">예정</span>
      <span className="todo-c-due">마감</span>
      <span className="todo-c-who">담당</span>
      <span className="todo-c-act" />
    </div>
  );
}

/** 연결 대상 열기 링크 — 기존 화면 query 관례(focus·docId). */
export function linkHref(kind: TodoLinkKind | null, id: string | null): string | null {
  if (!kind) return null;
  const q = encodeURIComponent(id ?? "");
  switch (kind) {
    case "contract":
      return id ? `/contracts?focus=${q}` : "/contracts";
    case "facility":
      return id ? `/facilities?focus=${q}` : "/facilities";
    case "sales_project":
      return id ? `/sales/${q}` : "/sales";
    case "approval_doc":
      return id ? `/approval?docId=${q}` : "/approval";
    case "work_task":
    case "directive":
      return id ? `/work-plan?focus=${q}` : "/work-plan";
    case "url":
      return id && /^https?:\/\//i.test(id) ? id : null;
  }
}

/** "계약 · 대한화학" 식 연결 문구 */
export function linkText(kind: TodoLinkKind | null, label: string | null): string | null {
  if (!kind) return null;
  const k = TODO_LINK_KIND_LABELS[kind];
  return label ? `${k} · ${label}` : k;
}

/** 예정 열 — 같은 날 묶음이면 시각(종일은 muted "종일"), 날짜 묶음이면 M/D, 없으면 "—". */
function doCellText(item: TodoItem, timeCell: TimeCell): ReactNode {
  const date = item.doDate ?? null;
  if (timeCell === "time") {
    if (item.doTime) return item.doTime;
    return <span className="todo-mu">{date || item.dueDate ? "종일" : "—"}</span>;
  }
  if (timeCell === "date") return date ? md(date) : <span className="todo-mu">—</span>;
  return <span className="todo-mu">—</span>;
}

// ── 할 일 행 ──
export interface TodoRowProps {
  item: TodoItem;
  today: string;
  density?: Density;
  selected?: boolean;
  /** 예정 열 — 같은 날 묶음이면 시각(종일은 '종일'), 아니면 M/D */
  timeCell?: TimeCell;
  /** 완료 체크 뒤 행을 목록에서 제거할지(완료 숨김 켜짐) */
  removeOnComplete?: boolean;
  /** 맥락 줄 보조 문구(예: "김민수와 공유") */
  trailing?: ReactNode;
  onOpen: (item: TodoItem) => void;
  onComplete: (item: TodoItem, done: boolean) => void;
}

export function TodoRow({ item, today, density = "comfortable", selected, timeCell = "time", removeOnComplete = true, trailing, onOpen, onComplete }: TodoRowProps) {
  const [phase, setPhase] = useState<"idle" | "checked" | "leaving">("idle");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const done = item.status === "done";

  const toggle = (e?: MouseEvent | KeyboardEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (phase !== "idle") return;
    if (done) {
      onComplete(item, false);
      return;
    }
    if (prefersReducedMotion()) {
      onComplete(item, true);
      return;
    }
    setPhase("checked");
    timers.current.push(
      window.setTimeout(() => {
        if (!removeOnComplete) {
          setPhase("idle");
          onComplete(item, true);
          return;
        }
        setPhase("leaving");
        timers.current.push(
          window.setTimeout(() => {
            setPhase("idle");
            onComplete(item, true);
          }, 240)
        );
      }, 120)
    );
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === " ") toggle(e);
    else if (e.key === "Enter") {
      e.preventDefault();
      onOpen(item);
    }
  };

  const badge = dueBadge(item, today, true);
  const ctx = contextParts(item);
  const rec = describeRecurrence(item.recurrence);

  return (
    <div
      className="todo-row"
      role="button"
      tabIndex={0}
      data-todo-row={item.itemId}
      data-density={density === "compact" ? "compact" : undefined}
      data-selected={selected ? "true" : undefined}
      data-leaving={phase === "leaving" ? "true" : undefined}
      aria-label={item.title}
      style={tintStyle(item.boardColor)}
      onClick={() => onOpen(item)}
      onKeyDown={onKey}
    >
      <span className="todo-c-ck">
        <TodoCheck done={done} filled={phase !== "idle"} onClick={toggle} />
      </span>
      <div className="todo-c-t">
        <div className="todo-ttl" data-done={done ? "true" : undefined}>
          <PriorityLabel priority={item.priority} />
          <span>{item.title}</span>
        </div>
        {!done && (
          <div className="todo-ctx">
            <span className="todo-dot" aria-hidden="true" />
            <span className="todo-ctx-txt">{ctx.primary}</span>
            {ctx.client && (
              <>
                <span className="todo-sep">·</span>
                <span className="todo-ctx-txt">{ctx.client}</span>
              </>
            )}
            {rec && (
              <>
                <span className="todo-sep">·</span>
                <span className="todo-ctx-txt">{rec} 반복</span>
              </>
            )}
            {trailing && (
              <>
                <span className="todo-sep">·</span>
                <span className="todo-ctx-txt">{trailing}</span>
              </>
            )}
            {item.subtaskTotal > 0 && (
              <>
                <span className="todo-sep">·</span>
                <MiniSegments done={item.subtaskDone} total={item.subtaskTotal} />
              </>
            )}
            {item.commentCount > 0 && (
              <>
                <span className="todo-sep">·</span>
                <span className="todo-sub" title="댓글">
                  <MessageSquare aria-hidden="true" />
                  댓글 {item.commentCount}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="todo-c-do todo-cell">{done && item.doTime ? <span className="todo-mu">{item.doTime}</span> : doCellText(item, timeCell)}</div>
      <div className="todo-c-due todo-cell">{done ? <span className="todo-mu">{item.dueDate ? md(item.dueDate) : "—"}</span> : <DueCell badge={badge} dueDate={item.dueDate} />}</div>
      <div className="todo-c-who">
        <Assignee name={item.assigneeName} photoUrl={item.assigneePhotoUrl} />
      </div>
      <div className="todo-c-act">
        {done && (
          <>
            <span className="todo-mu">완료 · </span>
            <button type="button" onClick={toggle}>
              되돌리기
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 결재 대기 행(내가 결재할 차례, 2026-10-13) — 체크 없음, Stamp 아이콘 + "결재 대기" 칩, 맥락 "기안자 · 양식명 · 문서번호 · 상신 M/D(HH:mm)",
//    예정 "—", 마감 = 상신 후 2일 이상이면 "D+N"(파스텔 주황), 담당 = 기안자 아바타, 액션 "결재하기" → /approval?docId=.
export function PendingApprovalRow({ event, today, density = "comfortable" }: { event: TodoApprovalEvent; today: string; density?: Density }) {
  const href = event.docId ? `/approval?docId=${encodeURIComponent(event.docId)}` : null;
  const label = TODO_APPROVAL_EVENT_LABELS.pending;
  const Icon = approvalKindIcon("pending");
  const age = pendingAgeDays(event.submittedAt, today);
  const ctxParts = [...(event.projectName ? [event.projectName] : []), ...(event.clientName ? [event.clientName] : []), ...pendingContextParts(event)];
  return (
    <div className="todo-row" data-ref="true" data-pending="true" data-density={density === "compact" ? "compact" : undefined} style={tintStyle(event.kindColor)} aria-label={`${label} ${event.title}`}>
      <span className="todo-c-ck">
        <span className="todo-doc" aria-hidden="true">
          <Icon strokeWidth={2.2} />
        </span>
      </span>
      <div className="todo-c-t">
        <div className="todo-ttl">
          <span className="todo-stag">{label}</span>
          <span>{event.title}</span>
        </div>
        {ctxParts.length > 0 && (
          <div className="todo-ctx">
            <span className="todo-dot" aria-hidden="true" />
            {ctxParts.map((p, i) => (
              <span key={i} className="contents">
                {i > 0 && <span className="todo-sep">·</span>}
                <span className="todo-ctx-txt">{p}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="todo-c-do todo-cell">
        <span className="todo-mu">—</span>
      </div>
      <div className="todo-c-due todo-cell">
        {age != null && age >= 2 ? (
          <span className="todo-due" data-tone="today" title="상신 후 경과일">
            D+{age}
          </span>
        ) : (
          <span className="todo-mu">—</span>
        )}
      </div>
      <div className="todo-c-who">{event.drafterName ? <Assignee name={event.drafterName} photoUrl={event.drafterPhotoUrl} /> : <span className="todo-mu">—</span>}</div>
      <div className="todo-c-act">{href && <Link href={href}>결재하기</Link>}</div>
    </div>
  );
}

// ── 결재 일정 읽기 전용 행 ──
export function ApprovalRow({ event, today, density = "comfortable", timeCell = "time" }: { event: TodoApprovalEvent; today?: string; density?: Density; timeCell?: TimeCell }) {
  if (event.kind === "pending") return <PendingApprovalRow event={event} today={today ?? event.startDate} density={density} />;
  const href = event.docId ? `/approval?docId=${encodeURIComponent(event.docId)}` : null;
  const label = TODO_APPROVAL_EVENT_LABELS[event.kind] ?? event.kind;
  const Icon = approvalKindIcon(event.kind);
  const period = event.startDate === event.endDate ? (event.startTime && event.endTime ? `${event.startTime} – ${event.endTime}` : null) : `${md(event.startDate)} – ${md(event.endDate)}`;
  const status = event.status === "approved" ? "결재 승인" : event.status === "in_progress" ? "결재 진행" : null;
  const when = timeCell === "date" ? md(event.startDate) : event.startTime ? event.startTime : <span className="todo-mu">종일</span>;
  return (
    <div className="todo-row" data-ref="true" data-density={density === "compact" ? "compact" : undefined} style={tintStyle(event.kindColor)} aria-label={`${label} ${event.title}`}>
      <span className="todo-c-ck">
        <span className="todo-doc" aria-hidden="true">
          <Icon strokeWidth={2.2} />
        </span>
      </span>
      <div className="todo-c-t">
        <div className="todo-ttl">
          <span className="todo-stag">{label}</span>
          <span>{event.title}</span>
        </div>
        <div className="todo-ctx">
          <span className="todo-dot" aria-hidden="true" />
          {event.projectName && <span className="todo-ctx-txt">{event.projectName}</span>}
          {event.clientName && (
            <>
              {event.projectName && <span className="todo-sep">·</span>}
              <span className="todo-ctx-txt">{event.clientName}</span>
            </>
          )}
          {status && (
            <>
              {(event.projectName || event.clientName) && <span className="todo-sep">·</span>}
              <span className="todo-ctx-txt">
                {status}
                {period ? ` · ${period}` : ""}
              </span>
            </>
          )}
          {!status && period && <span className="todo-ctx-txt">{period}</span>}
        </div>
      </div>
      <div className="todo-c-do todo-cell">{when}</div>
      <div className="todo-c-due todo-cell">
        <span className="todo-mu">—</span>
      </div>
      <div className="todo-c-who">{event.drafterName ? <Assignee name={event.drafterName} photoUrl={null} /> : <span className="todo-mu">—</span>}</div>
      <div className="todo-c-act">{href && <Link href={href}>문서 열기</Link>}</div>
    </div>
  );
}
