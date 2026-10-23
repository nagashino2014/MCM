/*
 * 회사소개서 스튜디오(P5) 노드 트리 — 홍보·채용공고 노드 트리(lib/recruit DocNode)를 회사소개서 쪽에 맞게 넓힌 것. 클라이언트 안전.
 *
 * 문서 모델(블루프린트 §8-1)
 *   쪽 = 고정 842×595 루트 노드(section.pk-sheet). 쪽의 '기본 트리'는 쪽 계획(plan.tsx)의 React 요소를 그대로 노드로 바꾼 것이라
 *   저장하지 않고 열 때마다 최신 데이터로 다시 만든다. 사용자가 고친 것만 '편집층'(edits.ts)으로 저장한다(catalog_pages.tree).
 *   → 계약이 늘어 데이터가 바뀌어도 기본 트리는 새 값으로, 편집층은 같은 노드 id 에 다시 붙는다.
 *
 *   노드 확장
 *     className   디자인 시스템 클래스(kc-*·pk-*)
 *     attrs       그 밖의 속성(data-ref·data-folio·href·viewBox 등) — 기본 트리는 코드가 만든 값, 편집층은 화이트리스트만
 *     bind        데이터 바인딩 "metric:지표 id" | "data:경로" — 그릴 때 최신 값으로 숫자 글자를 바꾼다(고정한 글 속 칩)
 *     widget      데이터 위젯 종류(cases·people·table·timeline·org·logos·credentials·map·chips) 또는 "infographic"
 *                 → 위젯 안은 글 고치기 대상이 아니다(행 단위 수정은 데이터 화면에서). infographic 은 유형 바꾸기 대상
 *     props       x-icon {name, cls} · infographic {slot, spec, box, area}
 *     asset       이미지 자산 참조 — 키("a/{asset_id}" catalog_assets, "k/…" 키트 파일)와 초점·확대·맞춤
 *   파생 표식(저장하지 않음): origin base|pin|add, owner(고정·추가 노드의 소유 노드 id), pinned, edited, hiddenByEdit
 */
import type { TreeNodeLike } from "@/lib/doc-tree/tree-core";

export interface ImageRef {
  /** 이미지 키 — "a/{asset_id}" | "k/assets/…" */
  key: string;
  /** 초점(%) — object-position */
  fx?: number;
  fy?: number;
  /** 확대(1~3) — 초점 기준으로 키운다(자르기) */
  zoom?: number;
  /** 맞춤 — cover(채우기, 기본) | contain(전체 보기) */
  fit?: "cover" | "contain";
}

export interface CNode extends TreeNodeLike {
  id: string;
  /** 호스트 태그 | "#text" | "x-icon" */
  tag: string;
  text?: string;
  className?: string;
  style?: Record<string, string | number>;
  attrs?: Record<string, string | number | boolean>;
  children?: CNode[];
  bind?: string;
  /** 지표 값 소수 자리(기본 1) */
  bindDigits?: number;
  widget?: string;
  props?: Record<string, unknown>;
  asset?: ImageRef;
  /** 타입 스케일 단계(tokens.json type) — 추가한 글상자·단계 지정 */
  typeStep?: string;
  // ── 파생 표식(applyEdits 가 붙인다, 저장하지 않음) ──
  origin?: "base" | "pin" | "add";
  owner?: string;
  pinned?: boolean;
  edited?: boolean;
  hiddenByEdit?: boolean;
}

/** 문단 블록 안에 올 수 있는 인라인 태그 — 이것만 자식으로 가진 요소가 글 고치기 단위다 */
export const INLINE_TAGS = new Set(["#text", "span", "strong", "b", "em", "i", "u", "s", "small", "sup", "sub", "br", "a", "x-icon"]);

export function isInlineNode(n: CNode): boolean {
  return INLINE_TAGS.has(n.tag);
}

/** 문단 블록 — 인라인 아닌 요소이면서 자식이 1개 이상이고 전부 인라인 */
export function isInlineBlock(n: CNode): boolean {
  if (n.tag === "#text" || INLINE_TAGS.has(n.tag) || n.widget) return false;
  return (n.children?.length ?? 0) > 0 && n.children!.every(isInlineNode) && n.children!.some((c) => c.tag === "#text" || hasText(c));
}

export function hasText(n: CNode): boolean {
  if (n.tag === "#text") return Boolean(n.text && n.text.trim());
  return (n.children ?? []).some(hasText);
}

/** 고치기 불가 칩 — 인라인 편집 안에서 통째로 보존(지표 값·아이콘·쪽 번호 링크·쪽 번호 자리) */
export function isChip(n: CNode): boolean {
  if (n.tag === "x-icon" || n.bind) return true;
  const a = n.attrs ?? {};
  return n.tag === "a" || "data-ref" in a || "data-folio" in a;
}

export function textOf(n: CNode): string {
  if (n.tag === "#text") return n.text ?? "";
  if (n.tag === "br") return "\n";
  return (n.children ?? []).map(textOf).join("");
}

/** 53비트 문자열 해시(cyrb53) → 36진 — 기본 트리 노드 id(같은 경로 = 같은 id) */
export function hashId(input: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "n" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 기본 트리 노드 id 모양(n + 36진) */
export const BASE_ID_RE = /^n[a-z0-9]{1,12}$/;
/** 사용자가 만든 노드 id 모양(u + 8자) */
export const USER_ID_RE = /^u[a-z0-9]{8}$/;

export function newUserId(): string {
  return "u" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

export function findNode(root: CNode, id: string): CNode | null {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findPath(root: CNode, id: string): CNode[] | null {
  if (root.id === id) return [root];
  for (const c of root.children ?? []) {
    const p = findPath(c, id);
    if (p) return [root, ...p];
  }
  return null;
}

/** 이 노드를 감싼 위젯(가장 가까운 조상, 자신 포함) */
export function widgetAncestor(path: CNode[]): CNode | null {
  for (let i = path.length - 1; i >= 0; i--) if (path[i].widget) return path[i];
  return null;
}

export function countNodes(n: CNode): number {
  return 1 + (n.children ?? []).reduce((a, c) => a + countNodes(c), 0);
}
