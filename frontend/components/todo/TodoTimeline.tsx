"use client";

/**
 * 타임라인(§29-1, 2026-10-19) — 기간 할 일·마일스톤·의존 화살표를 가로 시간축에. 라이브러리 없이 CSS 그리드 + SVG 오버레이.
 *   행 = 날짜(할 날/마감/기간)가 있는 상위 할 일, ▸ 로 하위 작업(공정 단계 라벨·마일스톤 ◆)을 펼친다. 날짜 없는 할 일은 하단 묶음.
 *   막대 = do_date ~ end_date(없으면 하루). 드래그 이동 = do/end 동시 이동(마감만 있으면 due_date), 오른쪽 끝 리사이즈 = end_date.
 *   의존 화살표 = 선행 막대 끝 → 후행 막대 시작(GET /api/todo/deps?itemIds=). 선행 미완=회색, 선행 지연=빨강, 완료=흐림.
 *   시각 규칙은 todo.css 의 todo-tl-* 에만 둔다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Link2, X } from "lucide-react";
import { CdButton } from "@/components/cdash";
import { TODO_MILESTONE_LABELS, TODO_STATUS_LABELS, TODO_STATUSES, type TodoItem, type TodoItemDetail, type TodoStageRef, type TodoWorkType } from "@/lib/todo/types";
import { StatusDot, tintStyle } from "./TodoRow";
import { addDays, diffDays, md } from "./todo-utils";
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
  /** 날짜 없는 하위 작업 — 상위 기간 위에 점선 '날짜 미정' 막대로(드래그 없음) */
  undated?: boolean;
  /** 하위 행의 상위 id(연계선·보조 행 배경용) */
  parentId?: string;
}

type SubCache = Record<string, { subtasks: TodoItem[]; stages: TodoStageRef[]; workTypeAuto?: string | null } | "loading">;
const subPct = (st: TodoItem) => (st.status === "done" ? 100 : (st.progressPct ?? 0));
/** 하위 보조 행은 복수 일자(할 날~종료일이 이틀 이상)인 상위에만(2026-10-20 사용자 지시). */
const isMultiDay = (it: Pick<TodoItem, "doDate" | "endDate" | "subtaskTotal">) => !!it.doDate && !!it.endDate && it.endDate > it.doDate && it.subtaskTotal > 0;

const ROW_H = 34;
const LABEL_W = 326; // 2026-10-20 사용자 요청 +20%
const DAYS = 84; // 12주 창
const DAY_W: Record<"day" | "week", number> = { day: 28.5, week: 12.4 }; // 2026-10-20 -5%

const mondayOf = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7; // 월=0
  return addDays(ymd, -wd);
};
const clampDay = (n: number) => Math.max(0, Math.min(DAYS - 1, n));

