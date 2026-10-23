/**
 * 인라인(문단 블록) 편집 유틸 — 자식이 전부 인라인인 요소를 통째로 contentEditable 로 편집하기 위한
 * 직렬화(노드트리 → HTML)와 역파싱(편집된 DOM → 노드트리).
 *
 * - 직렬화 HTML 은 화이트리스트 노드트리에서만 생성되고 텍스트는 이스케이프되므로 안전하다.
 * - 역파싱은 브라우저가 만드는 변형(execCommand 의 <font color>, <b> 등)을 표준 노드로 정규화하고,
 *   색이 현재 액센트와 같으면 var(--accent) 로 저장해 테마 변경을 따라가게 한다.
 * - 순회 자체는 회사소개서 스튜디오와 같이 쓰는 공용 핵심(lib/doc-tree/inline-core.ts)이 맡는다(2026-10-22 추출, 동작 동일).
 */
import type { DocNode } from "./types";
import { ALLOWED_STYLES } from "./sanitize";
import { escapeHtml, kebabCase, parseInlineDom, parseStyleAttr, serializeInline, type DomLike } from "@/lib/doc-tree/inline-core";
import { genNodeId } from "@/lib/doc-tree/tree-core";

const INLINE_TAGS = new Set(["#text", "span", "strong", "em", "b", "i", "u", "s", "small", "br", "a", "img"]);

export function isInlineNode(node: DocNode): boolean {
  return INLINE_TAGS.has(node.tag);
}

/** 문단 블록 — 자식이 1개 이상이고 전부 인라인인 요소. 이 단위로 contentEditable 편집한다. */
export function isInlineBlock(node: DocNode): boolean {
  if (node.tag === "#text" || INLINE_TAGS.has(node.tag)) return false;
  return (node.children?.length ?? 0) > 0 && node.children!.every(isInlineNode);
}

const genId = () => genNodeId("n");

function styleAttr(style?: Record<string, string>): string {
  if (!style) return "";
  const css = Object.entries(style)
    .map(([k, v]) => `${kebabCase(k)}:${v}`)
    .join(";");
  return css ? ` style="${escapeHtml(css)}"` : "";
}

/** 인라인 자식 노드들을 편집용 HTML 로 직렬화. */
export function renderInlineHtml(nodes: DocNode[]): string {
  return serializeInline<DocNode>(nodes, {
    textOf: (n) => (n.tag === "#text" ? n.text ?? "" : null),
    tagOf: (n) => n.tag,
    childrenOf: (n) => n.children ?? [],
    attrs: (n) => {
      if (n.tag === "br") return "";
      if (n.tag === "img") return ` src="${escapeHtml(n.src ?? "")}"${styleAttr(n.style)}`;
      if (n.tag === "a") return ` href="${escapeHtml(n.href ?? "#")}"${styleAttr(n.style)}`;
      return styleAttr(n.style);
    },
  });
}

/**
 * 편집 DOM 요소의 인라인 스타일을 원문 그대로 보존(화이트리스트 필터 + 액센트 정규화).
 * CSSStyleDeclaration 순회는 shorthand 를 분해하므로 style 속성 원문을 직접 파싱한다.
 * 서식 키만 취하면 글머리 도트 같은 장식 span(width/background 등)이 커밋 때 소실된다 — 전체 보존이 원칙.
 */
function pickStyles(el: DomLike, accentHex: string): Record<string, string> | undefined {
  const style: Record<string, string> = {};
  for (const [key, value] of parseStyleAttr(el.getAttribute?.("style"))) {
    if (!ALLOWED_STYLES.has(key)) continue;
    style[key] = key === "color" ? normalizeAccent(value, accentHex) : value;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** 편집 시 칠한 색이 현재 액센트와 같으면 var(--accent) 로 정규화(테마 추종). */
function normalizeAccent(color: string, accentHex: string): string {
  const c = color.replace(/\s+/g, "").toLowerCase();
  const hex = accentHex.toLowerCase();
  if (c === hex) return "var(--accent)";
  // rgb(r,g,b) 형태 비교
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c);
  if (m) {
    const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
    if (`#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}` === hex) return "var(--accent)";
  }
  if (c === "var(--accent)") return "var(--accent)";
  return color;
}

/**
 * 편집된 contentEditable DOM 을 인라인 노드 배열로 역파싱.
 * 허용 외 요소는 자식으로 평탄화하고, 블록성 요소(div 등)는 앞에 <br> 을 넣어 개행으로 보존한다.
 */
export function domToInlineNodes(container: Element, accentHex: string): DocNode[] {
  return parseInlineDom<DocNode>(container as unknown as DomLike, {
    text: (text) => ({ id: genId(), tag: "#text", text }),
    br: () => ({ id: genId(), tag: "br" }),
    image: (el) => {
      const src = el.getAttribute?.("src") ?? "";
      return /^data:image\/(png|jpe?g|gif|webp);base64,/.test(src) ? { id: genId(), tag: "img", src, style: pickStyles(el, accentHex) } : null;
    },
    element: (tag, el, children) => {
      const emit = (t: string, style?: Record<string, string>): DocNode | DocNode[] => (children.length > 0 ? { id: genId(), tag: t, style, children } : []);
      if (tag === "strong" || tag === "em" || tag === "u" || tag === "s") return emit(tag, pickStyles(el, accentHex));
      if (tag === "a") {
        const href = el.getAttribute?.("href") ?? "";
        return children.length > 0 ? { id: genId(), tag: "a", href, style: pickStyles(el, accentHex), children } : [];
      }
      if (tag === "font") {
        // execCommand('foreColor') 가 만드는 레거시 <font color> 정규화
        const color = el.getAttribute?.("color");
        const style = color ? { color: normalizeAccent(color, accentHex) } : pickStyles(el, accentHex);
        return style ? emit("span", style) : null;
      }
      if (tag === "span") {
        const style = pickStyles(el, accentHex);
        // 글머리 도트 같은 "빈 장식 span"(width/background 등)은 자식이 없어도 보존해야
        // 개행·수정 커밋 후에도 불릿이 사라지지 않는다. 서식 없는 span 은 평탄화.
        return style ? { id: genId(), tag: "span", style, children: children.length > 0 ? children : undefined } : null;
      }
      return null; // small·sup·sub 는 평탄화(기존 동작)
    },
    empty: () => ({ id: genId(), tag: "#text", text: "" }),
  });
}
