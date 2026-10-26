/*
 * 스튜디오 글 고치기 — 글 블록의 자식(노드) ↔ 편집용 HTML. 공용 핵심(lib/doc-tree/inline-core)의 순회를 쓰고,
 * 회사소개서 규칙을 더한다: 클래스 보존(kc-*), 칩(지표 값·아이콘·쪽 번호 링크)은 편집 불가로 통째 보존, 원래 태그(b·strong) 유지.
 * 클라이언트 안전(역파싱은 브라우저 DOM 또는 같은 모양 객체).
 */
import { escapeHtml, kebabCase, parseInlineDom, parseStyleAttr, serializeInline, type DomLike } from "@/lib/doc-tree/inline-core";
import { isTokenVar } from "./design-system";
import { isChip, newUserId, type CNode } from "./nodes";

/** React 와 같은 규칙으로 숫자 스타일에 px 를 붙인다(단위 없는 속성 제외) */
const UNITLESS = new Set(["lineHeight", "fontWeight", "opacity", "zIndex", "flex", "flexGrow", "flexShrink", "order", "zoom", "fillOpacity", "aspectRatio"]);

export function cssText(style: CNode["style"]): string {
  if (!style) return "";
  return Object.entries(style)
    .map(([k, v]) => `${k.startsWith("--") ? k : kebabCase(k)}:${typeof v === "number" && !UNITLESS.has(k) && v !== 0 ? `${v}px` : v}`)
    .join(";");
}

/** 칩 HTML 을 만드는 쪽(스튜디오가 정적 렌더로 그려 넘긴다 — contenteditable="false"·data-chip 포함) */
export type ChipHtml = (chip: CNode) => string;

/** 글 블록 자식 → 편집 HTML */
export function toEditableHtml(children: CNode[], chipHtml: ChipHtml): string {
  return serializeInline<CNode>(children, {
    textOf: (n) => (n.tag === "#text" ? n.text ?? "" : null),
    tagOf: (n) => n.tag,
    childrenOf: (n) => n.children ?? [],
    special: (n) => (n.tag !== "#text" && isChip(n) ? chipHtml(n) : null),
    attrs: (n) => {
      if (n.tag === "br") return "";
      const css = cssText(n.style);
      return `${n.className ? ` class="${escapeHtml(n.className)}"` : ""}${css ? ` style="${escapeHtml(css)}"` : ""}`;
    },
  });
}

const CLASS_TOKEN = /^[A-Za-z][\w-]{0,60}$/;

function pickClass(el: DomLike): string | undefined {
  const raw = el.getAttribute?.("class") ?? "";
  const parts = raw.split(/\s+/).filter((t) => CLASS_TOKEN.test(t) && !t.startsWith("st-"));
  return parts.length ? parts.join(" ") : undefined;
}

