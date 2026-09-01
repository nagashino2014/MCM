/**
 * 노드트리 편집 조작 — 에디터의 텍스트 커밋·반복 항목 추가/삭제/이동.
 * 모든 함수는 원본을 건드리지 않고 새 트리를 돌려준다(undo/redo 스냅샷 스택과 호환).
 */
import type { DocNode } from "./types";

function clone(tree: DocNode): DocNode {
  return JSON.parse(JSON.stringify(tree)) as DocNode;
}

function genId(): string {
  return "n" + Math.random().toString(36).slice(2, 10);
}

/** id 로 노드와 그 부모를 찾는다. */
function findWithParent(root: DocNode, id: string): { node: DocNode; parent: DocNode | null } | null {
  if (root.id === id) return { node: root, parent: null };
  const stack: DocNode[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of cur.children ?? []) {
      if (child.id === id) return { node: child, parent: cur };
      stack.push(child);
    }
  }
  return null;
}

export function findNode(root: DocNode, id: string): DocNode | null {
  return findWithParent(root, id)?.node ?? null;
}

export function findParent(root: DocNode, id: string): DocNode | null {
  return findWithParent(root, id)?.parent ?? null;
}

/** 문단 블록 편집 커밋 — 해당 노드의 자식만 통째로 교체(노드 자체의 스타일·그룹 마킹은 유지). */
export function replaceNodeChildren(root: DocNode, id: string, children: DocNode[]): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || hit.node.tag === "#text") return root;
  hit.node.children = children.length > 0 ? children.map((c) => clone(c)) : undefined;
  return next;
}

/** 범용 블록 복제 — 반복 그룹이 아니어도 임의의 블록을 같은 서식으로 바로 뒤에 복제. */
export function duplicateNode(root: DocNode, id: string): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || !hit.parent) return root;
  const children = hit.parent.children!;
  const copy = clone(hit.node);
  reassignIds(copy);
  // 반복 그룹 항목을 이 경로로 복제하면 그룹 카운트가 늘어나는 건 동일하므로 마킹은 유지한다.
  children.splice(children.indexOf(hit.node) + 1, 0, copy);
  return next;
}

/** 범용 블록 삭제 — 루트는 불가. */
export function removeNode(root: DocNode, id: string): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || !hit.parent) return root;
  const children = hit.parent.children!;
  children.splice(children.indexOf(hit.node), 1);
  return next;
}

/** 장식 불릿 span 판정 — 원형(border-radius 50%) + 배경색 + 자식 없음. */
function isBulletSpan(node: DocNode | undefined): boolean {
  if (!node || node.tag !== "span" || (node.children?.length ?? 0) > 0) return false;
  const s = node.style ?? {};
  return /50%|999/.test(s.borderRadius ?? "") && Boolean(s.background ?? s.backgroundColor);
}

/** 글머리 기호 토글 — 블록 첫머리에 액센트 도트를 넣거나 뺀다(템플릿 불릿과 동일한 룩). */
export function toggleBulletNode(root: DocNode, id: string): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || hit.node.tag === "#text") return root;
  const children = (hit.node.children ??= []);
  // flex + gap 블록(템플릿 근무환경 항목 등)은 gap 이 이미 간격을 주므로 도트에 margin 을 겹치지 않는다.
  const blockStyle = hit.node.style ?? {};
  const hasFlexGap = (blockStyle.display ?? "").includes("flex") && Boolean(blockStyle.gap);
  if (isBulletSpan(children[0])) {
    children.shift();
    // 도트 뒤 공백 텍스트가 남아 있으면 앞 공백만 정리
    if (children[0]?.tag === "#text") children[0].text = (children[0].text ?? "").replace(/^\s+/, "");
  } else {
    children.unshift({
      id: genId(),
      tag: "span",
      style: {
        display: "inline-block",
        width: "5px",
        height: "5px",
        background: "var(--accent)",
        borderRadius: "50%",
        ...(hasFlexGap ? {} : { marginRight: "10px" }),
        verticalAlign: "middle",
        flexShrink: "0",
      },
    });
  }
  return next;
}

/** 블록 첫머리에 글머리 도트가 있는지 — 여백 조절 버튼 활성 판정용. */
export function hasBullet(node: DocNode | null): boolean {
  return Boolean(node && isBulletSpan(node.children?.[0]));
}

/**
 * 글머리 기호와 텍스트 사이 여백 조절(px 단위 증감).
 * flex+gap 블록이면 블록의 gap 을, 아니면 도트의 marginRight 를 조절한다(최소 0).
 */
