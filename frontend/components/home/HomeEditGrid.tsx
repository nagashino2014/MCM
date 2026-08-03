"use client";

// 홈 편집 그리드(HC-B) — 12열 CSS Grid 위에 카드를 스냅 배치한다.
// 편집 모드에서만 드래그(이동)와 우하단 핸들(크기 조절)이 활성화되며, 이동/리사이즈는
// 항상 열·행 단위로 스냅되므로 배치가 어긋나지 않는다(라이브러리 없이 포인터 이벤트만 사용).
// 고정 영역(KPI·결재 대기·안읽은 메일·캘린더)은 이 그리드 밖에서 렌더되므로 여기 들어오지 않는다.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { HOME_COLS, HOME_MIN_W, HOME_ROW_H, type HomeLayout, type HomeLayoutItem } from "@/lib/home/widgets";

const COLS = HOME_COLS;
const GAP = 16;

export interface HomeGridEntry {
  key: string;
  node: ReactNode;
  /** 저장된 배치가 없을 때 쓰는 기본 폭/높이. */
  defaultW: number;
  defaultH: number;
}

/** resize-x=가로만, resize-y=세로만, resize=양쪽(우하단 모서리). */
type DragMode = "move" | "resize" | "resize-x" | "resize-y";

interface DragState {
  key: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origin: HomeLayoutItem;
  colW: number;
}

function collides(a: HomeLayoutItem, b: HomeLayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 이미 놓인 카드들과 겹치지 않는 첫 빈 자리(위→아래, 좌→우 스캔). */
function firstFreeSlot(placed: HomeLayoutItem[], w: number, h: number): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const cand = { x, y, w, h };
      if (!placed.some((p) => collides(cand, p))) return { x, y };
    }
  }
}

/**
 * 저장된 배치가 없는 카드는 빈 자리를 찾아 자동 배치한다(first-fit).
 * ⚠ 단순 흘림(커서 진행)으로 하면 저장된 카드의 자리를 보지 않아, 카탈로그에 새 위젯이
 * 추가될 때(예: 데이터 지표) 기존 배치 위에 그대로 겹쳤다 — 높이 2짜리 카드의 세로 겹침 포함.
 */
function withDefaults(entries: HomeGridEntry[], layout: HomeLayout): Record<string, HomeLayoutItem> {
  const items: Record<string, HomeLayoutItem> = {};
  const placed: HomeLayoutItem[] = [];
  // 저장된 카드를 먼저 전부 등록해 점유 영역을 확정한다.
  for (const e of entries) {
    const saved = layout.items[e.key];
    if (saved) {
      items[e.key] = saved;
      placed.push(saved);
    }
  }
  for (const e of entries) {
    if (items[e.key]) continue;
    const w = Math.min(COLS, e.defaultW);
    const h = e.defaultH;
    const pos = firstFreeSlot(placed, w, h);
    const item = { ...pos, w, h };
    items[e.key] = item;
    placed.push(item);
  }
  return items;
}

