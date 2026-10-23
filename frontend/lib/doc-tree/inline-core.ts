/**
 * 문단 블록(인라인) 편집 공용 핵심 — 직렬화(노드 → 편집용 HTML)와 역파싱(편집된 DOM → 노드).
 * 홍보·채용공고(lib/recruit/inline.ts)와 회사소개서 스튜디오(lib/catalog/studio/inline.ts)가 같은 순회를 쓰고,
 * 서식 요소를 어떤 노드로 만들지(스타일·클래스 보존, 칩 보존)는 호출자가 정한다.
 *
 * 역파싱 규칙(두 편집기 공통):
 *   - 글자 → 텍스트 노드, <br> → 줄바꿈 노드
 *   - preserve() 가 노드를 돌려주는 요소(편집 불가 칩 등)는 그 노드를 그대로 둔다
 *   - B/STRONG·I/EM·U·S/STRIKE·A·FONT·SPAN·SMALL·SUP·SUB 는 정규 이름으로 element() 에 넘기고, null 이면 자식만 남긴다(평탄화)
 *   - 그 밖의 요소는 평탄화하되 블록성 요소(DIV·P·LI)는 앞에 줄바꿈을 넣어 경계를 보존한다
 * 역파싱 입력은 브라우저 DOM 이거나 같은 모양의 객체(DomLike — 시험에서 htmlparser2 트리를 감싼다)다.
 */

export interface DomLike {
  nodeType: number;
  tagName?: string;
  textContent: string | null;
  childNodes: ArrayLike<DomLike>;
  getAttribute?(name: string): string | null;
}

export const DOM_TEXT_NODE = 3;
export const DOM_ELEMENT_NODE = 1;

/** element() 에 넘기는 정규 태그 이름 */
export type InlineTag = "strong" | "em" | "u" | "s" | "a" | "font" | "span" | "small" | "sup" | "sub";

const CANONICAL: Record<string, InlineTag> = {
  B: "strong",
  STRONG: "strong",
  I: "em",
  EM: "em",
  U: "u",
  S: "s",
  STRIKE: "s",
  A: "a",
  FONT: "font",
  SPAN: "span",
  SMALL: "small",
  SUP: "sup",
  SUB: "sub",
};

const BLOCKISH = new Set(["DIV", "P", "LI"]);

export interface InlineParseOptions<N> {
  text(text: string): N;
  br(): N;
  /** 원본 노드를 그대로 둘 요소(칩). null = 일반 처리 */
  preserve?(el: DomLike): N | null;
  /** <img> 처리. null = 버림 */
  image?(el: DomLike): N | null;
  /** 서식 요소 → 노드. null = 평탄화(자식만 남김). 배열 = 그 노드들로 대체 */
  element(tag: InlineTag, el: DomLike, children: N[]): N | N[] | null;
  /** 결과가 비었을 때 넣을 노드 */
  empty(): N;
}

export function parseInlineDom<N>(container: DomLike, o: InlineParseOptions<N>): N[] {
  const out: N[] = [];

  function walk(node: DomLike, acc: N[]): void {
    if (node.nodeType === DOM_TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.length > 0) acc.push(o.text(text));
      return;
    }
    if (node.nodeType !== DOM_ELEMENT_NODE) return;
    const tag = (node.tagName ?? "").toUpperCase();
    if (tag === "BR") {
      acc.push(o.br());
      return;
    }
    const kept = o.preserve?.(node);
    if (kept) {
      acc.push(kept);
      return;
    }
    if (tag === "IMG") {
      const img = o.image?.(node);
      if (img) acc.push(img);
      return;
    }
    const children: N[] = [];
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i], children);

    const canonical = CANONICAL[tag];
    if (canonical) {
      const made = o.element(canonical, node, children);
      if (made == null) acc.push(...children);
      else if (Array.isArray(made)) acc.push(...made);
      else acc.push(made);
      return;
    }
    // 그 밖의 요소(div 등) — 블록성이면 개행으로 경계 보존 후 평탄화
    if (BLOCKISH.has(tag) && acc.length > 0) acc.push(o.br());
    acc.push(...children);
  }

  for (let i = 0; i < container.childNodes.length; i++) walk(container.childNodes[i], out);
  if (out.length === 0) out.push(o.empty());
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const kebabCase = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
export const camelCase = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** style 속성 원문 → [camelCase 키, 값] 목록(CSSStyleDeclaration 은 shorthand 를 분해하므로 원문을 직접 나눈다). */
export function parseStyleAttr(raw: string | null | undefined): Array<[string, string]> {
  if (!raw) return [];
  const out: Array<[string, string]> = [];
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const key = camelCase(decl.slice(0, colon).trim());
    const value = decl.slice(colon + 1).trim();
    if (key && value) out.push([key, value]);
  }
  return out;
}

export interface InlineSerializeOptions<N> {
  /** 텍스트 노드면 글자, 아니면 null */
  textOf(n: N): string | null;
  tagOf(n: N): string;
  childrenOf(n: N): N[];
  /** 여는 태그 뒤에 붙일 속성 문자열(앞 공백 포함, 이스케이프는 호출자). */
  attrs(n: N): string;
  /** 노드 → 특수 HTML(칩 등). null = 기본 직렬화 */
  special?(n: N): string | null;
}

const VOID_TAGS = new Set(["br", "img"]);

/** 인라인 노드 → 편집용 HTML. 텍스트는 이스케이프한다. */
export function serializeInline<N>(nodes: N[], o: InlineSerializeOptions<N>): string {
  let html = "";
  for (const n of nodes) {
    const sp = o.special?.(n);
    if (sp != null) {
      html += sp;
      continue;
    }
    const text = o.textOf(n);
    if (text != null) {
      html += escapeHtml(text);
      continue;
    }
    const tag = o.tagOf(n);
    if (VOID_TAGS.has(tag)) html += `<${tag}${o.attrs(n)}>`;
    else html += `<${tag}${o.attrs(n)}>${serializeInline(o.childrenOf(n), o)}</${tag}>`;
  }
  return html;
}