export function adjustBulletGap(root: DocNode, id: string, delta: number): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || !isBulletSpan(hit.node.children?.[0])) return root;
  const px = (v: string | undefined, fallback: number) => {
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? "");
    return m ? Number(m[1]) : fallback;
  };
  const blockStyle = (hit.node.style ??= {});
  const dot = hit.node.children![0];
  const dotStyle = (dot.style ??= {});
  if ((blockStyle.display ?? "").includes("flex") && blockStyle.gap) {
    blockStyle.gap = `${Math.max(0, px(blockStyle.gap, 10) + delta)}px`;
  } else {
    dotStyle.marginRight = `${Math.max(0, px(dotStyle.marginRight, 10) + delta)}px`;
  }
  return next;
}

/** 블록 글자 크기 지정(px) — 도구 바 A−/A+ 커밋. */
export function setNodeFontSize(root: DocNode, id: string, px: number): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || hit.node.tag === "#text") return root;
  (hit.node.style ??= {}).fontSize = `${Math.min(Math.max(px, 8), 96)}px`;
  return next;
}

/** 지정 노드 바로 뒤에 새 노드 삽입 — 독립 이미지 블록 등. */
export function insertNodeAfter(root: DocNode, refId: string, node: DocNode): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, refId);
  if (!hit || !hit.parent) return root;
  const copy = clone(node);
  reassignIds(copy);
  const children = hit.parent.children!;
  children.splice(children.indexOf(hit.node) + 1, 0, copy);
  return next;
}

/** 블록 크기 조절 커밋 — 리사이즈 핸들 드래그 종료 시 width/height(px) 반영. */
export function resizeNode(root: DocNode, id: string, size: { width?: number; height?: number }): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || hit.node.tag === "#text") return root;
  const style = (hit.node.style ??= {});
  if (size.width != null) style.width = `${Math.max(8, Math.round(size.width))}px`;
  if (size.height != null) style.height = `${Math.max(8, Math.round(size.height))}px`;
  return next;
}

/**
 * 위치 미세조정(nudge) — position:relative 오프셋을 px 단위로 누적.
 * 플로우 레이아웃을 유지한 채 시각 위치만 살짝 옮긴다(0,0 이 되면 오프셋 제거).
 */
export function nudgeNode(root: DocNode, id: string, dx: number, dy: number): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || !hit.parent || hit.node.tag === "#text") return root;
  const style = (hit.node.style ??= {});
  const px = (v: string | undefined) => {
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? "");
    return m ? Number(m[1]) : 0;
  };
  const left = px(style.left) + dx;
  const top = px(style.top) + dy;
  if (left === 0 && top === 0 && (style.position === "relative" || !style.position)) {
    delete style.left;
    delete style.top;
    if (style.position === "relative") delete style.position;
  } else {
    if (!style.position) style.position = "relative";
    style.left = `${left}px`;
    style.top = `${top}px`;
  }
  return next;
}

/** 범용 블록 이동 — 같은 부모 안에서 이웃 형제와 자리 교환. */
export function moveNode(root: DocNode, id: string, dir: -1 | 1): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (!hit || !hit.parent) return root;
  const children = hit.parent.children!;
  const idx = children.indexOf(hit.node);
  const target = idx + dir;
  if (target < 0 || target >= children.length) return root;
  [children[idx], children[target]] = [children[target], children[idx]];
  return next;
}

/** 텍스트 노드의 내용 교체. */
export function updateNodeText(root: DocNode, id: string, text: string): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, id);
  if (hit && hit.node.tag === "#text") hit.node.text = text;
  return next;
}

/** 노드 순회 순서대로 텍스트 노드를 수집(항목 간 대응 비교용). */
function collectTexts(node: DocNode, out: DocNode[] = []): DocNode[] {
  if (node.tag === "#text") out.push(node);
  node.children?.forEach((c) => collectTexts(c, out));
  return out;
}

/** 서브트리의 모든 id 재발급(복제 항목용). */
function reassignIds(node: DocNode): void {
  node.id = genId();
  node.children?.forEach(reassignIds);
}

/** 같은 부모 아래 그룹 항목(구분자 제외) 인덱스 목록. */
function groupItemIndexes(parent: DocNode, groupId: string): number[] {
  const out: number[] = [];
  (parent.children ?? []).forEach((c, i) => {
    if (c.repeatGroup === groupId && !c.separator) out.push(i);
  });
  return out;
}

/**
 * "STEP 3" → "STEP 4" 식 자동 증가.
 * 그룹의 기존 항목들에서 k번째 텍스트가 "숫자만 다른 동일 문구"면, 복제본의 그 텍스트를 max+1 로 바꾼다.
 */