export function HomeEditGrid({
  entries,
  layout,
  editing,
  onChange,
}: {
  entries: HomeGridEntry[];
  layout: HomeLayout;
  editing: boolean;
  onChange: (items: Record<string, HomeLayoutItem>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [items, setItems] = useState<Record<string, HomeLayoutItem>>(() => withDefaults(entries, layout));
  // 드래그 종료 시점에 최신 배치를 읽기 위한 미러(렌더 중 setState 회피).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // 표시 카드 구성이나 저장된 배치가 바뀌면 다시 계산한다(드래그 중에는 건드리지 않는다).
  useEffect(() => {
    if (drag) return;
    setItems(withDefaults(entries, layout));
    // entries 는 매 렌더 새 배열이므로 키 목록으로만 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.map((e) => e.key).join(","), layout]);

  const begin = useCallback(
    (e: React.PointerEvent, key: string, mode: DragMode) => {
      if (!editing || !ref.current) return;
      e.preventDefault();
      const colW = (ref.current.clientWidth - GAP * (COLS - 1)) / COLS;
      setDrag({ key, mode, startX: e.clientX, startY: e.clientY, origin: items[key], colW });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [editing, items]
  );

  useEffect(() => {
    if (!drag) return;

    const move = (ev: PointerEvent) => {
      const dCol = Math.round((ev.clientX - drag.startX) / (drag.colW + GAP));
      const dRow = Math.round((ev.clientY - drag.startY) / (HOME_ROW_H + GAP));
      setItems((prev) => {
        const cur = prev[drag.key];
        if (!cur) return prev;
        const wNext = Math.max(HOME_MIN_W, Math.min(COLS - cur.x, drag.origin.w + dCol));
        const hNext = Math.max(1, Math.min(4, drag.origin.h + dRow));
        const next: HomeLayoutItem =
          drag.mode === "move"
            ? {
                ...cur,
                x: Math.max(0, Math.min(COLS - cur.w, drag.origin.x + dCol)),
                y: Math.max(0, drag.origin.y + dRow),
              }
            : {
                ...cur,
                w: drag.mode === "resize-y" ? cur.w : wNext,
                h: drag.mode === "resize-x" ? cur.h : hNext,
              };
        if (next.x === cur.x && next.y === cur.y && next.w === cur.w && next.h === cur.h) return prev;
        return { ...prev, [drag.key]: next };
      });
    };

    const end = () => {
      setDrag(null);
      // 최신 배치를 부모에 올려 저장한다.
      // setItems updater 안에서 onChange 를 부르면 "렌더 중 다른 컴포넌트 setState" 경고가 난다
      // (updater 는 렌더 단계에서 실행될 수 있다) — ref 로 최신값을 읽어 이벤트 핸들러에서 호출한다.
      onChange(itemsRef.current);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [drag, onChange]);

  return (
    <div
      ref={ref}
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
        // 행 높이를 고정한다 — minmax(…, auto) 로 두면 그 행에서 가장 높은 카드에 맞춰 늘어나고,
        // 정작 카드는 콘텐츠 높이만 차지해 리사이즈(h) 변경이 화면에 드러나지 않았다.
        gridAutoRows: `${HOME_ROW_H}px`,
      }}
    >
      {entries.map((e) => {
        const it = items[e.key];
        if (!it) return null;
        const active = drag?.key === e.key;
        return (
          <div
            key={e.key}
            // 위젯이 권한 없음/데이터 없음으로 아무것도 렌더하지 않으면(카드 내부에서 null 반환)
            // 빈 상자만 남아 자리를 차지한다 — 그런 셀은 접는다.
            // 편집 중에는 배치를 확인해야 하므로 그대로 둔다.
            className={"min-w-0 relative h-full" + (editing ? "" : " [&:not(:has(section))]:hidden")}
            style={{
              gridColumn: `${it.x + 1} / span ${it.w}`,
              gridRow: `${it.y + 1} / span ${it.h}`,
              zIndex: active ? 20 : undefined,
            }}
          >
            {/* 카드는 항상 배치 상자를 꽉 채운다 — 크기를 늘리면 카드가 같이 늘어나고,
                줄이면 카드 본문이 스크롤된다(HomeCard 본문이 overflow-y-auto). */}
            <div
              className="h-full rounded-[18px] [&>section]:h-full"
              style={
                editing
                  ? {
                      outline: `2px dashed ${active ? "var(--cd-primary)" : "var(--cd-line)"}`,
                      outlineOffset: 2,
                      opacity: active ? 0.85 : 1,
                    }
                  : undefined
              }
            >
              {e.node}
            </div>

            {editing && (
              <>
                {/* 이동 손잡이 — 카드 안쪽 콘텐츠 클릭과 겹치지 않게 좌상단에 띄운다. */}
                <button
                  type="button"
                  onPointerDown={(ev) => begin(ev, e.key, "move")}
                  className="absolute -top-2 -left-2 z-10 w-7 h-7 rounded-lg inline-flex items-center justify-center cursor-grab active:cursor-grabbing cd-grad-fill"
                  title="드래그해서 위치 이동"
                  aria-label={`${e.key} 위치 이동`}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </button>
                {/* 크기 조절 — 축을 따로 잡을 수 있게 가로/세로/양쪽 3개로 나눈다. */}
                <span
                  onPointerDown={(ev) => begin(ev, e.key, "resize-x")}
                  className="absolute top-1/2 -right-1 -translate-y-1/2 z-10 w-1.5 h-10 rounded-full cursor-ew-resize"
                  style={{ background: "var(--cd-primary)", opacity: 0.75 }}
                  title="드래그해서 너비 조절"
                />
                <span
                  onPointerDown={(ev) => begin(ev, e.key, "resize-y")}
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-10 h-1.5 w-10 rounded-full cursor-ns-resize"
                  style={{ background: "var(--cd-primary)", opacity: 0.75 }}
                  title="드래그해서 높이 조절"
                />
                <span
                  onPointerDown={(ev) => begin(ev, e.key, "resize")}
                  className="absolute -bottom-1 -right-1 z-10 w-4 h-4 rounded-br-[6px] cursor-nwse-resize"
                  style={{
                    borderRight: "3px solid var(--cd-primary)",
                    borderBottom: "3px solid var(--cd-primary)",
                  }}
                  title="드래그해서 너비·높이 함께 조절"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
