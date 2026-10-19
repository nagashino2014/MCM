"use client";

/**
 * 타임라인(§29-1, 2026-10-19) — 기간 할 일·마일스톤·의존 화살표를 가로 시간축에. 라이브러리 없이 CSS 그리드 + SVG 오버레이.
 *   행 = 날짜(할 날/마감/기간)가 있는 상위 할 일, ▸ 로 하위 작업(공정 단계 라벨·마일스톤 ◆)을 펼친다. 날짜 없는 할 일은 하단 묶음.
 *   막대 = do_date ~ end_date(없으면 하루). 드래그 이동 = do/end 동시 이동(마감만 있으면 due_date), 오른쪽 끝 리사이즈 = end_date.
 *   의존 화살표 = 선행 막대 끝 → 후행 막대 시작(GET /api/todo/deps?itemIds=). 선행 미완=회색, 선행 지연=빨강, 완료=흐림.
 *   시각 규칙은 todo.css 의 todo-tl-* 에만 둔다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { CdButton } from "@/components/cdash";
import { TODO_MILESTONE_LABELS, type TodoItem, type TodoItemDetail, type TodoStageRef } from "@/lib/todo/types";
import { StatusDot, tintStyle } from "./TodoRow";
import { addDays, diffDays, md, weekdayKo } from "./todo-utils";
import { apiCall } from "./useTodoData";

export interface TodoTimelineProps {
  items: TodoItem[];
  today: string;
  selectedId?: string | null;
  loading?: boolean;
  onOpen: (item: TodoItem) => void;
  /** PATCH /api/todo/items/:id — 날짜 이동·리사이즈. optimistic 은 목록 즉시 반영용. */
  onPatch: (itemId: string, patch: Record<string, unknown>, optimistic?: Partial<TodoItem>) => Promise<unknown>;
}

interface DepEdge {
  itemId: string;
  dependsOnItemId: string;
}

interface Row {
  item: TodoItem;
  depth: 0 | 1;
  /** 막대 시작·끝(YYYY-MM-DD). 마일스톤 하위는 start=end */
  start: string;
  end: string;
  /** 날짜 근거 — 드래그 시 어떤 필드를 옮길지 */
  field: "do" | "due";
  milestone: boolean;
  stageLabel?: string | null;
  /** 날짜 없는 하위 작업 — 라벨만, 막대 없음 */
  undated?: boolean;
}

const ROW_H = 34;
const LABEL_W = 272;
const DAYS = 84; // 12주 창
const DAY_W: Record<"day" | "week", number> = { day: 30, week: 13 };

const mondayOf = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7; // 월=0
  return addDays(ymd, -wd);
};
const clampDay = (n: number) => Math.max(0, Math.min(DAYS - 1, n));

function rowOf(item: TodoItem, depth: 0 | 1, stageLabel?: string | null): Row | null {
  const ms = depth === 1 && !!item.milestoneKind;
  if (ms) {
    const d = item.actualDate ?? item.doDate ?? item.dueDate;
    if (!d) return null;
    return { item, depth, start: d, end: d, field: item.doDate || !item.dueDate ? "do" : "due", milestone: true, stageLabel };
  }
  if (item.doDate) return { item, depth, start: item.doDate, end: item.endDate && item.endDate >= item.doDate ? item.endDate : item.doDate, field: "do", milestone: false, stageLabel };
  if (item.dueDate) return { item, depth, start: item.dueDate, end: item.dueDate, field: "due", milestone: false, stageLabel };
  if (depth === 1) return { item, depth, start: "", end: "", field: "do", milestone: false, stageLabel, undated: true };
  return null;
}

