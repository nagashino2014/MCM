/**
 * 노드트리 정제/검증 — 서버(저장 전)·클라이언트(파싱 직후) 공용 순수 함수.
 *
 * 업로드된 HTML 은 신뢰할 수 없으므로:
 * - 태그·스타일 속성은 화이트리스트만 통과시킨다.
 * - url()/expression() 등 외부 리소스·스크립트성 값은 스타일 값에서 거른다.
 * - a.href 는 http(s) 만 허용.
 * - 노드 수·깊이·텍스트 길이에 상한을 둔다.
 * 렌더는 React 엘리먼트 생성이라 script/onclick 류는 애초에 실행 경로가 없다.
 */
import type { DocNode } from "./types";

const ALLOWED_TAGS = new Set([
  "#text", "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "strong", "em", "b", "i", "u", "s", "small", "br", "hr", "a", "img",
  "table", "thead", "tbody", "tr", "td", "th", "blockquote", "section", "header", "footer",
]);

// 삽입 이미지(로고 등)는 외부 URL 대신 data URI 로만 — 외부 리소스 로드·추적 차단, 내보내기에도 그대로 포함.
const IMG_SRC_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG_SRC = 1_000_000; // base64 기준 약 730KB 원본

// camelCase 스타일 키 화이트리스트 — 레이아웃·타이포·장식 전반. (position:fixed 는 값에서 차단)
// inline.ts(편집 DOM 역파싱)도 같은 기준으로 필터한다.
export const ALLOWED_STYLES = new Set([
  "display", "flexDirection", "flexWrap", "flex", "flexShrink", "flexGrow", "alignItems",
  "alignSelf", "justifyContent", "gap", "rowGap", "columnGap",
  "gridTemplateColumns", "gridTemplateRows", "gridColumn", "gridRow", "placeItems",
  "width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
  "borderRadius", "borderColor", "borderWidth", "borderStyle", "outline",
  "background", "backgroundColor", "backgroundImage",
  "color", "opacity", "boxShadow", "overflow", "overflowX", "overflowY",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
  "textAlign", "textDecoration", "textTransform", "textWrap", "whiteSpace", "wordBreak",
  "verticalAlign", "listStyle", "listStyleType", "borderCollapse", "borderSpacing",
  "position", "top", "right", "bottom", "left", "zIndex", "transform",
  "flexBasis", "textOverflow", "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius", "aspectRatio", "textIndent",
  "float", "clear", "objectFit",
]);

const MAX_NODES = 5000;
const MAX_DEPTH = 40;
const MAX_TEXT = 4000;

/** 스타일 값에 외부 로드·고정 배치 등 위험 요소가 없는지. */
function isSafeStyleValue(key: string, value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes("url(") || v.includes("expression(") || v.includes("javascript:")) return false;
  if (key === "position" && (v === "fixed" || v === "sticky")) return false;
  if (v.length > 500) return false;
  return true;
}

export interface SanitizeResult {
  tree: DocNode;
  nodeCount: number;
}

/**
 * 트리를 화이트리스트 기준으로 재구성해 돌려준다(허용 외 태그/스타일은 탈락).
 * 구조가 상한을 넘거나 루트가 통째로 거부되면 throw.
 */
export function sanitizeTree(input: unknown): SanitizeResult {
  let count = 0;

  function walk(raw: unknown, depth: number): DocNode | null {
    if (!raw || typeof raw !== "object") return null;
    if (depth > MAX_DEPTH) throw new Error("노드트리 깊이가 허용치를 초과했습니다.");
    if (++count > MAX_NODES) throw new Error("노드트리 크기가 허용치를 초과했습니다.");
    const n = raw as Record<string, unknown>;
    const tag = String(n.tag ?? "");
    if (!ALLOWED_TAGS.has(tag)) return null;

    const out: DocNode = { id: cleanId(n.id), tag };

    if (tag === "#text") {
      out.text = String(n.text ?? "").slice(0, MAX_TEXT);
      return out;
    }

    if (n.style && typeof n.style === "object") {
      const style: Record<string, string> = {};
      for (const [k, v] of Object.entries(n.style as Record<string, unknown>)) {
        const value = String(v ?? "");
        if (ALLOWED_STYLES.has(k) && isSafeStyleValue(k, value)) style[k] = value;
      }
      if (Object.keys(style).length > 0) out.style = style;
    }

    if (tag === "a" && typeof n.href === "string" && /^https?:\/\//i.test(n.href)) {
      out.href = n.href.slice(0, 1000);
    }
    if (tag === "img") {
      const src = typeof n.src === "string" ? n.src : "";
      if (!IMG_SRC_RE.test(src) || src.length > MAX_IMG_SRC) return null;
      out.src = src;
    }
    if (typeof n.repeatGroup === "string") out.repeatGroup = n.repeatGroup.slice(0, 40);
    if (n.separator === true) out.separator = true;

    if (Array.isArray(n.children)) {
      const children: DocNode[] = [];
      for (const c of n.children) {
        const cc = walk(c, depth + 1);
        if (cc) children.push(cc);
      }
      if (children.length > 0) out.children = children;
    }
    return out;
  }

  const tree = walk(input, 0);
  if (!tree || tree.tag === "#text") throw new Error("루트 노드가 유효하지 않습니다.");
  return { tree, nodeCount: count };
}

function cleanId(raw: unknown): string {
  const s = String(raw ?? "");
  if (/^[A-Za-z0-9_-]{1,40}$/.test(s)) return s;
  return "n" + Math.random().toString(36).slice(2, 10);
}

/** 테마 객체 정제 — hex 컬러·불리언·CSS 변수 폴백만 통과. */
export function sanitizeTheme(input: unknown): Record<string, unknown> {
  const t = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const isHex = (v: unknown) => typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v);
  if (isHex(t.accentColor)) out.accentColor = t.accentColor;
  if (Array.isArray(t.accentOptions)) out.accentOptions = t.accentOptions.filter(isHex).slice(0, 12);
  if (typeof t.compact === "boolean") out.compact = t.compact;
  if (isHex(t.deskColor)) out.deskColor = t.deskColor;
  if (t.cssVars && typeof t.cssVars === "object") {
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.cssVars as Record<string, unknown>)) {
      const value = String(v ?? "");
      if (/^--[A-Za-z0-9-]{1,40}$/.test(k) && isSafeStyleValue(k, value)) vars[k] = value;
    }
    out.cssVars = vars;
  }
  return out;
}
