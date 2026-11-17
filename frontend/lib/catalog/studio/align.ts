/*
 * 여러 요소 정렬(사용자 요청 2026-11-17) — 고른 요소들의 상자(쪽 좌표 pt)로 각 요소를 얼마나 옮길지 계산하는 순수 함수.
 *   맞춤 6종: 왼쪽·가로 가운데·오른쪽 / 위·세로 가운데·아래 — 기준은 고른 요소 전체를 감싸는 상자.
 *   간격 2종: 가로·세로로 요소 사이 틈을 같게(3개 이상, 양 끝 요소는 그대로).
 *   격자 맞춤: 줄(세로 위치가 비슷한 요소)마다 위 끝을, 칸(같은 순번 또는 가로 위치가 비슷한 요소)마다 왼쪽 끝을 맞춘다.
 *     예) 표지 분야 6개를 2줄×3칸으로 놓으면 한 번에 줄·칸 시작 위치가 같아진다.
 * 실제 옮기기(스타일 덧씌우기)는 캔버스가 이 거리로 기존 옮기기와 같은 방식(movePatch)으로 한다.
 */

export interface AlignRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom" | "spaceX" | "spaceY" | "grid";

export const ALIGN_MIN: Record<AlignMode, number> = {
  left: 2,
  hcenter: 2,
  right: 2,
  top: 2,
  vmiddle: 2,
  bottom: 2,
  spaceX: 3,
  spaceY: 3,
  grid: 2,
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 각 요소를 옮길 거리(입력 순서). 고른 수가 모자라면 모두 0 */
export function alignDeltas(rects: AlignRect[], mode: AlignMode): Array<{ dx: number; dy: number }> {
  const zero = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < ALIGN_MIN[mode]) return zero;
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  switch (mode) {
    case "left":
      return rects.map((r) => ({ dx: r2(minX - r.x), dy: 0 }));
    case "hcenter":
      return rects.map((r) => ({ dx: r2((minX + maxX) / 2 - (r.x + r.w / 2)), dy: 0 }));
    case "right":
      return rects.map((r) => ({ dx: r2(maxX - (r.x + r.w)), dy: 0 }));
    case "top":
      return rects.map((r) => ({ dx: 0, dy: r2(minY - r.y) }));
    case "vmiddle":
      return rects.map((r) => ({ dx: 0, dy: r2((minY + maxY) / 2 - (r.y + r.h / 2)) }));
    case "bottom":
      return rects.map((r) => ({ dx: 0, dy: r2(maxY - (r.y + r.h)) }));
    case "spaceX":
      return spread(rects, "x");
    case "spaceY":
      return spread(rects, "y");
    case "grid":
      return grid(rects);
  }
}

/** 간격 같게 — 양 끝은 그대로, 사이 요소를 틈이 같도록 */
function spread(rects: AlignRect[], axis: "x" | "y"): Array<{ dx: number; dy: number }> {
  const pos = (r: AlignRect) => (axis === "x" ? r.x : r.y);
  const size = (r: AlignRect) => (axis === "x" ? r.w : r.h);
  const order = rects.map((_, i) => i).sort((a, b) => pos(rects[a]) - pos(rects[b]));
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = pos(last) + size(last) - pos(first);
  const total = order.reduce((s, i) => s + size(rects[i]), 0);
  const gap = (span - total) / (order.length - 1);
  const out = rects.map(() => ({ dx: 0, dy: 0 }));
  let at = pos(first);
  for (const i of order) {
    const d = r2(at - pos(rects[i]));
    out[i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    at += size(rects[i]) + gap;
  }
  return out;
}

/** 격자 맞춤 — 줄은 세로 가운데가 가까운 요소끼리(줄 안 가장 위에 맞춤), 칸은 줄마다 개수가 같으면 같은 순번끼리, 아니면 왼쪽 끝이 가까운 요소끼리(칸 안 가장 왼쪽에 맞춤) */
function grid(rects: AlignRect[]): Array<{ dx: number; dy: number }> {
  const idx = rects.map((_, i) => i);
  // 줄 — 세로 가운데 순으로 훑으며, 줄 첫 요소의 세로 가운데에서 (그 줄 높이의 절반)보다 멀면 새 줄
  const rows: number[][] = [];
  let ref: { cy: number; half: number } | null = null;
  for (const i of [...idx].sort((a, b) => rects[a].y + rects[a].h / 2 - (rects[b].y + rects[b].h / 2))) {
    const cy = rects[i].y + rects[i].h / 2;
    if (!ref || Math.abs(cy - ref.cy) > Math.max(ref.half, rects[i].h / 2)) {
      rows.push([i]);
      ref = { cy, half: rects[i].h / 2 };
    } else rows[rows.length - 1].push(i);
  }
  for (const row of rows) row.sort((a, b) => rects[a].x - rects[b].x);
  // 칸
  let cols: number[][];
  if (rows.length > 1 && rows.every((row) => row.length === rows[0].length)) {
    cols = rows[0].map((_, j) => rows.map((row) => row[j]));
  } else {
    cols = [];
    const minW = Math.min(...rects.map((r) => r.w));
    for (const i of [...idx].sort((a, b) => rects[a].x - rects[b].x)) {
      const col = cols[cols.length - 1];
      if (col && rects[i].x - rects[col[0]].x <= minW / 2) col.push(i);
      else cols.push([i]);
    }
  }
  const out = rects.map(() => ({ dx: 0, dy: 0 }));
  for (const row of rows) {
    const top = Math.min(...row.map((i) => rects[i].y));
    for (const i of row) out[i].dy = r2(top - rects[i].y);
  }
  for (const col of cols) {
    const left = Math.min(...col.map((i) => rects[i].x));
    for (const i of col) out[i].dx = r2(left - rects[i].x);
  }
  return out;
}