function rowOf(item: TodoItem, depth: 0 | 1, stageLabel?: string | null): Row | null {
  // 302: 종류가 있어도 기간(종료일 > 시작일)이 있으면 막대. ◆ 마일스톤은 하루짜리 종류 하위 작업만.
  const period = !!item.doDate && !!item.endDate && item.endDate > item.doDate;
  const ms = depth === 1 && !!item.milestoneKind && !period;
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
  // 하위 작업 보조 행(2026-10-20): 기본으로 펼쳐 상위 행 아래에 하위별 일정·상태를 잇는다. 행별 ▸/▾ 는 override, 도구줄 토글은 전체.
  const [subCache, setSubCache] = useState<SubCache>({});
  // 하위 작업 요약 팝오버(2026-10-20) — 하위 행을 누르면 큰 상세 대신 그 자리 근처에 유형·종류·기간·진행률·진척 내용만
  const [subPop, setSubPop] = useState<{ item: TodoItem; parentId: string | null; x: number; y: number } | null>(null);
  const [workTypes, setWorkTypes] = useState<TodoWorkType[] | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const openSubPop = (r: Row, x: number, y: number) => {
    setSubPop({ item: r.item, parentId: r.parentId ?? r.item.parentItemId, x, y });
    if (!workTypes)
      apiCall<{ types: TodoWorkType[] }>("/api/todo/work-types")
        .then((d) => setWorkTypes(d.types ?? []))
        .catch(() => setWorkTypes([]));
  };
  useEffect(() => {
    if (!subPop) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setSubPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSubPop(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [subPop]);
  const [showSubs, setShowSubs] = useState(true);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const requested = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const [edges, setEdges] = useState<DepEdge[]>([]);
  const [undatedOpen, setUndatedOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; startX: number; delta: number } | null>(null);
  const dayW = DAY_W[scale];
  const trackW = DAYS * dayW;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    try {
      if (window.localStorage.getItem("todo.tl.subs") === "0") setShowSubs(false);
    } catch {
      /* 저장소 없음 — 기본 펼침 */
    }
    return () => {
      mounted.current = false;
    };
  }, []);
  const isOpen = useCallback((id: string) => override[id] ?? showSubs, [override, showSubs]);

  // 펼칠 상위의 하위 작업을 상세 API 로 가져온다(동시 4건). 상위의 하위 수·완료 수·수정 시각이 바뀌면 다시 가져온다.
  useEffect(() => {
    const need = items.filter((it) => {
      if (it.parentItemId || !isMultiDay(it) || !isOpen(it.itemId)) return false;
      const sig = `${it.subtaskTotal}:${it.subtaskDone}:${it.updatedAt}`;
      if (requested.current.get(it.itemId) === sig) return false;
      requested.current.set(it.itemId, sig);
      return true;
    });
    if (!need.length) return;
    setSubCache((m) => {
      const n = { ...m };
      for (const it of need) if (!n[it.itemId]) n[it.itemId] = "loading";
      return n;
    });
    const queue = [...need];
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift()!;
        try {
          const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(it.itemId)}`);
          if (mounted.current) setSubCache((m) => ({ ...m, [it.itemId]: { subtasks: d.item.subtasks, stages: d.item.stages, workTypeAuto: d.item.workTypeAuto ?? null } }));
        } catch {
          requested.current.delete(it.itemId);
          if (mounted.current)
            setSubCache((m) => {
              const n = { ...m };
              delete n[it.itemId];
              return n;
            });
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
  }, [items, isOpen]);

  // ── 행 구성: 날짜 있는 상위(시작일 순) + 펼친 하위(보조 행) ──
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
      const ex = isMultiDay(r.item) && isOpen(r.item.itemId) ? subCache[r.item.itemId] : undefined;
      if (ex && ex !== "loading") {
        for (const st of ex.subtasks) {
          const stage = st.stageOrder != null ? ex.stages.find((s) => s.stageOrder === st.stageOrder) : null;
          const sub = rowOf(st, 1, stage ? `${stage.stageOrder}. ${stage.stageName}` : null);
          if (!sub) continue;
          sub.parentId = r.item.itemId;
          // 날짜 없는 하위는 상위 기간 위에 '날짜 미정' 점선 막대로 상태를 보인다
          if (sub.undated) {
            sub.start = r.start;
            sub.end = r.end;
          }
          rows.push(sub);
        }
      }
    }
    return { rows, undated };
  }, [items, subCache, isOpen]);

  // 상위별 하위 집계(완료 수·평균 진행율) — 상위 막대 하단 진척선·라벨 칩
  const subAgg = useMemo(() => {
    const out = new Map<string, { done: number; total: number; avg: number }>();
    for (const [pid, ex] of Object.entries(subCache)) {
      if (ex === "loading" || !ex.subtasks.length) continue;
      const done = ex.subtasks.filter((x) => x.status === "done").length;
      const avg = Math.round(ex.subtasks.reduce((a, x) => a + subPct(x), 0) / ex.subtasks.length);
      out.set(pid, { done, total: ex.subtasks.length, avg });
    }
    return out;
  }, [subCache]);

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

  const toggleExpand = (item: TodoItem) => setOverride((m) => ({ ...m, [item.itemId]: !isOpen(item.itemId) }));
  const toggleAllSubs = (on: boolean) => {
    setShowSubs(on);
    setOverride({});
    try {
      window.localStorage.setItem("todo.tl.subs", on ? "1" : "0");
    } catch {
      /* 저장소 없음 */
    }
  };

  // 하위 작업 날짜 이동은 목록(상위만 담음) 대신 직접 PATCH 하고 보조 행 캐시를 갱신한다.
  const patchRow = async (r: Row, patch: Record<string, unknown>, optimistic: Partial<TodoItem>) => {
    if (r.depth === 0) return onPatch(r.item.itemId, patch, optimistic);
    const pid = r.parentId ?? r.item.parentItemId;
    if (!pid) return;
    const upd = (fields: Partial<TodoItem>) =>
      setSubCache((m) => {
        const ex = m[pid];
        if (!ex || ex === "loading") return m;
        return { ...m, [pid]: { ...ex, subtasks: ex.subtasks.map((x) => (x.itemId === r.item.itemId ? { ...x, ...fields } : x)) } };
      });
    const before = { ...r.item };
    upd(optimistic);
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(r.item.itemId)}`, { method: "PATCH", body: JSON.stringify(patch) });
      upd(d.item);
    } catch (e) {
      console.error("[todo-timeline] 하위 작업 날짜 이동 실패", e);
      upd(before);
    }
  };

  // ── 좌표 ──
  const xOf = (ymd: string) => diffDays(ymd, windowStart) * dayW;
  const todayX = xOf(today);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.item.itemId, i])), [rows]);

  // ── 드래그(포인터) ──
  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>, r: Row) => {
    if (e.button !== 0 || r.undated || !r.item.canEdit || r.item.status === "done") return;
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
      if (r.depth === 1) openSubPop(r, e.clientX, e.clientY);
      else onOpen(r.item);
      return;
    }
    if (drag.mode === "resize") {
      const nextEnd = addDays(r.end, delta);
      if (nextEnd < r.start) return;
      const endDate = nextEnd === r.start ? null : nextEnd;
      await patchRow(r, { endDate }, { endDate });
      return;
    }
    if (r.milestone) {
      const field = r.item.actualDate ? "actualDate" : r.field === "do" ? "doDate" : "dueDate";
      const v = addDays(r.start, delta);
      await patchRow(r, { [field]: v }, { [field]: v } as Partial<TodoItem>);
      return;
    }
    if (r.field === "due") {
      const v = addDays(r.start, delta);
      await patchRow(r, { dueDate: v }, { dueDate: v });
      return;
    }
    const doDate = addDays(r.start, delta);
    const endDate = r.item.endDate ? addDays(r.item.endDate, delta) : null;
    await patchRow(r, { doDate, endDate }, { doDate, endDate });
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
  // 주말 열 배경(2026-10-20): 요일 글자 대신 일요일 옅은 붉은색·토요일 옅은 파란색을 날짜 머리칸·트랙 열 전체에 깐다.
  const weekendCols = useMemo(() => dayCells.map((d, i) => ({ i, wd: new Date(`${d}T12:00:00Z`).getUTCDay() })).filter((x) => x.wd === 0 || x.wd === 6), [dayCells]);

  const barStyle = (r: Row): CSSProperties => {
    const d = drag && drag.id === r.item.itemId ? drag.delta : 0;
    const start = drag?.mode === "resize" && drag.id === r.item.itemId ? r.start : addDays(r.start, d);
    const end = addDays(r.end, d);
    const x0 = clampDay(diffDays(start, windowStart));
    const x1 = clampDay(diffDays(end, windowStart));
    return { left: x0 * dayW + 1, width: Math.max(dayW - 2, (x1 - x0 + 1) * dayW - 2), ...tintStyle(r.item.boardColor) };
  };
  const visible = (r: Row) => !!r.start && diffDays(r.end, windowStart) >= 0 && diffDays(r.start, windowStart) < DAYS;
  const late = (r: Row) => !r.undated && r.item.status !== "done" && r.end < today;

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
  const subGroups = useMemo(() => {
    const out: { pi: number; last: number; x: number; tint: string }[] = [];
    rows.forEach((r, i) => {
      if (r.depth !== 0) return;
      let last = i;
      while (last + 1 < rows.length && rows[last + 1].depth === 1 && rows[last + 1].parentId === r.item.itemId) last += 1;
      if (last > i) out.push({ pi: i, last, x: clampDay(diffDays(r.start, windowStart)) * dayW + 5, tint: r.item.boardColor });
    });
    return out;
  }, [rows, windowStart, dayW]);

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
        <label className="todo-tl-subs" title="여러 날에 걸친(할 날~종료일) 일정의 하위 작업을 상위 행 아래 보조 행으로 펼칩니다. 하루 일정은 하위 완료 수만 표시">
          <input type="checkbox" checked={showSubs} onChange={(e) => toggleAllSubs(e.target.checked)} />
          하위 작업 펼치기
        </label>
        <div className="todo-tl-legend" aria-hidden="true">
          <span className="todo-tl-legend-row">
            <span className="todo-tl-lg-item">
              <span className="todo-tl-lg todo-tl-lg-bar" /> 기간
            </span>
            <span className="todo-tl-lg-item">
              <span className="todo-tl-lg todo-tl-lg-ms">◆</span> 마일스톤
            </span>
            <span className="todo-tl-lg-item">
              <Link2 className="w-3 h-3" /> 선행 → 후행 <em>(빨강 = 선행 지연)</em>
            </span>
          </span>
          <span className="todo-tl-legend-row">
            하위 상태
            {TODO_STATUSES.map((st) => (
              <span key={st} className="todo-tl-lg-item">
                <span className="todo-tl-lg-st" data-status={st} /> {TODO_STATUS_LABELS[st]}
              </span>
            ))}
            <span className="todo-tl-lg-item">
              <span className="todo-tl-lg-st" data-ghost="1" /> 날짜 미정
            </span>
          </span>
          <span className="todo-tl-legend-row todo-tl-legend-hint">막대를 끌면 일정 이동 · 오른쪽 끝을 끌면 종료일 변경</span>
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
                {weekendCols.map((w) => (
                  <span key={`we${w.i}`} className="todo-tl-we" data-we={w.wd === 0 ? "sun" : "sat"} style={{ left: w.i * dayW, width: dayW }} aria-hidden="true" />
                ))}
                {dayCells.map((d, i) => {
                  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
                  const isMon = wd === 1;
                  if (scale === "week" && !isMon) return null;
                  return (
                    <span key={d} className="todo-tl-day" data-today={d === today ? "1" : undefined} data-we={scale === "day" ? (wd === 0 ? "sun" : wd === 6 ? "sat" : undefined) : undefined} style={{ left: i * dayW, width: scale === "week" ? dayW * 7 : dayW }}>
                      {scale === "week" ? md(d) : Number(d.slice(8, 10))}
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
                  const multi = r.depth === 0 && isMultiDay(r.item);
                  const open = multi && isOpen(r.item.itemId);
                  const loadingSubs = open && subCache[r.item.itemId] === "loading";
                  const agg = subAgg.get(r.item.itemId);
                  return (
                    <div key={r.item.itemId} className="todo-tl-label" data-depth={r.depth} data-selected={selectedId === r.item.itemId ? "1" : undefined} style={{ height: ROW_H }}>
                      {r.depth === 0 ? (
                        multi ? (
                          <button type="button" className="todo-tl-caret" aria-expanded={open} title={open ? "하위 접기" : `하위 작업 ${r.item.subtaskTotal}건 펼치기`} onClick={() => toggleExpand(r.item)}>
                            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                          </button>
                        ) : (
                          <span className="todo-tl-caret" aria-hidden="true" />
                        )
                      ) : (
                        <span className="todo-tl-sub-ln" aria-hidden="true" />
                      )}
                      <StatusDot status={r.item.status} />
                      <button
                        type="button"
                        className="todo-tl-ttl"
                        title={r.item.title}
                        onClick={(e) => {
                          if (r.depth === 1) {
                            const b = e.currentTarget.getBoundingClientRect();
                            openSubPop(r, b.left + 24, b.bottom);
                          } else onOpen(r.item);
                        }}
                      >
                        {r.stageLabel ? <span className="todo-tl-stage">{r.stageLabel}</span> : null}
                        {r.item.title}
                      </button>
                      {r.item.openDeps > 0 && r.item.status !== "done" && (
                        <span className="todo-dep" title="선행 작업이 끝나야 시작할 수 있습니다">
                          ⛓ {r.item.openDeps}
                        </span>
                      )}
                      {r.depth === 1 && (
                        <span className="todo-tl-st" data-status={r.item.status} title={r.undated ? "날짜 미정 — 상위 기간 위에 점선으로 표시" : undefined}>
                          {r.undated ? "미정 · " : ""}
                          {TODO_STATUS_LABELS[r.item.status]}
                          {r.item.status !== "done" && r.item.progressPct != null ? ` ${r.item.progressPct}%` : ""}
                        </span>
                      )}
                      {r.depth === 0 && r.item.subtaskTotal > 0 && (
                        <span className="todo-tl-subn" title={agg ? `하위 ${agg.done}/${agg.total} 완료 · 평균 진행 ${agg.avg}%` : `하위 ${r.item.subtaskDone}/${r.item.subtaskTotal} 완료`}>
                          {loadingSubs ? "…" : `${agg?.done ?? r.item.subtaskDone}/${agg?.total ?? r.item.subtaskTotal}`}
                        </span>
                      )}
                      {r.depth === 0 && r.item.assigneeName && <span className="todo-tl-who">{r.item.assigneeName}</span>}
                    </div>
                  );
                })}
              </div>
              <div
                className="todo-tl-track"
                style={{ width: trackW, ["--tl-day" as string]: `${dayW}px`, ["--tl-row" as string]: `${ROW_H}px` } as CSSProperties}
              >
                {weekendCols.map((w) => (
                  <span key={`we${w.i}`} className="todo-tl-we" data-we={w.wd === 0 ? "sun" : "sat"} style={{ left: w.i * dayW, width: dayW }} aria-hidden="true" />
                ))}
                {rows.map((r, i) => (r.depth === 1 ? <span key={`sb${r.item.itemId}`} className="todo-tl-subband" style={{ top: i * ROW_H, height: ROW_H }} aria-hidden="true" /> : null))}
                {subGroups.map((g) => (
                  <span key={`lk${g.pi}`} className="todo-tl-link" style={{ left: g.x, top: g.pi * ROW_H + ROW_H - 6, height: (g.last - g.pi) * ROW_H - ROW_H / 2 + 6, ...tintStyle(g.tint) }} aria-hidden="true" />
                ))}
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
                      title={`${r.item.milestoneKind ? TODO_MILESTONE_LABELS[r.item.milestoneKind] ?? r.item.title : "마일스톤"} · ${r.item.actualDate ? `실제 ${md(r.item.actualDate)}` : `예정 ${md(r.start)}`}`}
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
                      data-status={r.depth === 1 ? r.item.status : undefined}
                      data-ghost={r.undated ? "1" : undefined}
                      data-done={r.item.status === "done" ? "1" : undefined}
                      data-late={late(r) ? "1" : undefined}
                      data-field={r.field}
                      data-drag={drag?.id === r.item.itemId ? drag.mode : undefined}
                      data-editable={!r.undated && r.item.canEdit && r.item.status !== "done" ? "1" : undefined}
                      style={{ top: i * ROW_H + 6, height: ROW_H - 12, ...barStyle(r) }}
                      title={`${r.item.title} · ${r.undated ? "날짜 미정(상위 기간에 표시)" : r.field === "due" ? `마감 ${md(r.start)}` : r.start === r.end ? md(r.start) : `${md(r.start)} ~ ${md(r.end)}`} · ${TODO_STATUS_LABELS[r.item.status]}${r.item.progressPct != null ? ` ${r.item.progressPct}%` : ""}`}
                      onPointerDown={(e) => onBarPointerDown(e, r)}
                      onPointerMove={onBarPointerMove}
                      onPointerUp={(e) => void onBarPointerUp(e, r)}
                    >
                      {r.depth === 1 && r.item.progressPct != null && r.item.status !== "done" && <span className="todo-tl-prog" style={{ width: `${r.item.progressPct}%` }} />}
                      {r.depth === 0 && subAgg.has(r.item.itemId) && <span className="todo-tl-agg" style={{ width: `${subAgg.get(r.item.itemId)!.avg}%` }} title={`하위 평균 진행 ${subAgg.get(r.item.itemId)!.avg}%`} />}
                      <span className="todo-tl-item-ttl">{r.undated ? `날짜 미정 · ${r.item.title}` : r.item.title}</span>
                      {r.depth === 1 && <span className="todo-tl-pct">{r.item.status === "done" ? "✓" : r.item.progressPct != null ? `${r.item.progressPct}%` : TODO_STATUS_LABELS[r.item.status]}</span>}
                      {r.field === "do" && !r.milestone && !r.undated && r.item.canEdit && r.item.status !== "done" && <span className="todo-tl-grip" aria-hidden="true" />}
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

      {subPop &&
        (() => {
          const it = subPop.item;
          const ex = subPop.parentId ? subCache[subPop.parentId] : undefined;
          const auto = ex && ex !== "loading" ? ex.workTypeAuto ?? null : null;
          const typeKey = auto ?? it.workType ?? null;
          const typeLabel = typeKey ? workTypes?.find((t) => t.typeKey === typeKey)?.label ?? (workTypes ? typeKey : "…") : "—";
          let kindLabel = "—";
          if (it.milestoneKind) {
            kindLabel = TODO_MILESTONE_LABELS[it.milestoneKind] ?? it.milestoneKind;
            for (const t of workTypes ?? []) for (const k of t.kinds) if (k.kindKey === it.milestoneKind) kindLabel = k.label;
          }
          const pct = it.status === "done" ? 100 : it.progressPct ?? 0;
          const parent = subPop.parentId ? items.find((x) => x.itemId === subPop.parentId) ?? null : null;
          const W = 300;
          const left = Math.max(8, Math.min(subPop.x - 24, (typeof window !== "undefined" ? window.innerWidth : 1920) - W - 8));
          // 아래 공간이 모자라면 클릭 지점 위로
          const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
          const top = subPop.y + 10 + 250 > vh ? Math.max(8, subPop.y - 250) : subPop.y + 10;
          return (
            <div ref={popRef} className="todo-vars todo-tl-pop" role="dialog" aria-label={`${it.title} 하위 작업 요약`} style={{ left, top, width: W }}>
              <div className="todo-tl-pop-h">
                <StatusDot status={it.status} />
                <b title={it.title}>{it.title}</b>
                <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label="닫기" onClick={() => setSubPop(null)}>
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
              <dl className="todo-tl-pop-dl">
                <dt>유형</dt>
                <dd>
                  {typeLabel}
                  {auto ? <span className="todo-mu"> · 자동</span> : null}
                </dd>
                <dt>종류</dt>
                <dd>{kindLabel}</dd>
                <dt>시작일</dt>
                <dd>{it.doDate ? md(it.doDate) : "—"}</dd>
                <dt>종료일</dt>
                <dd>{it.endDate ? md(it.endDate) : "—"}</dd>
                <dt>진행률</dt>
                <dd>
                  <span className="todo-tl-pop-bar" aria-hidden="true">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  {pct}% · {TODO_STATUS_LABELS[it.status]}
                </dd>
                <dt>진척 내용</dt>
                <dd className="todo-tl-pop-note">{it.progressNote?.trim() || "—"}</dd>
              </dl>
              {parent && (
                <div className="todo-tl-pop-f">
                  <button
                    type="button"
                    className="todo-link"
                    onClick={() => {
                      setSubPop(null);
                      onOpen(parent);
                    }}
                  >
                    상위 할 일에서 편집
                  </button>
                </div>
              )}
            </div>
          );
        })()}

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
