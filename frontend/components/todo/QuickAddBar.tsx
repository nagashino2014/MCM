"use client";

// 퀵애드(§7.4, 시안 v2) — 리스트 첫 줄의 고스트 행("+ 할 일 추가"). 클릭/`N` 으로 인라인 입력으로 전환.
// lib/todo/quick-parse.ts 를 입력 변경마다 실행(IME 조합 중 보류)해 아래 칩으로 미리보기. 칩 × 로 해제하면 그 토큰은
// 제목에 남는다(해제 목록은 kind|text 로 보관해 재파싱에서 제외). Enter → POST /api/todo/items.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, Flag, LayoutGrid, Plus, Repeat, StickyNote, User, X } from "lucide-react";
import { useCdToast } from "@/components/cdash";
import { useOrgSnapshot } from "@/components/calendar/AttendeePicker";
import { parseQuickAdd, type QuickParseResult, type QuickToken } from "@/lib/todo/quick-parse";
import { describeRecurrence } from "@/lib/todo/recurrence";
import { TODO_PRIORITY_LABELS, type TodoBoard, type TodoItemDetail, type TodoPrefs, type TodoPriority } from "@/lib/todo/types";
import { localToday, md, weekdayKo } from "./todo-utils";

export interface QuickAddBarProps {
  boards: TodoBoard[];
  currentBoardId: string | null;
  currentColumnId?: string | null;
  prefs: TodoPrefs | null;
  onCreate: (input: Record<string, unknown>) => Promise<TodoItemDetail | null>;
  /** 값이 바뀔 때마다 입력을 열고 포커스(N 키·새 할 일 버튼·?new=1) */
  openRequest?: number;
  placeholder?: string;
}

const tokenKey = (t: QuickToken) => `${t.kind}|${t.text}`;

/** 해제된 토큰을 제외하고 제목·필드를 다시 조립(파서의 제목 규칙과 동일). */
function applyDismissed(text: string, parsed: QuickParseResult, dismissed: Set<string>, today: string): QuickParseResult {
  if (!dismissed.size) return parsed;
  const active = parsed.tokens.filter((t) => !dismissed.has(tokenKey(t))).sort((a, b) => a.start - b.start);
  let title = "";
  let cursor = 0;
  for (const t of active) {
    title += text.slice(cursor, t.start) + " ";
    cursor = t.end;
  }
  title += text.slice(cursor);
  const has = (kind: QuickToken["kind"]) => active.some((t) => t.kind === kind);
  return {
    ...parsed,
    tokens: active,
    title: title.replace(/\s+/g, " ").replace(/^[\s~,.·-]+|[\s~,.·-]+$/g, "").trim(),
    doDate: has("do_date") ? parsed.doDate : has("do_time") ? today : null,
    doTime: has("do_time") ? parsed.doTime : null,
    dueDate: has("due_date") ? parsed.dueDate : null,
    recurrence: has("recurrence") ? parsed.recurrence : null,
    priority: has("priority") ? parsed.priority : null,
    boardToken: has("board") ? parsed.boardToken : null,
    assigneeToken: has("assignee") ? parsed.assigneeToken : null,
    note: has("note") ? parsed.note : null,
  };
}

