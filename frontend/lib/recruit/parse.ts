/**
 * 핸드오프 패키지(.dc.html) → 노드트리 파서. **브라우저 전용**(DOMParser 사용) — 업로드 화면에서 실행.
 *
 * 범용 파싱 원칙: 템플릿별 코드 없이 어떤 클로드 디자인 핸드오프가 와도 편집기가 동작해야 한다.
 * - 모든 텍스트 노드 → 편집 가능 필드
 * - 구조 시그니처(태그 + 스타일 키 + 자식 구조)가 같은 형제 2개 이상 → 반복 그룹(추가/삭제/이동 가능)
 * - 항목 인덱스가 한 칸씩 건너뛰고 사이 노드가 서로 동일하면 구분자(예: "→")로 마킹해 함께 복제/삭제
 * - helmet <style> 의 :root CSS 변수와 data-props(accentColor/compact)를 테마로 추출
 */
import type { DocNode, DocTheme, ParsedTemplate } from "./types";
import { sanitizeTree, sanitizeTheme } from "./sanitize";

let idSeq = 0;
export function genNodeId(): string {
  return "n" + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 6);
}

/** CSS 속성명 → camelCase (background-color → backgroundColor). */
function toCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function elementToNode(el: Element): DocNode | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "helmet" || tag === "link" || tag === "meta") return null;

  const node: DocNode = { id: genNodeId(), tag };
  const styleAttr = el.getAttribute("style");
  if (styleAttr) {
    // CSSStyleDeclaration 순회는 shorthand(border 등)를 longhand 로 분해해 원문이 훼손된다.
    // 핸드오프 인라인 스타일은 단순 `prop:value;` 나열이므로 원문 그대로 직접 파싱한다.
    const style: Record<string, string> = {};
    for (const decl of styleAttr.split(";")) {
      const colon = decl.indexOf(":");
      if (colon <= 0) continue;
      const prop = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).trim();
      if (prop && value) style[toCamel(prop)] = value;
    }
    if (Object.keys(style).length > 0) node.style = style;
  }
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href) node.href = href;
  }

  const children: DocNode[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      // 블록 사이 들여쓰기용 공백/개행은 버리고, 실제 문구는 그대로 보존.
      if (text.trim().length > 0) {
        children.push({ id: genNodeId(), tag: "#text", text: text.replace(/\s+/g, " ") });
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const cn = elementToNode(child as Element);
      if (cn) children.push(cn);
    }
  });
  if (children.length > 0) node.children = children;
  return node;
}

/**
 * 구조 시그니처 — 반복 그룹 감지의 비교 키.
 * 스타일 "값"은 제외(마지막 스텝의 반전 색상 같은 변주 포용), 스타일 키·태그·자식 구조는 포함.
 * 텍스트 내용도 제외(항목마다 문구가 다른 것이 당연).
 */
// 배치 예외 키 — 마지막 항목만 전체 폭(grid-column:1/-1)인 패턴이 그룹에서 빠지지 않게 시그니처에서 제외.
const SIG_IGNORE_STYLE = new Set(["gridColumn", "gridRow"]);
// 명백한 리스트 항목 태그 — 내부 구조(strong·br 유무)가 달라도 같은 리스트면 한 그룹으로 본다.
const LIST_ITEM_TAGS = new Set(["li", "tr", "td", "th"]);

function signature(node: DocNode): string {
  if (node.tag === "#text") return "#t";
  const styleKeys = node.style
    ? Object.keys(node.style).filter((k) => !SIG_IGNORE_STYLE.has(k)).sort().join(",")
    : "";
  if (LIST_ITEM_TAGS.has(node.tag)) return `${node.tag}[${styleKeys}]`;
  const kids = (node.children ?? []).map(signature).join("|");
  return `${node.tag}[${styleKeys}](${kids})`;
}