export function TodoTimeline({ items, today, selectedId, loading, onOpen, onPatch }: TodoTimelineProps) {
  const [scale, setScale] = useState<"day" | "week">("day");
  const [windowStart, setWindowStart] = useState(() => addDays(mondayOf(today), -14));
  const [expanded, setExpanded] = useState<Record<string, { subtasks: TodoItem[]; stages: TodoStageRef[] } | "loading">>({});
  const [edges, setEdges] = useState<DepEdge[]>([]);
  const [undatedOpen, setUndatedOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; startX: number; delta: number } | null>(null);
  const dayW = DAY_W[scale];
  const trackW = DAYS * dayW;
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 행 구성: 날짜 있는 상위(시작일 순) + 펼친 하위 ──
  const { rows, undated } = useMemo(() => {
    const tops = items.filter((it) => !it.parentItemId);
    const dated: Row[] = [];
    const undated: TodoItem[] = [];
    for (const it of tops) {
      const r = rowOf(it, 0);
      if (r) dated.push(r);
      else undated.push(it);
    }
    dated.sort((a, b) => a.start.localeCompare(b.start) || a.item.title.localeCompare(b.item.title));
    const rows: Row[] = [];
    for (const r of dated) {
      rows.push(r);
      const ex = expanded[r.item.itemId];
      if (ex && ex !== "loading") {
        for (const st of ex.subtasks) {
          const stage = st.stageOrder != null ? ex.stages.find((s) => s.stageOrder === st.stageOrder) : null;
          const sub = rowOf(st, 1, stage ? `${stage.stageOrder}. ${stage.stageName}` : null);
          if (sub) rows.push(sub);
        }
      }
    }
    return { rows, undated };
  }, [items, expanded]);

  // ── 의존 간선(행에 보이는 항목만) ──
  const rowIds = useMemo(() => rows.map((r) => r.item.itemId), [rows]);
  const rowIdsKey = rowIds.join(",");
  useEffect(() => {
    if (!rowIdsKey) {
      setEdges([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      apiCall<{ edges: DepEdge[] }>(`/api/todo/deps?itemIds=${encodeURIComponent(rowIdsKey)}`)
        .then((d) => {
          if (alive) setEdges(d.edges ?? []);
        })
        .catch(() => {
          if (alive) setEdges([]);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // items 가 갱신되면(상세에서 선행 추가·목록 재조회) 간선도 다시 가져온다
  }, [rowIdsKey, items]);

  const toggleExpand = async (item: TodoItem) => {
    const cur = expanded[item.itemId];
    if (cur) {
      setExpanded((m) => {
        const n = { ...m };
        delete n[item.itemId];
        return n;
      });
      return;
    }
    setExpanded((m) => ({ ...m, [item.itemId]: "loading" }));
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(item.itemId)}`);
      setExpanded((m) => ({ ...m, [item.itemId]: { subtasks: d.item.subtasks, stages: d.item.stages } }));
    } catch {
      setExpanded((m) => {
        const n = { ...m };
        delete n[item.itemId];
        return n;
      });
    }
  };

  // ── 좌표 ──
  const xOf = (ymd: string) => diffDays(ymd, windowStart) * dayW;
  const todayX = xOf(today);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.item.itemId, i])), [rows]);

  // ── 드래그(포인터) ──
  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>, r: Row) => {
    if (e.button !== 0 || !r.item.canEdit || r.item.status === "done") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mode: "move" | "resize" = !r.milestone && r.field === "do" && rect.right - e.clientX <= 10 ? "resize" : "move";
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트·일부 브라우저 — 캡처 없이도 동작 */
    }
    setDrag({ id: r.item.itemId, mode, startX: e.clientX, delta: 0 });
    e.preventDefault();
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) / dayW);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const onBarPointerUp = async (e: ReactPointerEvent<HTMLDivElement>, r: Row) => {
    if (!drag || drag.id !== r.item.itemId) return;
    const delta = drag.delta;
    setDrag(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 캡처가 없었던 경우 */
    }
    if (delta === 0) {
      onOpen(r.item);
      return;
    }
    if (drag.mode === "resize") {
      const nextEnd = addDays(r.end, delta);
      if (nextEnd < r.start) return;
      const endDate = nextEnd === r.start ? null : nextEnd;
      await onPatch(r.item.itemId, { endDate }, { endDate });
      return;
    }
    if (r.milestone) {
      const field = r.item.actualDate ? "actualDate" : r.field === "do" ? "doDate" : "dueDate";
      const v = addDays(r.start, delta);
      await onPatch(r.item.itemId, { [field]: v }, { [field]: v } as Partial<TodoItem>);
      return;
    }
    if (r.field === "due") {
      const v = addDays(r.start, delta);
      await onPatch(r.item.itemId, { dueDate: v }, { dueDate: v });
      return;
    }
    const doDate = addDays(r.start, delta);
    const endDate = r.item.endDate ? addDays(r.item.endDate, delta) : null;
    await onPatch(r.item.itemId, { doDate, endDate }, { doDate, endDate });
  };

  const shift = (weeks: number) => setWindowStart((s) => addDays(s, weeks * 7));
  const goToday = useCallback(() => {
    setWindowStart(addDays(mondayOf(today), -14));
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: Math.max(0, 14 * dayW - 120), behavior: "smooth" }));
  }, [today, dayW]);

  // ── 헤더(월·일) ──
  const dayCells = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(windowStart, i)), [windowStart]);
  const monthSpans = useMemo(() => {
    const out: { key: string; label: string; from: number; len: number }[] = [];
    for (let i = 0; i < DAYS; i++) {
      const ym = dayCells[i].slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === ym) last.len += 1;
      else out.push({ key: ym, label: `${Number(ym.slice(5, 7))}월`, from: i, len: 1 });
    }
    return out;
  }, [dayCells]);
  const weekendOffset = ((new Date(`${windowStart}T12:00:00Z`).getUTCDay() + 1) % 7) * dayW; // 토요일까지의 거리

  const barStyle = (r: Row): CSSProperties => {
    const d = drag && drag.id === r.item.itemId ? drag.delta : 0;
    const start = drag?.mode === "resize" && drag.id === r.item.itemId ? r.start : addDays(r.start, d);
    const end = addDays(r.end, d);
    const x0 = clampDay(diffDays(start, windowStart));
    const x1 = clampDay(diffDays(end, windowStart));
    return { left: x0 * dayW + 1, width: Math.max(dayW - 2, (x1 - x0 + 1) * dayW - 2), ...tintStyle(r.item.boardColor) };
  };
  const visible = (r: Row) => !r.undated && diffDays(r.end, windowStart) >= 0 && diffDays(r.start, windowStart) < DAYS;
  const late = (r: Row) => r.item.status !== "done" && r.end < today;

  // ── 의존 화살표(SVG) ──
  const arrows = useMemo(() => {
    const out: { key: string; d: string; tone: "done" | "late" | "open" }[] = [];
    const byId = new Map(rows.map((r) => [r.item.itemId, r]));
    for (const e of edges) {
      const pred = byId.get(e.dependsOnItemId);
      const succ = byId.get(e.itemId);
      if (!pred || !succ || pred.undated || succ.undated) continue;
      const pi = rowIndex.get(pred.item.itemId)!;
      const si = rowIndex.get(succ.item.itemId)!;
      const x1 = (clampDay(diffDays(pred.end, windowStart)) + 1) * dayW - 1;
      const y1 = pi * ROW_H + ROW_H / 2;
      const x2 = clampDay(diffDays(succ.start, windowStart)) * dayW + 1;
      const y2 = si * ROW_H + ROW_H / 2;
      const mid = x2 >= x1 + 12 ? x1 + 6 : x1 + 6;
      const d = x2 >= x1 + 12 ? `M${x1},${y1} H${mid} V${y2} H${x2 - 4}` : `M${x1},${y1} H${x1 + 6} V${y1 + ROW_H / 2} H${x2 - 8} V${y2} H${x2 - 4}`;
      out.push({ key: `${e.dependsOnItemId}>${e.itemId}`, d, tone: pred.item.status === "done" ? "done" : late(pred) ? "late" : "open" });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, rows, rowIndex, windowStart, dayW, today]);

  const bodyH = Math.max(rows.length, 1) * ROW_H;

  return (
    <div className="todo-tl" aria-label="타임라인">
      <div className="todo-tl-bar">
        <div className="todo-tl-nav" role="group" aria-label="기간 이동">
          <CdButton variant="ghost" size="sm" onClick={() => shift(-4)} title="4주 앞으로">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </CdButton>
          <CdButton variant="soft" size="sm" onClick={goToday}>
            오늘
          </CdButton>
          <CdButton variant="ghost" size="sm" onClick={() => shift(4)} title="4주 뒤로">
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </CdButton>
          <span className="todo-tl-range">
            {md(windowStart)} ~ {md(addDays(windowStart, DAYS - 1))}
          </span>
        </div>
        <div className="todo-seg-view overflow-hidden" role="group" aria-label="눈금">
          <button type="button" className="cd-choice" data-active={scale === "day" ? "true" : undefined} aria-pressed={scale === "day"} onClick={() => setScale("day")}>
            일
          </button>
          <button type="button" className="cd-choice" data-active={scale === "week" ? "true" : undefined} aria-pressed={scale === "week"} onClick={() => setScale("week")}>
            주
          </button>
        </div>
        <div className="todo-tl-legend" aria-hidden="true">
          <span className="todo-tl-lg todo-tl-lg-bar" /> 기간 · <span className="todo-tl-lg todo-tl-lg-ms">◆</span> 마일스톤 · <Link2 className="w-3 h-3 inline" /> 선행→후행(빨강=선행 지연) · 막대 드래그=이동, 오른쪽 끝=종료일
        </div>
      </div>

      <div className="todo-tl-scroll" ref={scrollRef}>
        <div className="todo-tl-grid" style={{ width: LABEL_W + trackW }}>
          {/* 헤더 */}
          <div className="todo-tl-head" style={{ gridTemplateColumns: `${LABEL_W}px ${trackW}px` }}>
            <div className="todo-tl-corner">할 일 {rows.length ? <span className="todo-sec-n">{rows.filter((r) => r.depth === 0).length}</span> : null}</div>
            <div className="todo-tl-axis">
              <div className="todo-tl-months">
                {monthSpans.map((m) => (
                  <span key={m.key} className="todo-tl-month" style={{ left: m.from * dayW, width: m.len * dayW }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="todo-tl-days">
                {dayCells.map((d, i) => {
                  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
                  const isMon = wd === 1;
                  if (scale === "week" && !isMon) return null;
                  return (
                    <span key={d} className="todo-tl-day" data-today={d === today ? "1" : undefined} data-weekend={wd === 0 || wd === 6 ? "1" : undefined} style={{ left: i * dayW, width: scale === "week" ? dayW * 7 : dayW }}>
                      {scale === "week" ? md(d) : Number(d.slice(8, 10))}
                      {scale === "day" && dayW >= 28 && <small>{weekdayKo(d)}</small>}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 본문 */}
          {loading && !rows.length ? (
            <div className="todo-loading">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="todo-tl-empty">날짜가 있는 할 일이 없습니다. 할 날·마감일·기간을 넣으면 여기에 막대로 보입니다.</div>
          ) : (
            <div className="todo-tl-body" style={{ gridTemplateColumns: `${LABEL_W}px ${trackW}px`, height: bodyH }}>
              <div className="todo-tl-labels">
                {rows.map((r) => {
                  const ex = expanded[r.item.itemId];
                  return (
                    <div key={r.item.itemId} className="todo-tl-label" data-depth={r.depth} data-selected={selectedId === r.item.itemId ? "1" : undefined} style={{ height: ROW_H }}>
                      {r.depth === 0 ? (
                        r.item.subtaskTotal > 0 ? (
                          <button type="button" className="todo-tl-caret" aria-expanded={!!ex && ex !== "loading"} title={ex ? "하위 접기" : `하위 작업 ${r.item.subtaskTotal}건 펼치기`} onClick={() => void toggleExpand(r.item)}>
                            {ex && ex !== "loading" ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                          </button>
                        ) : (
                          <span className="todo-tl-caret" aria-hidden="true" />
                        )
                      ) : (
                        <span className="todo-tl-sub-ln" aria-hidden="true" />
                      )}
                      <StatusDot status={r.item.status} />
                      <button type="button" className="todo-tl-ttl" title={r.item.title} onClick={() => onOpen(r.item)}>
                        {r.stageLabel ? <span className="todo-tl-stage">{r.stageLabel}</span> : null}
                        {r.item.title}
                      </button>
                      {r.item.openDeps > 0 && r.item.status !== "done" && (
                        <span className="todo-dep" title="선행 작업이 끝나야 시작할 수 있습니다">
                          ⛓ {r.item.openDeps}
                        </span>
                      )}
                      {r.undated && <span className="todo-tl-who">날짜 없음</span>}
                      {r.depth === 0 && r.item.assigneeName && <span className="todo-tl-who">{r.item.assigneeName}</span>}
                    </div>
                  );
                })}
              </div>
              <div
                className="todo-tl-track"
                style={{ width: trackW, backgroundSize: `${dayW * 7}px 100%`, backgroundPosition: `${weekendOffset}px 0`, ["--tl-day" as string]: `${dayW}px`, ["--tl-row" as string]: `${ROW_H}px` } as CSSProperties}
              >
                {todayX >= 0 && todayX < trackW && <div className="todo-tl-today" style={{ left: todayX + Math.floor(dayW / 2) }} title={`오늘 ${md(today)}`} />}
                {rows.map((r, i) =>
                  !visible(r) ? null : r.milestone ? (
                    <div
                      key={r.item.itemId}
                      className="todo-tl-ms"
                      data-done={r.item.status === "done" ? "1" : undefined}
                      data-late={late(r) ? "1" : undefined}
                      data-drag={drag?.id === r.item.itemId ? "1" : undefined}
                      style={{ top: i * ROW_H + ROW_H / 2, left: clampDay(diffDays(addDays(r.start, drag?.id === r.item.itemId ? drag.delta : 0), windowStart)) * dayW + dayW / 2, ...tintStyle(r.item.boardColor) }}
                      title={`${r.item.milestoneKind ? TODO_MILESTONE_LABELS[r.item.milestoneKind] : "마일스톤"} · ${r.item.actualDate ? `실제 ${md(r.item.actualDate)}` : `예정 ${md(r.start)}`}`}
                      onPointerDown={(e) => onBarPointerDown(e, r)}
                      onPointerMove={onBarPointerMove}
                      onPointerUp={(e) => void onBarPointerUp(e, r)}
                    >
                      ◆
                    </div>
                  ) : (
                    <div
                      key={r.item.itemId}
                      className="todo-tl-item"
                      data-depth={r.depth}
                      data-done={r.item.status === "done" ? "1" : undefined}
                      data-late={late(r) ? "1" : undefined}
                      data-field={r.field}
                      data-drag={drag?.id === r.item.itemId ? drag.mode : undefined}
                      data-editable={r.item.canEdit && r.item.status !== "done" ? "1" : undefined}
                      style={{ top: i * ROW_H + 6, height: ROW_H - 12, ...barStyle(r) }}
                      title={`${r.item.title} · ${r.field === "due" ? `마감 ${md(r.start)}` : r.start === r.end ? md(r.start) : `${md(r.start)} ~ ${md(r.end)}`}${r.item.progressPct != null ? ` · ${r.item.progressPct}%` : ""}`}
                      onPointerDown={(e) => onBarPointerDown(e, r)}
                      onPointerMove={onBarPointerMove}
                      onPointerUp={(e) => void onBarPointerUp(e, r)}
                    >
                      {r.depth === 1 && r.item.progressPct != null && r.item.status !== "done" && <span className="todo-tl-prog" style={{ width: `${r.item.progressPct}%` }} />}
                      <span className="todo-tl-item-ttl">{r.item.title}</span>
                      {r.field === "do" && !r.milestone && r.item.canEdit && r.item.status !== "done" && <span className="todo-tl-grip" aria-hidden="true" />}
                    </div>
                  )
                )}
                {arrows.length > 0 && (
                  <svg className="todo-tl-arrows" width={trackW} height={bodyH} aria-hidden="true">
                    <defs>
                      <marker id="todo-tl-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                        <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
                      </marker>
                    </defs>
                    {arrows.map((a) => (
                      <path key={a.key} d={a.d} className="todo-tl-arrow" data-tone={a.tone} markerEnd="url(#todo-tl-ah)" />
                    ))}
                  </svg>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="todo-tl-undated">
          <button type="button" className="todo-tl-undated-h" aria-expanded={undatedOpen} onClick={() => setUndatedOpen((v) => !v)}>
            {undatedOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            날짜 없음 <span className="todo-sec-n">{undated.length}건</span>
            <span className="todo-tl-undated-hint">할 날이나 마감일을 넣으면 타임라인에 올라옵니다</span>
          </button>
          {undatedOpen && (
            <ul className="todo-tl-undated-list">
              {undated.map((it) => (
                <li key={it.itemId}>
                  <button type="button" className="todo-tl-ttl" onClick={() => onOpen(it)} style={tintStyle(it.boardColor)}>
                    <StatusDot status={it.status} /> {it.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