function autoIncrementNumbers(parent: DocNode, groupId: string, newItem: DocNode): void {
  const items = (parent.children ?? []).filter((c) => c.repeatGroup === groupId && !c.separator && c !== newItem);
  if (items.length < 2) return;
  const textLists = items.map((it) => collectTexts(it).map((t) => t.text ?? ""));
  const newTexts = collectTexts(newItem);
  const len = Math.min(...textLists.map((l) => l.length), newTexts.length);
  for (let k = 0; k < len; k++) {
    const variants = textLists.map((l) => l[k]);
    const m0 = variants[0].match(/^(.*?)(\d+)(.*)$/);
    if (!m0) continue;
    const [, prefix, , suffix] = m0;
    const nums: number[] = [];
    let uniform = true;
    for (const v of variants) {
      const m = v.match(/^(.*?)(\d+)(.*)$/);
      if (!m || m[1] !== prefix || m[3] !== suffix) { uniform = false; break; }
      nums.push(Number(m[2]));
    }
    if (uniform && new Set(nums).size === nums.length) {
      newTexts[k].text = `${prefix}${Math.max(...nums) + 1}${suffix}`;
    }
  }
}

/**
 * grid-template-columns 재계산 — 전형절차처럼 컬럼 정의가 자식 1:1 대응("1fr auto 1fr … 1fr")인
 * 그리드에서만, 자식 수 변화에 맞춰 앞 두 토큰 패턴을 반복해 재구성한다.
 */
function recalcGridColumns(parent: DocNode, prevChildCount: number): void {
  const colsRaw = parent.style?.gridTemplateColumns;
  const kids = parent.children ?? [];
  if (!colsRaw || !parent.style) return;
  const cols = colsRaw.trim().split(/\s+/);
  if (cols.length !== prevChildCount || cols.length < 2) return; // 1:1 대응 그리드가 아니면 손대지 않는다
  const unit = [cols[0], cols[1]];
  parent.style.gridTemplateColumns = kids.map((_, i) => unit[i % 2]).join(" ");
}

/** 반복 항목 복제 — itemId 항목 바로 뒤에 사본 삽입(필요 시 구분자 동반). */
export function addRepeatItem(root: DocNode, itemId: string): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, itemId);
  if (!hit || !hit.parent || !hit.node.repeatGroup || hit.node.separator) return root;
  const parent = hit.parent;
  const groupId = hit.node.repeatGroup;
  const children = parent.children!;
  const prevCount = children.length;
  const idx = children.indexOf(hit.node);

  const copy = clone(hit.node);
  reassignIds(copy);

  // 구분자를 쓰는 그룹이면 (구분자 + 사본) 을 삽입해 패턴 유지
  const sep = children.find((c) => c.repeatGroup === groupId && c.separator);
  const insert: DocNode[] = [];
  if (sep) {
    const sepCopy = clone(sep);
    reassignIds(sepCopy);
    insert.push(sepCopy);
  }
  insert.push(copy);
  children.splice(idx + 1, 0, ...insert);

  autoIncrementNumbers(parent, groupId, copy);
  recalcGridColumns(parent, prevCount);
  return next;
}

/** 반복 항목 삭제 — 그룹의 마지막 1개는 남긴다(그룹 자체가 소실되면 복구 불가). */
export function removeRepeatItem(root: DocNode, itemId: string): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, itemId);
  if (!hit || !hit.parent || !hit.node.repeatGroup || hit.node.separator) return root;
  const parent = hit.parent;
  const groupId = hit.node.repeatGroup;
  if (groupItemIndexes(parent, groupId).length <= 1) return root;
  const children = parent.children!;
  const prevCount = children.length;
  const idx = children.indexOf(hit.node);

  // 인접 구분자(앞 우선, 없으면 뒤)를 함께 제거해 패턴 유지
  const prev = children[idx - 1];
  const nextSib = children[idx + 1];
  if (prev?.repeatGroup === groupId && prev.separator) children.splice(idx - 1, 2);
  else if (nextSib?.repeatGroup === groupId && nextSib.separator) children.splice(idx, 2);
  else children.splice(idx, 1);

  recalcGridColumns(parent, prevCount);
  return next;
}

/** 반복 항목 순서 이동 — 같은 그룹의 이웃 항목과 자리를 맞바꾼다(구분자는 제자리). */
export function moveRepeatItem(root: DocNode, itemId: string, dir: -1 | 1): DocNode {
  const next = clone(root);
  const hit = findWithParent(next, itemId);
  if (!hit || !hit.parent || !hit.node.repeatGroup || hit.node.separator) return root;
  const parent = hit.parent;
  const idxs = groupItemIndexes(parent, hit.node.repeatGroup);
  const children = parent.children!;
  const pos = idxs.indexOf(children.indexOf(hit.node));
  const targetPos = pos + dir;
  if (pos < 0 || targetPos < 0 || targetPos >= idxs.length) return root;
  const a = idxs[pos], b = idxs[targetPos];
  [children[a], children[b]] = [children[b], children[a]];
  return next;
}