/** 형제 목록에서 반복 그룹·구분자를 감지해 마킹한다(재귀). */
function detectRepeatGroups(node: DocNode): void {
  const children = node.children ?? [];
  if (children.length >= 2) {
    const sigs = children.map(signature);
    // 시그니처별 등장 인덱스 수집(텍스트 노드 제외 — 문장 조각이 그룹으로 잡히는 것 방지)
    const bySig = new Map<string, number[]>();
    sigs.forEach((sig, i) => {
      if (children[i].tag === "#text") return;
      const arr = bySig.get(sig) ?? [];
      arr.push(i);
      bySig.set(sig, arr);
    });
    // 큰 그룹 우선 처리 — 구분자(→)처럼 그룹 사이에 낀 반복이 자체 그룹으로 재처리되며
    // 이미 확정된 항목을 오염시키지 않도록, 항목 수 내림차순 + 이미 마킹된 노드 포함 시 스킵.
    const candidates = [...bySig.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [itemSig, idxs] of candidates) {
      if (idxs.length < 2) continue;
      if (idxs.some((i) => children[i].repeatGroup)) continue;
      // 리프에 텍스트가 전혀 없는 반복(장식 요소)은 편집 대상이 아니므로 제외
      if (!hasAnyText(children[idxs[0]])) continue;
      const groupId = "g" + Math.random().toString(36).slice(2, 8);
      const step = idxs[1] - idxs[0];
      const uniformStep = idxs.every((v, i) => i === 0 || v - idxs[i - 1] === step);
      if (uniformStep && step === 2 && idxs.length >= 2) {
        // 항목 사이에 낀 노드들이 서로 동일하면 구분자로 함께 마킹
        const midIdxs: number[] = [];
        for (let i = 0; i < idxs.length - 1; i++) midIdxs.push(idxs[i] + 1);
        const midSigs = midIdxs.map((i) => sigs[i]);
        const midUniform = midSigs.every((s) => s === midSigs[0]) && midSigs[0] !== itemSig;
        if (midUniform) {
          midIdxs.forEach((i) => {
            children[i].repeatGroup = groupId;
            children[i].separator = true;
          });
        }
      }
      if (uniformStep && (step === 1 || step === 2)) {
        idxs.forEach((i) => {
          children[i].repeatGroup = groupId;
        });
      }
    }
  }
  children.forEach(detectRepeatGroups);
}

function hasAnyText(node: DocNode): boolean {
  if (node.tag === "#text") return (node.text ?? "").trim().length > 0;
  return (node.children ?? []).some(hasAnyText);
}

function countStats(tree: DocNode): { textCount: number; groupCount: number } {
  let textCount = 0;
  const groups = new Set<string>();
  const walk = (n: DocNode) => {
    if (n.tag === "#text") textCount++;
    if (n.repeatGroup && !n.separator) groups.add(n.repeatGroup);
    n.children?.forEach(walk);
  };
  walk(tree);
  return { textCount, groupCount: groups.size };
}

/** helmet(or 전체) <style> 텍스트에서 :root CSS 변수 추출. */
function extractCssVars(doc: Document): Record<string, string> {
  const vars: Record<string, string> = {};
  doc.querySelectorAll("style").forEach((styleEl) => {
    const css = styleEl.textContent ?? "";
    const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
    if (!rootMatch) return;
    for (const m of rootMatch[1].matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);?/g)) {
      vars[m[1]] = m[2].trim();
    }
  });
  return vars;
}

/** body{background:...} 데스크 컬러 추출(있으면). */
function extractDeskColor(doc: Document): string | undefined {
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    const m = (styleEl.textContent ?? "").match(/body\s*\{[^}]*background\s*:\s*(#[0-9a-fA-F]{3,8})/);
    if (m) return m[1];
  }
  return undefined;
}

/** data-props(x-dc 런타임 속성 정의)에서 accentColor 기본값·팔레트, compact 기본값 추출. */
function extractProps(doc: Document): Partial<DocTheme> {
  const script = doc.querySelector("script[data-props]");
  if (!script) return {};
  try {
    const props = JSON.parse(script.getAttribute("data-props") ?? "{}") as Record<
      string,
      { default?: unknown; options?: unknown[] }
    >;
    const out: Partial<DocTheme> = {};
    const accent = props.accentColor;
    if (accent && typeof accent.default === "string") {
      out.accentColor = accent.default;
      if (Array.isArray(accent.options)) {
        out.accentOptions = accent.options.filter((v): v is string => typeof v === "string");
      }
    }
    if (props.compact && typeof props.compact.default === "boolean") out.compact = props.compact.default;
    return out;
  } catch {
    return {};
  }
}

/**
 * 핸드오프 HTML 문자열을 파싱해 등록 페이로드를 만든다.
 * `<x-dc>` 내부의 첫 엘리먼트를 문서 루트로 삼고, 없으면 body 의 첫 엘리먼트를 쓴다(범용 폴백).
 */
export function parseHandoffHtml(html: string): ParsedTemplate {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const host = doc.querySelector("x-dc") ?? doc.body;
  let rootEl: Element | null = null;
  for (const child of Array.from(host.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "helmet" || tag === "script" || tag === "style" || tag === "link") continue;
    rootEl = child;
    break;
  }
  if (!rootEl) throw new Error("템플릿 마크업을 찾지 못했습니다. (.dc.html 의 <x-dc> 내부가 비어 있음)");

  const rawTree = elementToNode(rootEl);
  if (!rawTree) throw new Error("템플릿 루트를 변환하지 못했습니다.");
  detectRepeatGroups(rawTree);

  const { tree } = sanitizeTree(rawTree);

  const theme: DocTheme = sanitizeTheme({
    ...extractProps(doc),
    cssVars: extractCssVars(doc),
    deskColor: extractDeskColor(doc),
  }) as DocTheme;

  const widthMatch = /^(\d+)px$/.exec(tree.style?.width ?? "");
  const docWidth = widthMatch ? Number(widthMatch[1]) : 900;

  return { tree, theme, docWidth, stats: countStats(tree) };
}