/** 편집 중 붙은 서식 — 굵기·기울임·밑줄·색(토큰만)만 받는다 */
function pickStyle(el: DomLike): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of parseStyleAttr(el.getAttribute?.("style"))) {
    if (k === "color" && isTokenVar(v, "color")) out.color = v;
    else if (k === "fontWeight" && /^(400|500|600|700|bold|normal)$/.test(v)) out.fontWeight = v;
    else if (k === "fontStyle" && /^(normal|italic)$/.test(v)) out.fontStyle = v;
    else if (k === "textDecoration" && /^(none|underline|line-through)$/.test(v)) out.textDecoration = v;
    else if (k === "fontSize" || k === "lineHeight" || k === "letterSpacing" || k === "marginLeft" || k === "marginRight" || k === "fontFamily") {
      // 기본 트리에서 온 조각의 원래 모양(편집기가 만든 값 아님) — 안전한 값만
      if (/^-?\d+(\.\d+)?(px|em)?$/.test(v) || /^var\(--kc-font-(display|body|figure)\)$/.test(v)) out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 편집된 DOM → 글 블록 자식. chips = 편집 전 칩(id → 노드) — data-chip 이 남아 있으면 원래 노드를 그대로 둔다(지운 칩은 사라짐).
 * 원래 노드에 있던 숫자 스타일은 정적 렌더가 px 문자열로 바꿔 두므로 그대로 받는다.
 */
export function fromEditableDom(container: DomLike, chips: Map<string, CNode>): CNode[] {
  return parseInlineDom<CNode>(container, {
    text: (text) => ({ id: newUserId(), tag: "#text", text }),
    br: () => ({ id: newUserId(), tag: "br" }),
    preserve: (el) => {
      const id = el.getAttribute?.("data-chip");
      return id ? chips.get(id) ?? null : null;
    },
    image: () => null,
    element: (tag, el, children) => {
      const original = (el.tagName ?? "").toLowerCase();
      const cls = pickClass(el);
      const style = pickStyle(el);
      const keep = (t: string): CNode | CNode[] =>
        children.length ? { id: newUserId(), tag: t, ...(cls ? { className: cls } : {}), ...(style ? { style } : {}), children } : [];
      if (tag === "strong") return keep(original === "b" ? "b" : "strong");
      if (tag === "em") return keep(original === "i" ? "i" : "em");
      if (tag === "u" || tag === "s" || tag === "small" || tag === "sup" || tag === "sub") return keep(tag);
      if (tag === "a") return null; // 링크는 칩으로만 보존(새 링크는 만들지 않는다)
      if (tag === "font") {
        const color = el.getAttribute?.("color");
        return color && isTokenVar(color, "color") ? keep("span") : null;
      }
      // span: 클래스·서식이 있으면 남기고 없으면 평탄화
      return cls || style ? keep("span") : null;
    },
    empty: () => ({ id: newUserId(), tag: "#text", text: "" }),
  });
}

/** 칩 모음(편집 전 자식에서) */
export function collectChips(children: CNode[]): Map<string, CNode> {
  const out = new Map<string, CNode>();
  const walk = (list: CNode[]) => {
    for (const c of list) {
      if (c.tag !== "#text" && isChip(c)) out.set(c.id, c);
      else if (c.children) walk(c.children);
    }
  };
  walk(children);
  return out;
}

/** 바인딩 해제 — 칩을 지금 보이는 글로 바꾼다(그 숫자는 이후 자동 갱신에서 빠진다) */
export function unbindChip(children: CNode[], chipId: string, valueText: string): CNode[] {
  return children.map((c) => {
    if (c.id === chipId) return { id: newUserId(), tag: "#text", text: valueText };
    return c.children ? { ...c, children: unbindChip(c.children, chipId, valueText) } : c;
  });
}

// ── 지표 넣기 — 커서 자리 표식 ──
// 편집 DOM 의 커서 자리에 data-chip="caret" 표식을 잠깐 넣고 역파싱하면 그 자리가 표식 노드로 남는다 → 지표를 고르면 표식을 칩으로 바꾼다.

export const CARET_ID = "caret";

export function caretNode(): CNode {
  return { id: CARET_ID, tag: "#caret" };
}

/** 글 끝에 표식(데이터 탭에서 넣을 때) — 끝 글자가 공백이 아니면 한 칸 띄운다 */
export function appendCaret(children: CNode[]): CNode[] {
  const last = children[children.length - 1];
  const needSpace = last && !(last.tag === "#text" && /\s$/.test(last.text ?? "")) && last.tag !== "br";
  return [...children, ...(needSpace ? [{ id: newUserId(), tag: "#text", text: " " }] : []), caretNode()];
}

/** 표식 자리에 칩을 넣는다(표식이 없으면 끝에) */
export function placeChip(children: CNode[], chip: CNode): CNode[] {
  let placed = false;
  const walk = (list: CNode[]): CNode[] =>
    list.flatMap((c) => {
      if (c.id === CARET_ID && c.tag === "#caret") {
        if (placed) return [];
        placed = true;
        return [chip];
      }
      return c.children ? [{ ...c, children: walk(c.children) }] : [c];
    });
  const out = walk(children);
  return placed ? out : [...out, chip];
}
