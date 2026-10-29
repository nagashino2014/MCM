/*
 * 요소 겹침 판정(L3 자유 배치) — 옮긴 요소가 다른 보이는 요소의 글 상자와 겹치는지. 클라이언트 안전 순수 함수.
 *   옮긴 요소 = 편집층이 위치(left·top)를 준 노드(끌어 옮기기·묶음 옮기기·방향키) + 추가한 요소(글상자·도형·이미지·일러스트)
 *   글 상자   = 글 블록 · 데이터 영역·인포그래픽 · 추가한 글상자 — 서로 안에 들지 않는 가장 바깥 단위
 *   상자는 캔버스가 DOM 에서 잰다(getBoundingClientRect, 쪽 좌표 pt). 글 블록·글상자는 줄 상자로 재서 글이 없는 빈 폭은 빼고 본다.
 * L3 이동은 흐름 안 상대 이동이라 옆 요소와 겹칠 수 있다 — 막지는 않고 쪽 검사에 경고로 남긴다(PDF 도 같은 모양).
 */
import type { CNode } from "./nodes";
import { isTextBlock } from "./select";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 재는 방법 — lines = 글 줄 상자(Range.getClientRects), box = 요소 상자 */
export type OverlapMeasure = "lines" | "box";

export interface OverlapNode {
  node: CNode;
  /** 쪽 루트부터 이 노드까지 */
  path: CNode[];
  measure: OverlapMeasure;
}

/** 판정 입력 — 잰 상자들과 조상 경로(쪽 루트부터 자신까지 id) */
export interface OverlapBox {
  id: string;
  path: string[];
  rects: Rect[];
}

export interface OverlapHit {
  /** 옮긴 요소 */
  id: string;
  /** 겹친 상대 */
  otherId: string;
  /** 겹친 부분을 감싸는 상자(쪽 좌표) */
  rect: Rect;
}

/** 이보다 얇게 닿은 것은 겹침으로 보지 않는다(pt) — 그리드에 맞춰 맞닿은 가장자리·글자 상자 반올림 */
export const OVERLAP_MIN = 2;

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

const union = (a: Rect | null, b: Rect): Rect => {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** 상자들을 감싸는 상자(없으면 null) */
export function boundsOf(rects: Rect[]): Rect | null {
  return rects.reduce<Rect | null>((acc, r) => union(acc, r), null);
}

const round = (v: number) => Math.round(v * 10) / 10;

/** 옮긴 요소(subjects)와 글 상자(targets)의 겹침 — 자기 자신·조상·자손은 빼고, 같은 쌍은 한 번만. 겹친 넓이 큰 순 */
export function findOverlaps(subjects: OverlapBox[], targets: OverlapBox[], min = OVERLAP_MIN): OverlapHit[] {
  const out: Array<OverlapHit & { area: number }> = [];
  const seen = new Set<string>();
  for (const s of subjects) {
    for (const t of targets) {
      if (t.id === s.id || s.path.includes(t.id) || t.path.includes(s.id)) continue;
      const key = s.id < t.id ? `${s.id}|${t.id}` : `${t.id}|${s.id}`;
      if (seen.has(key)) continue;
      let hit: Rect | null = null;
      for (const a of s.rects) {
        for (const b of t.rects) {
          const r = intersectRect(a, b);
          if (r && r.w >= min && r.h >= min) hit = union(hit, r);
        }
      }
      if (!hit) continue;
      seen.add(key);
      out.push({ id: s.id, otherId: t.id, rect: { x: round(hit.x), y: round(hit.y), w: round(hit.w), h: round(hit.h) }, area: hit.w * hit.h });
    }
  }
  return out.sort((a, b) => b.area - a.area).map(({ area: _a, ...h }) => (void _a, h));
}

const isAddedRoot = (n: CNode) => n.origin === "add" && (n.owner == null || n.owner === n.id);
const isAddedText = (n: CNode) => isAddedRoot(n) && n.className?.split(/\s+/).includes("kc-x-text") === true;
const nonZeroPx = (v: unknown) => v != null && v !== "" && v !== "auto" && Math.abs(parseFloat(String(v))) > 0.01;

/** 편집층으로 옮긴 노드인가 — 상대·절대 위치에 left·top 이 0 이 아님(편집한 기본 노드), 또는 추가한 요소 */
export function isMovedNode(n: CNode): boolean {
  if (isAddedRoot(n)) return true;
  if (!n.edited || n.origin === "pin" || n.origin === "add") return false;
  const s = n.style ?? {};
  return (s.position === "relative" || s.position === "absolute") && (nonZeroPx(s.left) || nonZeroPx(s.top));
}

const measureOf = (n: CNode, parent: CNode | null): OverlapMeasure => (isAddedText(n) || (!n.widget && isTextBlock(n, parent)) ? "lines" : "box");

/** 쪽의 옮긴 요소(겹침을 볼 주체) — 옮긴 상자 안의 옮긴 글도 따로 본다 */
export function movedNodes(root: CNode): OverlapNode[] {
  const out: OverlapNode[] = [];
  const walk = (path: CNode[]) => {
    const n = path[path.length - 1];
    if (n.tag === "#text") return;
    const parent = path.length > 1 ? path[path.length - 2] : null;
    if (path.length > 1 && isMovedNode(n)) out.push({ node: n, path, measure: measureOf(n, parent) });
    // 추가한 요소·데이터 영역 안은 통째로 움직인다
    if (isAddedRoot(n) || n.widget) return;
    n.children?.forEach((c) => walk([...path, c]));
  };
  walk([root]);
  return out;
}

/** 쪽의 글 상자(겹침 상대 후보) — 글 블록·데이터 영역·인포그래픽·추가한 글상자. 그 안으로는 내려가지 않는다 */
export function textBoxNodes(root: CNode): OverlapNode[] {
  const out: OverlapNode[] = [];
  const walk = (path: CNode[]) => {
    const n = path[path.length - 1];
    if (n.tag === "#text") return;
    const parent = path.length > 1 ? path[path.length - 2] : null;
    if (path.length > 1) {
      if (n.widget || isAddedText(n) || isTextBlock(n, parent)) {
        out.push({ node: n, path, measure: measureOf(n, parent) });
        return;
      }
      // 글 없는 추가 요소(도형·이미지)는 글 상자가 아니다
      if (isAddedRoot(n)) return;
    }
    n.children?.forEach((c) => walk([...path, c]));
  };
  walk([root]);
  return out;
}

/** 판정 입력으로 — 잰 상자(rectsOf 가 null 이면 보이지 않는 요소라 뺀다) */
export function toBoxes(list: OverlapNode[], rectsOf: (n: OverlapNode) => Rect[] | null): OverlapBox[] {
  return list.flatMap((o) => {
    const rects = rectsOf(o);
    return rects && rects.length ? [{ id: o.node.id, path: o.path.map((p) => p.id), rects }] : [];
  });
}