export function QuickAddBar({ boards, currentBoardId, currentColumnId, prefs, onCreate, openRequest, placeholder }: QuickAddBarProps) {
  const { toast } = useCdToast();
  const ref = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<QuickParseResult | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [assigneePick, setAssigneePick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const composing = useRef(false);
  const parseOn = prefs?.quickAddParse !== false;
  const weekStart = prefs?.weekStart ?? 1;
  const snapshot = useOrgSnapshot(parseOn && open);

  const runParse = useCallback(
    (value: string, dis: Set<string>) => {
      if (!parseOn || !value.trim()) {
        setParsed(null);
        return;
      }
      const today = localToday();
      setParsed(applyDismissed(value, parseQuickAdd(value, { today, weekStart }), dis, today));
    },
    [parseOn, weekStart]
  );

  useEffect(() => {
    if (!openRequest) return;
    setOpen(true);
    const t = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [openRequest]);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  // ── 토큰 → 보드/열·담당 매핑 ──
  const boardMatch = useMemo(() => {
    const tok = parsed?.boardToken?.trim().toLowerCase();
    if (!tok) return null;
    const cur = boards.find((b) => b.boardId === currentBoardId);
    const col = cur?.columns.find((c) => c.name.toLowerCase() === tok) ?? cur?.columns.find((c) => c.name.toLowerCase().includes(tok));
    if (col && cur) return { kind: "column" as const, boardId: cur.boardId, columnId: col.columnId, label: `열 ${col.name}` };
    const b = boards.find((x) => x.name.toLowerCase() === tok) ?? boards.find((x) => x.name.toLowerCase().includes(tok));
    if (b) return { kind: "board" as const, boardId: b.boardId, columnId: null, label: `보드 ${b.name}` };
    return { kind: "none" as const, boardId: null, columnId: null, label: `#${parsed?.boardToken} 일치 없음` };
  }, [parsed?.boardToken, boards, currentBoardId]);

  const assigneeCandidates = useMemo(() => {
    const tok = parsed?.assigneeToken?.trim();
    if (!tok || !snapshot) return [];
    const list = snapshot.employees.filter((e) => e.userId && e.status === "active");
    const exact = list.filter((e) => e.name === tok);
    const pool = exact.length ? exact : list.filter((e) => e.name.startsWith(tok));
    return pool.map((e) => ({ userId: e.userId as string, name: e.name, positionName: e.positionName }));
  }, [parsed?.assigneeToken, snapshot]);

  useEffect(() => {
    setAssigneePick(assigneeCandidates.length === 1 ? assigneeCandidates[0].userId : "");
  }, [assigneeCandidates]);

  const assigneeUserId = assigneeCandidates.length === 1 ? assigneeCandidates[0].userId : assigneePick || null;

  const onChange = (value: string) => {
    setText(value);
    if (composing.current) return;
    runParse(value, dismissed);
  };

  const dismiss = (t: QuickToken) => {
    const next = new Set(dismissed);
    next.add(tokenKey(t));
    setDismissed(next);
    runParse(text, next);
    ref.current?.focus();
  };

  const reset = () => {
    setText("");
    setParsed(null);
    setDismissed(new Set());
  };

  const submit = async () => {
    const today = localToday();
    const base = parseOn ? (parsed ?? applyDismissed(text, parseQuickAdd(text, { today, weekStart }), dismissed, today)) : null;
    const title = (base ? base.title : text).trim();
    if (!title || busy) return;
    // 출장·초과근무는 To-do 에서 만들지 않는다(§19-5) — 전자결재 기안 링크만 안내하고 입력은 유지한다.
    if (/^(출장|초과근무)/.test(text.trim())) {
      toast(
        <span className="inline-flex items-center gap-2">
          출장·초과근무는 전자결재에서 기안합니다
          <Link href="/approval" className="underline font-medium">
            전자결재로
          </Link>
        </span>,
        "info",
        6000
      );
      return;
    }
    const body: Record<string, unknown> = { title };
    const boardId = boardMatch?.boardId ?? currentBoardId ?? undefined;
    if (boardId) body.boardId = boardId;
    const columnId = boardMatch?.kind === "column" ? boardMatch.columnId : boardMatch?.kind === "board" ? null : (currentColumnId ?? null);
    if (columnId) body.columnId = columnId;
    if (base) {
      if (base.doDate) body.doDate = base.doDate;
      if (base.doTime) body.doTime = base.doTime;
      if (base.dueDate) body.dueDate = base.dueDate;
      if (base.recurrence) body.recurrence = base.recurrence;
      if (base.priority != null) body.priority = base.priority;
      if (base.note) body.note = base.note;
      if (base.assigneeToken && assigneeUserId) body.assigneeUserId = assigneeUserId;
    }
    setBusy(true);
    const created = await onCreate(body);
    setBusy(false);
    if (created) {
      reset();
      ref.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !composing.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (text) reset();
      else setOpen(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="todo-ghost" onClick={() => setOpen(true)} aria-label="할 일 추가">
        <span className="todo-ghost-plus" aria-hidden="true">
          <Plus strokeWidth={3} />
        </span>
        <span className="todo-ghost-text">{placeholder ?? "할 일 추가 — 예: 내일 오후 3시 한빛제지 협의 !높음 @김민수"}</span>
        <span className="todo-kbd" aria-hidden="true">
          N
        </span>
      </button>
    );
  }

  const chips = parsed?.tokens ?? [];
  const priorityTone = (p: TodoPriority | null) => (p === 3 ? "error" : p === 2 ? "warn" : undefined);

  return (
    <div className="todo-qa" aria-label="빠른 추가">
      <div className="todo-qa-line">
        <span className="todo-ghost-plus" aria-hidden="true">
          <Plus strokeWidth={3} />
        </span>
        <input
          ref={ref}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            runParse((e.target as HTMLInputElement).value, dismissed);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!text.trim()) setOpen(false);
          }}
          placeholder={placeholder ?? "할 일 추가 — 예: 내일 오후 3시 한빛제지 협의 !높음 @김민수 10/30까지"}
          aria-label="할 일 빠른 추가"
          disabled={busy}
          autoComplete="off"
        />
        <span className="todo-kbd" aria-hidden="true">
          Enter
        </span>
      </div>
      {parseOn && parsed && chips.length > 0 && (
        <div className="todo-qa-chips" aria-label="인식된 항목">
          {chips.map((t) => {
            let content: ReactNode = t.text;
            let tone: string | undefined;
            switch (t.kind) {
              case "do_date":
                content = (
                  <>
                    <CalendarDays aria-hidden="true" />할 날 {md(t.value)} ({weekdayKo(t.value)})
                  </>
                );
                break;
              case "do_time":
                content = (
                  <>
                    <Clock3 aria-hidden="true" />
                    {t.value}
                  </>
                );
                break;
              case "due_date":
                content = (
                  <>
                    <Flag aria-hidden="true" />
                    마감 {md(t.value)}
                  </>
                );
                break;
              case "recurrence":
                content = (
                  <>
                    <Repeat aria-hidden="true" />
                    {describeRecurrence(t.value) ?? t.value}
                  </>
                );
                break;
              case "priority": {
                const p = Number(t.value) as TodoPriority;
                tone = priorityTone(p);
                content = (
                  <>
                    <span className="todo-pdot" data-priority={p} aria-hidden="true" />
                    {TODO_PRIORITY_LABELS[p]}
                  </>
                );
                break;
              }
              case "board":
                tone = boardMatch?.kind === "none" ? "muted" : "warn";
                content = (
                  <>
                    <LayoutGrid aria-hidden="true" />
                    {boardMatch?.label ?? t.text}
                  </>
                );
                break;
              case "assignee":
                tone = assigneeCandidates.length === 0 ? "muted" : "success";
                content = (
                  <>
                    <User aria-hidden="true" />
                    {assigneeCandidates.length === 0 ? (
                      `@${t.value} 일치 없음`
                    ) : assigneeCandidates.length === 1 ? (
                      `${assigneeCandidates[0].name} · 담당`
                    ) : (
                      <select value={assigneePick} onChange={(e) => setAssigneePick(e.target.value)} aria-label="동명이인 선택">
                        <option value="">{t.value} — 누구?</option>
                        {assigneeCandidates.map((c) => (
                          <option key={c.userId} value={c.userId}>
                            {c.name}
                            {c.positionName ? ` ${c.positionName}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                );
                break;
              case "note":
                content = (
                  <>
                    <StickyNote aria-hidden="true" />
                    메모 {t.value.length > 18 ? `${t.value.slice(0, 18)}…` : t.value}
                  </>
                );
                break;
            }
            return (
              <span key={`${t.kind}-${t.start}`} className="todo-qa-chip" data-tone={tone}>
                {content}
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => dismiss(t)} aria-label={`${t.text} 인식 해제 — 제목에 남깁니다`}>
                  <X aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {parseOn && parsed && (
        <div className="todo-qa-preview">
          <span>제목</span>
          <b>{parsed.title || "(비어 있음)"}</b>
          <span className="todo-qa-hint">칩 × 로 해제하면 그 단어는 제목에 남습니다 · Esc 취소</span>
        </div>
      )}
    </div>
  );
}
