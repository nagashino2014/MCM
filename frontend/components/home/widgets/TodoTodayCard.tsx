"use client";

// H12 — 오늘 할 일(274, docs/todo-kanban-blueprint.md §7.1). 지연 → 결재 대기(내가 결재할 차례, "결재하기") → 오늘(결재 일정은 읽기 전용 행)
// → 내일·이번 주 순 상위 5행 + 체크(완료) + 퀵애드 한 줄(제목만, 파싱 없음). v4(§19-9): 행 좌측에 보드 파스텔 띠(boardColor), 결재 행은 종류 아이콘을 파스텔 원 안에.
// 데이터: GET /api/home/todo-today / 완료: POST /api/todo/items/[id]/complete / 추가: POST /api/todo/items { title }.

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, ListChecks, Plus } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { TODO_APPROVAL_EVENT_LABELS, type TodoApprovalEvent, type TodoItem } from "@/lib/todo/types";
import { approvalKindIcon, pendingAgeDays, pendingContextParts } from "@/components/todo/todo-utils";

interface TodoToday {
  today: string;
  overdue: TodoItem[];
  todayItems: TodoItem[];
  thisWeek: TodoItem[];
  counts: { overdue: number; today: number; thisWeek: number };
  approvalEvents?: TodoApprovalEvent[];
}

/** 위젯 행 — 할 일(체크 가능) 또는 결재 일정(읽기 전용). */
type Row =
  | { kind: "item"; key: string; item: TodoItem; bucket: "overdue" | "today" | "week" }
  | { kind: "approval"; key: string; event: TodoApprovalEvent };

const ROW_LIMIT = 5;

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const md = (ymd: string): string => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 오늘 기준 날짜 열 문구 — 지연 / 시각·종일 / 내일 / M/D. */
function whenLabel(row: Extract<Row, { kind: "item" }>, today: string): string {
  if (row.bucket === "overdue") return "지연";
  const date = row.item.doDate ?? row.item.dueDate ?? today;
  if (date === today) return row.item.doTime ?? "종일";
  if (date === addDays(today, 1)) return "내일";
  return md(date);
}

/** 좌측 4px 파스텔 띠 — 보드 색(결재 행은 종류 색). */
function Strip({ color }: { color: string | null | undefined }) {
  return <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-[3px]" style={{ background: color ?? "var(--cd-line)" }} />;
}

