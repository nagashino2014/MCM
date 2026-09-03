/**
 * 인라인(문단 블록) 편집 유틸 — 자식이 전부 인라인인 요소를 통째로 contentEditable 로 편집하기 위한
 * 직렬화(노드트리 → HTML)와 역파싱(편집된 DOM → 노드트리).
 *
 * - 직렬화 HTML 은 화이트리스트 노드트리에서만 생성되고 텍스트는 이스케이프되므로 안전하다.
 * - 역파싱은 브라우저가 만드는 변형(execCommand 의 <font color>, <b> 등)을 표준 노드로 정규화하고,
 *   색이 현재 액센트와 같으면 var(--accent) 로 저장해 테마 변경을 따라가게 한다.
 */
import type { DocNode } from "./types";
import { ALLOWED_STYLES } from "./sanitize";

const INLINE_TAGS = new Set(["#text", "span", "strong", "em", "b", "i", "u", "s", "small", "br", "a", "img"]);

export function isInlineNode(node: DocNode): boolean {
  return INLINE_TAGS.has(node.tag);
}

/** 문단 블록 — 자식이 1개 이상이고 전부 인라인인 요소. 이 단위로 contentEditable 편집한다. */
export function isInlineBlock(node: DocNode): boolean {
  if (node.tag === "#text" || INLINE_TAGS.has(node.tag)) return false;
  return (node.children?.length ?? 0) > 0 && node.children!.every(isInlineNode);
}

function genId(): string {
  return "n" + Math.random().toString(36).slice(2, 10);
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function styleAttr(style?: Record<string, string>): string {
  if (!style) return "";
  const css = Object.entries(style)
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(";");
  return css ? ` style="${escapeHtml(css)}"` : "";
}

/** 인라인 자식 노드들을 편집용 HTML 로 직렬화. */
export function renderInlineHtml(nodes: DocNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.tag === "#text") out += escapeHtml(n.text ?? "");
    else if (n.tag === "br") out += "<br>";
    else if (n.tag === "img") out += `<img src="${escapeHtml(n.src ?? "")}"${styleAttr(n.style)}>`;
    else if (n.tag === "a")
      out += `<a href="${escapeHtml(n.href ?? "#")}"${styleAttr(n.style)}>${renderInlineHtml(n.children ?? [])}</a>`;
    else out += `<${n.tag}${styleAttr(n.style)}>${renderInlineHtml(n.children ?? [])}</${n.tag}>`;
  }
  return out;
}

const toCamel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * 편집 DOM 요소의 인라인 스타일을 원문 그대로 보존(화이트리스트 필터 + 액센트 정규화).
 * CSSStyleDeclaration 순회는 shorthand 를 분해하므로 style 속성 원문을 직접 파싱한다.
 * 서식 키만 취하면 글머리 도트 같은 장식 span(width/background 등)이 커밋 때 소실된다 — 전체 보존이 원칙.
 */
function pickStyles(el: HTMLElement, accentHex: string): Record<string, string> | undefined {
  const raw = el.getAttribute("style");
  if (!raw) return undefined;
  const style: Record<string, string> = {};
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const key = toCamel(decl.slice(0, colon).trim());
    const value = decl.slice(colon + 1).trim();
    if (!ALLOWED_STYLES.has(key) || !value) continue;
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

const BLOCKISH = new Set(["DIV", "P", "LI"]);

/**
 * 편집된 contentEditable DOM 을 인라인 노드 배열로 역파싱.
 * 허용 외 요소는 자식으로 평탄화하고, 블록성 요소(div 등)는 앞에 <br> 을 넣어 개행으로 보존한다.
 */
export function domToInlineNodes(container: Element, accentHex: string): DocNode[] {
  const out: DocNode[] = [];

  const push = (n: DocNode) => out.push(n);

  function walk(el: ChildNode, acc: DocNode[]): void {
    if (el.nodeType === Node.TEXT_NODE) {
      const text = el.textContent ?? "";
      if (text.length > 0) acc.push({ id: genId(), tag: "#text", text });
      return;
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const e = el as HTMLElement;
    const tag = e.tagName;

    if (tag === "BR") { acc.push({ id: genId(), tag: "br" }); return; }

    if (tag === "IMG") {
      const src = e.getAttribute("src") ?? "";
      if (/^data:image\/(png|jpe?g|gif|webp);base64,/.test(src)) {
        acc.push({ id: genId(), tag: "img", src, style: pickStyles(e, accentHex) });
      }
      return;
    }

    const children: DocNode[] = [];
    e.childNodes.forEach((c) => walk(c, children));

    const emit = (t: string, style?: Record<string, string>) => {
      if (children.length > 0) acc.push({ id: genId(), tag: t, style, children });
    };

    if (tag === "B" || tag === "STRONG") return emit("strong", pickStyles(e, accentHex));
    if (tag === "I" || tag === "EM") return emit("em", pickStyles(e, accentHex));
    if (tag === "U") return emit("u", pickStyles(e, accentHex));
    if (tag === "S" || tag === "STRIKE") return emit("s", pickStyles(e, accentHex));
    if (tag === "A") {
      const href = e.getAttribute("href") ?? "";
      if (children.length > 0) acc.push({ id: genId(), tag: "a", href, style: pickStyles(e, accentHex), children });
      return;
    }
    if (tag === "FONT") {
      // execCommand('foreColor') 가 만드는 레거시 <font color> 정규화
      const color = e.getAttribute("color");
      const style = color ? { color: normalizeAccent(color, accentHex) } : pickStyles(e, accentHex);
      if (style) return emit("span", style);
      acc.push(...children);
      return;
    }
    if (tag === "SPAN") {
      const style = pickStyles(e, accentHex);
      // 글머리 도트 같은 "빈 장식 span"(width/background 등)은 자식이 없어도 보존해야
      // 개행·수정 커밋 후에도 불릿이 사라지지 않는다.
      if (style) {
        acc.push({ id: genId(), tag: "span", style, children: children.length > 0 ? children : undefined });
        return;
      }
      acc.push(...children); // 서식 없는 span 은 평탄화
      return;
    }
    // 그 밖의 요소(div 등) — 블록성이면 개행으로 경계 보존 후 평탄화
    if (BLOCKISH.has(tag) && acc.length > 0) acc.push({ id: genId(), tag: "br" });
    acc.push(...children);
  }

  container.childNodes.forEach((c) => walk(c, out));
  if (out.length === 0) push({ id: genId(), tag: "#text", text: "" });
  return out;
}