export function TodoTodayCard() {
  const w = useHomeWidget<TodoToday>("/api/home/todo-today");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  if (w.status === "forbidden") return null;
  const data = w.status === "ok" ? w.data : null;
  const today = data?.today ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const dueCount = (data?.counts.overdue ?? 0) + (data?.counts.today ?? 0);

  // 지연 전부 → 결재 대기(내 차례, 서버 순서) → 오늘(할 일 + 결재 일정, 시각순·종일 먼저) → 이번 주(날짜순, 내일부터) 순으로 상위 5행.
  const rows: Row[] = [];
  for (const item of data?.overdue ?? []) rows.push({ kind: "item", key: item.itemId, item, bucket: "overdue" });
  const allEvents = data?.approvalEvents ?? [];
  for (const event of allEvents.filter((e) => e.kind === "pending")) rows.push({ kind: "approval", key: `ap:${event.id}`, event });
  const todayRows: Row[] = [
    ...(data?.todayItems ?? []).map((item): Row => ({ kind: "item", key: item.itemId, item, bucket: "today" })),
    ...allEvents.filter((e) => e.kind !== "pending").map((event): Row => ({ kind: "approval", key: `ap:${event.id}`, event })),
  ];
  const timeOf = (r: Row) => (r.kind === "item" ? r.item.doTime : r.event.startTime) ?? "";
  todayRows.sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
  rows.push(...todayRows);
  for (const item of data?.thisWeek ?? []) rows.push({ kind: "item", key: item.itemId, item, bucket: "week" });
  const visible = rows.slice(0, ROW_LIMIT);

  const complete = async (itemId: string) => {
    if (completing.has(itemId)) return;
    setCompleting((prev) => new Set(prev).add(itemId));
    setError(null);
    try {
      const res = await fetch(`/api/todo/items/${encodeURIComponent(itemId)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      w.reload();
    } catch {
      setError("완료 처리에 실패했습니다.");
    } finally {
      setCompleting((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const quickAdd = async () => {
    const value = title.trim();
    if (!value || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/todo/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTitle("");
      w.reload();
    } catch {
      setError("할 일을 추가하지 못했습니다.");
    } finally {
      setAdding(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // IME 조합 중 Enter 는 확정 키 — 조합이 끝난 뒤의 Enter 만 추가로 본다(§7.4).
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void quickAdd();
  };

  return (
    <HomeCard
      icon={<ListChecks className="w-4 h-4" />}
      title="오늘 할 일"
      href="/todo"
      hrefLabel="전체 보기"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      headerActions={
        data && (
          <span className="text-[11px] cd-text-muted tabular-nums">
            {dueCount}건
            {data.counts.overdue > 0 && (
              <>
                {" · "}
                <b className="font-semibold" style={{ color: "var(--cd-error)" }}>
                  지연 {data.counts.overdue}
                </b>
              </>
            )}
          </span>
        )
      }
    >
      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <p className="text-[13px] cd-text-faint py-4 text-center">오늘 처리할 할 일이 없습니다.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((row) => {
              if (row.kind === "approval" && row.event.kind === "pending") {
                // 결재 대기(내가 결재할 차례) — Stamp 아이콘 + "결재 대기" 칩 + 제목 + 기안자·양식 보조, 우측 "결재하기". 상신 2일 이상이면 D+N.
                const ev = row.event;
                const Icon = approvalKindIcon("pending");
                const age = pendingAgeDays(ev.submittedAt, today);
                const sub = pendingContextParts(ev).slice(0, 2).join(" · ");
                const href = ev.docId ? `/approval?docId=${encodeURIComponent(ev.docId)}` : "/approval";
                return (
                  <li key={row.key} className="relative flex items-center gap-2.5 h-10 pl-2.5 border-b cd-hairline-c last:border-b-0" style={{ background: `color-mix(in srgb, ${ev.kindColor} 12%, transparent)` }}>
                    <Strip color={ev.kindColor} />
                    <span className="w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: ev.kindColor, color: "#3d4350" }} aria-hidden="true">
                      <Icon className="w-3 h-3" strokeWidth={2.2} />
                    </span>
                    <span className="text-[11px] rounded-[5px] px-1.5 leading-[17px] shrink-0 cd-text-muted" style={{ background: `color-mix(in srgb, ${ev.kindColor} 60%, var(--cd-card))` }}>
                      {TODO_APPROVAL_EVENT_LABELS.pending}
                    </span>
                    <Link href={href} className="flex-1 min-w-0 text-[13px] cd-text truncate" title={[ev.title, sub].filter(Boolean).join(" — ")}>
                      {ev.title}
                      {sub && <span className="cd-text-faint text-[11.5px]"> · {sub}</span>}
                    </Link>
                    {age != null && age >= 2 && (
                      <span className="text-[11px] rounded-[5px] px-1.5 leading-[18px] shrink-0 tabular-nums" style={{ background: "#FDEBD3", color: "#8a4b06", fontWeight: 500 }} title="상신 후 경과일">
                        D+{age}
                      </span>
                    )}
                    <Link href={href} className="text-[12px] shrink-0 pr-2.5" style={{ color: "var(--cd-primary)" }}>
                      결재하기
                    </Link>
                  </li>
                );
              }
              if (row.kind === "approval") {
                const ev = row.event;
                const Icon = approvalKindIcon(ev.kind);
                const text = ev.title;
                return (
                  <li key={row.key} className="relative flex items-center gap-2.5 h-10 pl-2.5 border-b cd-hairline-c last:border-b-0" style={{ background: `color-mix(in srgb, ${ev.kindColor} 12%, transparent)` }}>
                    <Strip color={ev.kindColor} />
                    {/* 결재 일정 — 종류 아이콘을 파스텔 원 안에, 체크 없음(읽기 전용). 문서가 있으면 결재 화면으로 이동. */}
                    <span className="w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: ev.kindColor, color: "#3d4350" }} aria-hidden="true">
                      <Icon className="w-3 h-3" strokeWidth={2.2} />
                    </span>
                    <span className="w-10 shrink-0 text-[12px] cd-text-muted tabular-nums">{ev.startTime ?? "종일"}</span>
                    <span className="text-[11px] rounded-[5px] px-1.5 leading-[17px] shrink-0 cd-text-muted" style={{ background: `color-mix(in srgb, ${ev.kindColor} 60%, var(--cd-card))` }}>
                      {TODO_APPROVAL_EVENT_LABELS[ev.kind]}
                    </span>
                    {ev.docId ? (
                      <Link href={`/approval?docId=${encodeURIComponent(ev.docId)}`} className="flex-1 min-w-0 text-[13px] cd-text-muted truncate" title={text}>
                        {text}
                      </Link>
                    ) : (
                      <span className="flex-1 min-w-0 text-[13px] cd-text-muted truncate" title={text}>
                        {text}
                      </span>
                    )}
                  </li>
                );
              }
              const { item, bucket } = row;
              const busy = completing.has(item.itemId);
              const when = whenLabel(row, today);
              // 마감 배지 — 마감일이 있으면 지남/오늘/날짜, 없고 날짜 열이 날짜 문구면 시각을 보조로.
              const dueOver = item.dueDate != null && item.dueDate < today;
              const dueToday = item.dueDate === today;
              const badge = item.dueDate
                ? dueToday
                  ? "D-Day"
                  : dueOver
                    ? `D+${Math.max(1, Math.round((Date.parse(today) - Date.parse(item.dueDate)) / 86400000))}`
                    : md(item.dueDate)
                : when !== "종일" && when !== "지연" && item.doTime && when !== item.doTime
                  ? item.doTime
                  : null;
              return (
                <li key={row.key} className="relative flex items-center gap-2.5 h-10 pl-2.5 border-b cd-hairline-c last:border-b-0">
                  <Strip color={item.boardColor} />
                  <button
                    type="button"
                    onClick={() => void complete(item.itemId)}
                    disabled={busy}
                    aria-label={`완료: ${item.title}`}
                    title="완료"
                    className="w-4 h-4 rounded-full border-[1.5px] shrink-0 inline-flex items-center justify-center transition-colors disabled:cursor-wait"
                    style={{
                      borderColor: busy ? "var(--cd-primary)" : "var(--cd-faint)",
                      background: busy ? "var(--cd-primary)" : "transparent",
                    }}
                  >
                    {busy && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                  </button>
                  <span
                    className="w-10 shrink-0 text-[12px] tabular-nums"
                    style={{ color: bucket === "overdue" ? "var(--cd-error)" : "var(--cd-muted)" }}
                  >
                    {when}
                  </span>
                  {item.priority === 3 && (
                    <span className="text-[11px] font-semibold rounded-[5px] px-1.5 leading-[17px] shrink-0" style={{ background: "#FBE3E3", color: "#9b2222" }}>
                      높음
                    </span>
                  )}
                  <Link
                    href={`/todo?item=${encodeURIComponent(item.itemId)}`}
                    className="flex-1 min-w-0 text-[13px] cd-text truncate"
                    title={item.title}
                  >
                    {item.title}
                  </Link>
                  {badge && (
                    <span
                      className="text-[11px] rounded-[5px] px-1.5 leading-[18px] shrink-0 tabular-nums"
                      style={
                        dueOver
                          ? { background: "#FBE3E3", color: "#9b2222", fontWeight: 500 }
                          : dueToday
                            ? { background: "#FDEBD3", color: "#8a4b06", fontWeight: 500 }
                            : { border: "1px solid var(--cd-line)", color: "var(--cd-muted)" }
                      }
                    >
                      {badge}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 퀵애드 — 제목만 보낸다(날짜·우선순위 파싱은 /todo 퀵애드가 담당). */}
        <div className="relative">
          <Plus className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-muted pointer-events-none" strokeWidth={2.2} />
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={adding}
            placeholder="할 일 추가 · Enter"
            aria-label="할 일 추가"
            className="cd-input h-8 !min-h-0 !py-0 !pl-8 !pr-12 text-[12px]"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] border cd-line-c rounded px-1 cd-text-muted pointer-events-none">Enter</kbd>
        </div>
        {error && <p className="text-[11px] cd-error-text">{error}</p>}
      </div>
    </HomeCard>
  );
}
