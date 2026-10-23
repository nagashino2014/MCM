/*
 * 스튜디오 편집층 — 쪽마다 사용자가 고친 것만 저장한다(catalog_pages.tree). 클라이언트 안전 순수 함수.
 *
 *   nodes[기본 노드 id]
 *     content  고정한 자식(글 고치기·목록 항목 L1) — 이 노드는 자동 갱신에서 빠진다(바인딩 해제). 안의 지표 칩은 계속 최신 값
 *     style    위치·크기(L3, 그리드 맞춤 값)·열 수·사진 비율(L2)·토큰 색 — 빈 문자열 = 기본 스타일의 그 키를 지움
 *     type     타입 스케일 단계(L3)
 *     hidden   숨김(L2)
 *     info     인포그래픽 유형·변형·색 모드·내용(L2) — 기본 spec 위에 덮어쓴다
 *     image    사진 교체·초점·확대·맞춤(L1)
 *   added      추가한 글상자·도형·이미지(L3, 쪽 기준 절대 위치)
 *   variant    쪽 변형(L2, 예: 분야 상세 { hero: "photo", photo: "a/…" })
 *
 * 기본 트리는 저장하지 않으므로 데이터가 바뀌어도 편집층은 같은 노드 id 에 다시 붙는다. 노드가 사라지면(데이터 쪽 구조 변화) 그 편집은 쓰이지 않고 남는다.
 * 보안: 편집층은 신뢰하지 않는 입력이다 — 태그·속성·스타일·클래스·바인딩 경로를 모두 화이트리스트로 다시 만든다(서버 저장 전·클라이언트 불러온 뒤).
 */
import { sanitizeInfoSpec, type InfoSpec } from "@/lib/catalog/render/infographic/types";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { infographicToTree } from "./convert";
import { PHOTO_RATIOS, isTokenVar, isTypeStep, typeStepStyle } from "./design-system";
import { BASE_ID_RE, USER_ID_RE, findPath, newUserId, type CNode, type ImageRef } from "./nodes";
import { DATA_BIND_PATHS } from "./render-tree";

export interface InfoOverride {
  type?: InfoSpec["type"];
  variant?: string;
  colorMode?: InfoSpec["colorMode"];
  content?: InfoSpec["content"];
}

export interface NodeEdit {
  content?: CNode[];
  style?: Record<string, string>;
  type?: string;
  hidden?: boolean;
  info?: InfoOverride;
  image?: ImageRef;
}

export interface PageEdits {
  v: 1;
  nodes?: Record<string, NodeEdit>;
  added?: CNode[];
  variant?: Record<string, string>;
}

export const EMPTY_EDITS: PageEdits = { v: 1 };

export function isEmptyEdits(e: PageEdits | undefined): boolean {
  return !e || ((!e.nodes || Object.keys(e.nodes).length === 0) && (!e.added || e.added.length === 0) && (!e.variant || Object.keys(e.variant).length === 0));
}

// ───────────────────────── 정리(sanitize) ─────────────────────────

const PX_RE = /^-?\d{1,4}(\.\d{1,2})?px$/;
const px = (v: string, lo: number, hi: number) => PX_RE.test(v) && parseFloat(v) >= lo && parseFloat(v) <= hi;
const COLOR_KEYS = new Set(["color", "background", "backgroundColor", "borderColor", "fill", "stroke", "borderTopColor", "borderBottomColor"]);
const COLOR_WORDS = new Set(["transparent", "inherit", "currentColor", "currentcolor", "none"]);

/** 편집층 스타일 규칙(사용자가 정한 값) — 키마다 허용 모양 */
const EDIT_STYLE_RULES: Record<string, (v: string) => boolean> = {
  position: (v) => v === "relative" || v === "absolute",
  left: (v) => v === "auto" || px(v, -900, 1700),
  top: (v) => v === "auto" || px(v, -700, 1300),
  right: (v) => v === "auto" || px(v, -900, 1700),
  bottom: (v) => v === "auto" || px(v, -700, 1300),
  width: (v) => v === "auto" || px(v, 4, 1700) || /^(100|[1-9]?\d)%$/.test(v),
  height: (v) => v === "auto" || px(v, 2, 1300) || /^(100|[1-9]?\d)%$/.test(v),
  minHeight: (v) => px(v, 0, 1300),
  flex: (v) => v === "none" || v === "0 0 auto",
  flexShrink: (v) => v === "0" || v === "1",
  alignSelf: (v) => ["auto", "flex-start", "center", "flex-end", "stretch", "start", "end"].includes(v),
  gridTemplateColumns: (v) => /^repeat\([1-6], minmax\(0, 1fr\)\)$/.test(v),
  gridColumn: (v) => /^(span ([1-9]|1[0-2])|([1-9]|1[0-3]) \/ (span )?([1-9]|1[0-3]))$/.test(v),
  color: (v) => isTokenVar(v, "color") || COLOR_WORDS.has(v),
  background: (v) => isTokenVar(v, "color") || COLOR_WORDS.has(v),
  backgroundColor: (v) => isTokenVar(v, "color") || COLOR_WORDS.has(v),
  borderColor: (v) => isTokenVar(v, "color") || COLOR_WORDS.has(v),
  border: (v) => v === "none" || (/^(0\.5|[1-4])px solid var\(--[a-z0-9-]+\)$/.test(v) && isTokenVar(v.replace(/^.*solid /, ""), "color")),
  borderRadius: (v) => isTokenVar(v) || px(v, 0, 300) || v === "50%" || /^0 var\(--radius-leaf\) var\(--radius-leaf\) var\(--radius-leaf\)$/.test(v),
  opacity: (v) => /^(0(\.\d{1,2})?|1)$/.test(v),
  zIndex: (v) => /^(-1|[0-9]|1[0-9]|20)$/.test(v),
  textAlign: (v) => ["left", "center", "right"].includes(v),
  aspectRatio: (v) => PHOTO_RATIOS.some((r) => r.value === v) || v === "auto",
  padding: (v) => v.split(" ").length <= 4 && v.split(" ").every((p) => p === "0" || px(p, 0, 60)),
  overflow: (v) => v === "hidden" || v === "visible",
  objectFit: (v) => v === "cover" || v === "contain",
  fontFamily: (v) => /^var\(--kc-font-(display|body|figure)\)$/.test(v),
  display: (v) => v === "block" || v === "flex" || v === "grid",
  flexDirection: (v) => v === "column" || v === "row",
  justifyContent: (v) => ["flex-start", "center", "flex-end", "space-between"].includes(v),
  alignItems: (v) => ["flex-start", "center", "flex-end", "stretch"].includes(v),
  gap: (v) => px(v, 0, 48),
};

/** 편집층 스타일 정리 — 규칙에 없는 키·값은 버린다. 빈 문자열 = 기본 스타일 키 지우기(허용 키만). */
export function sanitizeEditStyle(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    const rule = EDIT_STYLE_RULES[k];
    if (!rule) continue;
    const v = String(raw ?? "").trim();
    if (v === "" || rule(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// 고정한 글(칩·서식 포함)의 스타일 — 기본 트리에서 복사된 스타일도 들어오므로 넓게 받되 위험 값·비토큰 색은 막는다
const CONTENT_STYLE_KEYS = new Set([
  "display", "flex", "flexShrink", "flexGrow", "alignItems", "alignSelf", "justifyContent", "gap", "gridColumn", "gridTemplateColumns",
  "width", "minWidth", "maxWidth", "height", "minHeight", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "border", "borderTop", "borderBottom", "borderLeft", "borderRight",
  "borderRadius", "borderColor", "borderTopColor", "borderBottomColor", "background", "backgroundColor", "color", "opacity",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textAlign", "textDecoration", "textTransform",
  "whiteSpace", "wordBreak", "verticalAlign", "position", "top", "left", "right", "bottom", "zIndex", "transform", "objectFit", "objectPosition",
  "fill", "stroke", "fillOpacity", "zoom",
]);

function safeCssValue(k: string, v: string): boolean {
  const s = v.toLowerCase();
  if (s.length > 200 || s.includes("url(") || s.includes("expression(") || s.includes("javascript:") || s.includes("<") || s.includes("\\")) return false;
  if (k === "position" && (s === "fixed" || s === "sticky")) return false;
  if (COLOR_KEYS.has(k)) {
    // 색은 토큰만(선 모양 border 는 굵기·모양 + 토큰 색)
    return isTokenVar(v, "color") || COLOR_WORDS.has(v);
  }
  if (k.startsWith("border") && /#|rgb|hsl/i.test(v)) return false;
  return true;
}

function sanitizeContentStyle(input: unknown): Record<string, string | number> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!CONTENT_STYLE_KEYS.has(k) && !/^--area(-mid|-tint)?$/.test(k)) continue;
    if (typeof raw === "number") {
      if (Number.isFinite(raw) && Math.abs(raw) < 5000) out[k] = raw;
      continue;
    }
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if (k.startsWith("--")) {
      if (isTokenVar(v, "color")) out[k] = v;
      continue;
    }
    if (safeCssValue(k, v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const CONTENT_TAGS = new Set(["#text", "span", "strong", "b", "em", "i", "u", "s", "small", "sup", "sub", "br", "a", "x-icon", "li", "p", "div"]);
const CONTENT_ATTRS = new Set(["data-ref", "data-ref-fmt", "data-ref-missing", "data-ref-alt", "data-folio", "data-metric", "data-bind", "data-continued-title", "data-first-only", "data-hide-empty", "aria-hidden", "href"]);
const CLASS_TOKEN = /^[A-Za-z][\w-]{0,60}$/;

function sanitizeClass(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const parts = v.split(/\s+/).filter((t) => CLASS_TOKEN.test(t)).slice(0, 10);
  return parts.length ? parts.join(" ") : undefined;
}

function sanitizeBind(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (/^metric:[a-z0-9.]{1,40}$/.test(v)) return v;
  if (v.startsWith("data:") && DATA_BIND_PATHS.test(v.slice(5))) return v;
  return undefined;
}

interface Budget {
  nodes: number;
  ids: Set<string>;
}

function cleanNodeId(raw: unknown, budget: Budget): string {
  const s = typeof raw === "string" ? raw : "";
  const id = (USER_ID_RE.test(s) || BASE_ID_RE.test(s)) && !budget.ids.has(s) ? s : newUserId();
  budget.ids.add(id);
  return id;
}

/** 고정한 글·목록 항목 노드 정리 */
function sanitizeContentNode(raw: unknown, depth: number, budget: Budget): CNode | null {
  if (!raw || typeof raw !== "object" || depth > 10 || --budget.nodes < 0) return null;
  const n = raw as Record<string, unknown>;
  const tag = String(n.tag ?? "");
  if (!CONTENT_TAGS.has(tag)) return null;
  const out: CNode = { id: cleanNodeId(n.id, budget), tag };
  if (tag === "#text") {
    out.text = String(n.text ?? "").slice(0, 2000);
    return out;
  }
  const cls = sanitizeClass(n.className);
  if (cls) out.className = cls;
  const style = sanitizeContentStyle(n.style);
  if (style) out.style = style;
  if (n.attrs && typeof n.attrs === "object") {
    const attrs: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(n.attrs as Record<string, unknown>)) {
      if (!CONTENT_ATTRS.has(k) || v == null || typeof v === "object") continue;
      const sv = String(v);
      if (sv.length > 120) continue;
      if (k === "href" && !/^#[\w-]*$/.test(sv)) continue;
      attrs[k] = v as string | number | boolean;
    }
    if (Object.keys(attrs).length) out.attrs = attrs;
  }
  const bind = sanitizeBind(n.bind);
  if (bind) {
    out.bind = bind;
    if (typeof n.bindDigits === "number" && n.bindDigits >= 0 && n.bindDigits <= 3) out.bindDigits = Math.round(n.bindDigits);
  }
  if (tag === "x-icon") {
    const p = (n.props && typeof n.props === "object" ? n.props : {}) as Record<string, unknown>;
    const name = typeof p.name === "string" && /^[a-z0-9-]{1,30}$/.test(p.name) ? p.name : "file-text";
    const iconCls = typeof p.cls === "string" && /^kc-icon( kc-icon--(sm|lg))?$/.test(p.cls) ? p.cls : "kc-icon";
    out.props = { name, cls: iconCls };
    return out;
  }
  if (isTypeStep(n.typeStep)) out.typeStep = n.typeStep as string;
  if (Array.isArray(n.children)) {
    const kids = n.children.map((c) => sanitizeContentNode(c, depth + 1, budget)).filter((c): c is CNode => c != null);
    if (kids.length) out.children = kids;
  }
  return out;
}

export function sanitizeContent(input: unknown): CNode[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const budget: Budget = { nodes: 800, ids: new Set() };
  const out = input.map((c) => sanitizeContentNode(c, 0, budget)).filter((c): c is CNode => c != null);
  return out;
}

function sanitizeImageRef(input: unknown): ImageRef | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const key = typeof o.key === "string" ? o.key : "";
  if (!/^(a\/[A-Za-z0-9_-]{1,64}|k\/assets\/[A-Za-z0-9_.-]{1,80})$/.test(key) || key.includes("..")) return undefined;
  const out: ImageRef = { key };
  const pct = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : undefined);
  const fx = pct(o.fx);
  const fy = pct(o.fy);
  if (fx != null) out.fx = fx;
  if (fy != null) out.fy = fy;
  if (typeof o.zoom === "number" && o.zoom >= 1 && o.zoom <= 3) out.zoom = Math.round(o.zoom * 100) / 100;
  if (o.fit === "contain" || o.fit === "cover") out.fit = o.fit;
  return out;
}

/** 추가한 요소 — 글상자(kc-x-text)·도형(kc-x-shape)·이미지(kc-x-image)만 */
export type AddedKind = "text" | "shape" | "image";
export const ADDED_SHAPES = ["rect", "round", "circle", "line"] as const;

export function addedKind(n: CNode): AddedKind | null {
  const c = n.className ?? "";
  if (/\bkc-x-text\b/.test(c)) return "text";
  if (/\bkc-x-shape\b/.test(c)) return "shape";
  if (/\bkc-x-image\b/.test(c)) return "image";
  return null;
}

function sanitizeAdded(raw: unknown, budget: Budget): CNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const kind = addedKind({ id: "", tag: "div", className: typeof n.className === "string" ? n.className : "" });
  if (!kind) return null;
  const style = sanitizeEditStyle(n.style) ?? {};
  style.position = "absolute";
  if (!style.left || !style.top || !style.width) return null;
  const id = cleanNodeId(n.id, budget);
  if (!USER_ID_RE.test(id)) return null;
  if (kind === "shape") {
    const shape = ADDED_SHAPES.find((s) => String(n.className).includes(`kc-x-shape--${s}`)) ?? "rect";
    return { id, tag: "div", className: `kc-x-shape kc-x-shape--${shape}`, style };
  }
  if (kind === "image") {
    const asset = sanitizeImageRef(n.asset);
    if (!asset) return null;
    style.overflow = "hidden";
    return { id, tag: "div", className: "kc-x-image", style, asset, children: [{ id: id + "i", tag: "img", attrs: { alt: "" }, asset }] };
  }
  const out: CNode = { id, tag: "div", className: "kc-x-text", style };
  out.typeStep = isTypeStep(n.typeStep) ? (n.typeStep as string) : "body";
  const kids = sanitizeContent(n.children) ?? [];
  out.children = kids.length ? kids : [{ id: newUserId(), tag: "#text", text: "" }];
  return out;
}

function sanitizeInfoOverride(input: unknown): InfoOverride | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const fallback: InfoSpec = { type: "process", content: { items: [] } };
  const spec = sanitizeInfoSpec({ ...o, type: o.type ?? "process" }, fallback);
  const out: InfoOverride = {};
  if (o.type) out.type = spec.type;
  if (o.variant) out.variant = spec.variant;
  if (o.colorMode) out.colorMode = spec.colorMode;
  if (o.content) out.content = spec.content;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeNodeEdit(input: unknown): NodeEdit | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const out: NodeEdit = {};
  const content = sanitizeContent(o.content);
  if (content) out.content = content;
  const style = sanitizeEditStyle(o.style);
  if (style) out.style = style;
  if (isTypeStep(o.type)) out.type = o.type as string;
  if (o.hidden === true) out.hidden = true;
  const info = sanitizeInfoOverride(o.info);
  if (info) out.info = info;
  const image = sanitizeImageRef(o.image);
  if (image) out.image = image;
  return Object.keys(out).length ? out : undefined;
}

const VARIANT_KEY = /^[a-z][a-z0-9-]{0,20}$/;
const VARIANT_VAL = /^([a-z0-9-]{1,30}|a\/[A-Za-z0-9_-]{1,64}|k\/assets\/[A-Za-z0-9_.-]{1,80})$/;

export function sanitizePageEdits(input: unknown): PageEdits {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: PageEdits = { v: 1 };
  if (o.nodes && typeof o.nodes === "object") {
    const nodes: Record<string, NodeEdit> = {};
    for (const [id, e] of Object.entries(o.nodes as Record<string, unknown>).slice(0, 2000)) {
      if (!BASE_ID_RE.test(id)) continue;
      const clean = sanitizeNodeEdit(e);
      if (clean) nodes[id] = clean;
    }
    if (Object.keys(nodes).length) out.nodes = nodes;
  }
  if (Array.isArray(o.added)) {
    const budget: Budget = { nodes: 1200, ids: new Set() };
    const added = o.added
      .slice(0, 40)
      .map((a) => sanitizeAdded(a, budget))
      .filter((a): a is CNode => a != null);
    if (added.length) out.added = added;
  }
  if (o.variant && typeof o.variant === "object") {
    const variant: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.variant as Record<string, unknown>)) {
      if (VARIANT_KEY.test(k) && typeof v === "string" && VARIANT_VAL.test(v) && !v.includes("..")) variant[k] = v;
    }
    if (Object.keys(variant).length) out.variant = variant;
  }
  return out;
}

// ───────────────────────── 적용(apply) ─────────────────────────

export interface ApplyOptions {
  /** 숨긴 노드도 흐리게 남긴다(스튜디오 캔버스) */
  showHidden?: boolean;
}

function mergeStyle(base: CNode["style"], patch: Record<string, string> | undefined, typeStep?: string): CNode["style"] {
  if (!patch && !typeStep) return base;
  const out: Record<string, string | number> = { ...(base ?? {}) };
  if (typeStep) Object.assign(out, typeStepStyle(typeStep));
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === "") delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 고정·추가 노드에 소유 표식을 단다(재귀) */
function markOwned(n: CNode, origin: "pin" | "add", owner: string): CNode {
  const out: CNode = { ...n, origin, owner };
  if (n.typeStep) out.style = mergeStyle(n.style, undefined, n.typeStep);
  if (n.children) out.children = n.children.map((c) => markOwned(c, origin, owner));
  return out;
}

export function mergeInfoSpec(base: InfoSpec, o: InfoOverride | undefined): InfoSpec {
  if (!o) return base;
  const type = o.type ?? base.type;
  const variant = o.type && o.type !== base.type && !o.variant ? undefined : (o.variant ?? base.variant);
  return { type, variant, colorMode: o.colorMode ?? base.colorMode, content: o.content ?? base.content };
}

/** 기본 트리 + 편집층 → 파생 트리. 원본은 건드리지 않는다. */
export function applyEdits(base: CNode, edits: PageEdits | undefined, opts: ApplyOptions = {}): CNode {
  const nodes = edits?.nodes ?? {};
  const walk = (node: CNode): CNode | null => {
    const e = nodes[node.id];
    if (e?.hidden && !opts.showHidden) return null;
    let n: CNode = { ...node, origin: "base" };
    if (e?.info && node.widget === "infographic" && node.props) {
      const p = node.props as unknown as InfoSlotProps;
      const rebuilt = infographicToTree({ ...p, spec: mergeInfoSpec(p.spec, e.info) }, node.id);
      if (rebuilt) n = { ...rebuilt, origin: "base", edited: true };
    }
    if (e?.content) {
      n.children = e.content.map((c) => markOwned(c, "pin", node.id));
      n.pinned = true;
    } else if (n.children) {
      n.children = n.children.map(walk).filter((c): c is CNode => c != null);
    }
    if (e?.style || e?.type) {
      n.style = mergeStyle(n.style, e.style, e.type);
      n.edited = true;
    }
    if (e?.image && node.tag === "img") {
      n.asset = e.image;
      n.edited = true;
    }
    if (e?.hidden) n.hiddenByEdit = true;
    return n;
  };
  const root = walk(base) ?? { ...base, children: [] };
  const added = (edits?.added ?? []).map((a) => markOwned(a, "add", a.id));
  if (added.length) root.children = [...(root.children ?? []), ...added];
  return root;
}

// ───────────────────────── 편집 조작(ops) ─────────────────────────
// 모두 새 편집층을 돌려준다(실행 취소 스냅샷과 호환). derived = 지금 그린 파생 트리(노드의 소유를 알기 위해).

function cloneEdits(e: PageEdits | undefined): PageEdits {
  return e ? (JSON.parse(JSON.stringify(e)) as PageEdits) : { v: 1 };
}

/** 파생 표식을 지운 저장용 사본 */
export function stripDerived(n: CNode): CNode {
  const { origin: _o, owner: _w, pinned: _p, edited: _e, hiddenByEdit: _h, ...rest } = n;
  void _o;
  void _w;
  void _p;
  void _e;
  void _h;
  const out: CNode = { ...rest };
  if (n.children) out.children = n.children.map(stripDerived);
  return out;
}

/** 사용자 노드로 새로 찍기(id 새로) */
function freshCopy(n: CNode): CNode {
  const out = stripDerived(n);
  const renew = (x: CNode): CNode => ({ ...x, id: newUserId(), ...(x.children ? { children: x.children.map(renew) } : {}) });
  return renew(out);
}

function nodeEdit(e: PageEdits, id: string): NodeEdit {
  e.nodes ??= {};
  return (e.nodes[id] ??= {});
}

function pruneNode(e: PageEdits, id: string): void {
  const ne = e.nodes?.[id];
  if (ne && Object.keys(ne).length === 0) delete e.nodes![id];
  if (e.nodes && Object.keys(e.nodes).length === 0) delete e.nodes;
}

/** 소유 트리 안에서 노드를 고친다 — fn 이 null 을 돌려주면 그 노드를 지운다 */
function mutateIn(list: CNode[], id: string, fn: (n: CNode) => CNode | null): CNode[] {
  const out: CNode[] = [];
  for (const n of list) {
    if (n.id === id) {
      const r = fn(n);
      if (r) out.push(r);
      continue;
    }
    out.push(n.children ? { ...n, children: mutateIn(n.children, id, fn) } : n);
  }
  return out;
}

/** 파생 트리에서 노드를 찾아 소유를 알아낸 뒤, 그 저장 자리에서 fn 을 적용 */
function mutateOwned(edits: PageEdits, derived: CNode, id: string, fn: (n: CNode) => CNode | null, baseFn: (ne: NodeEdit, n: CNode) => void): PageEdits {
  const path = findPath(derived, id);
  if (!path) return edits;
  const node = path[path.length - 1];
  const next = cloneEdits(edits);
  if (!node.origin || node.origin === "base") {
    baseFn(nodeEdit(next, id), node);
    pruneNode(next, id);
    return next;
  }
  if (node.origin === "pin" && node.owner) {
    const ne = nodeEdit(next, node.owner);
    ne.content = mutateIn(ne.content ?? [], id, (n) => fn(n));
    return next;
  }
  if (node.origin === "add") {
    next.added = mutateIn(next.added ?? [], id, (n) => fn(n));
    if (next.added.length === 0) delete next.added;
    return next;
  }
  return edits;
}

/** L1 글 고치기 — 문단 블록의 자식을 통째로 바꾼다(기본 노드면 고정) */
export function setNodeContent(edits: PageEdits, derived: CNode, id: string, children: CNode[]): PageEdits {
  const clean = (sanitizeContent(children) ?? []).map(stripDerived);
  return mutateOwned(
    edits,
    derived,
    id,
    (n) => ({ ...n, children: clean }),
    (ne) => {
      ne.content = clean;
    }
  );
}

/** 스타일 덧씌우기(L2·L3) — 빈 문자열 = 그 키 지우기 */
export function patchNodeStyle(edits: PageEdits, derived: CNode, id: string, patch: Record<string, string>): PageEdits {
  const clean = sanitizeEditStyle(patch) ?? {};
  return mutateOwned(
    edits,
    derived,
    id,
    (n) => {
      const style = { ...(n.style ?? {}) } as Record<string, string | number>;
      for (const [k, v] of Object.entries(clean)) {
        if (v === "") delete style[k];
        else style[k] = v;
      }
      return { ...n, style };
    },
    (ne) => {
      ne.style = { ...(ne.style ?? {}), ...clean };
    }
  );
}

/** 타입 스케일 단계(L3) — null = 원래 크기로 */
export function setNodeType(edits: PageEdits, derived: CNode, id: string, step: string | null): PageEdits {
  if (step != null && !isTypeStep(step)) return edits;
  return mutateOwned(
    edits,
    derived,
    id,
    (n) => {
      const out = { ...n };
      if (step) out.typeStep = step;
      else delete out.typeStep;
      return out;
    },
    (ne) => {
      if (step) ne.type = step;
      else delete ne.type;
    }
  );
}

/** 숨기기(기본 노드) · 지우기(고정·추가 노드) */
export function hideNode(edits: PageEdits, derived: CNode, id: string): PageEdits {
  return mutateOwned(
    edits,
    derived,
    id,
    () => null,
    (ne) => {
      ne.hidden = true;
    }
  );
}

export function unhideNode(edits: PageEdits, id: string): PageEdits {
  const next = cloneEdits(edits);
  if (next.nodes?.[id]) {
    delete next.nodes[id].hidden;
    pruneNode(next, id);
  }
  return next;
}

/** 자동 값으로 되돌리기 — 기본 노드의 편집 일부(또는 전부)를 지운다 */
export function resetNode(edits: PageEdits, id: string, parts: Array<keyof NodeEdit> | "all" = "all"): PageEdits {
  const next = cloneEdits(edits);
  if (!next.nodes?.[id]) return edits;
  if (parts === "all") delete next.nodes[id];
  else for (const p of parts) delete next.nodes[id][p];
  pruneNode(next, id);
  return next;
}

/** 인포그래픽 유형·변형·색·내용 바꾸기(L2) — null = 기본 spec 으로 */
export function setInfo(edits: PageEdits, id: string, info: InfoOverride | null): PageEdits {
  const next = cloneEdits(edits);
  if (!info) {
    if (next.nodes?.[id]) delete next.nodes[id].info;
  } else {
    const clean = sanitizeInfoOverride(info);
    if (clean) nodeEdit(next, id).info = clean;
  }
  pruneNode(next, id);
  return next;
}

/** 사진 교체·초점·확대·맞춤(L1) — null = 원래 사진 */
export function setImage(edits: PageEdits, derived: CNode, id: string, image: ImageRef | null): PageEdits {
  const clean = image ? sanitizeImageRef(image) : undefined;
  if (image && !clean) return edits;
  return mutateOwned(
    edits,
    derived,
    id,
    (n) => {
      if (!clean) return n;
      // 추가한 이미지 상자는 상자와 안의 img 둘 다 같은 자산
      const children = n.children?.map((c) => (c.tag === "img" ? { ...c, asset: clean } : c));
      return { ...n, asset: clean, ...(children ? { children } : {}) };
    },
    (ne) => {
      if (clean) ne.image = clean;
      else delete ne.image;
    }
  );
}

export type ListOp = "duplicate" | "remove" | "up" | "down";

/**
 * 목록 항목 추가(복제)·삭제·순서(L1). 부모가 아직 기본 노드면 지금 모습을 고정(사용자 노드로 복사)한 뒤 조작한다
 * — 그 목록은 이후 자동 갱신에서 빠진다(데이터 목록은 위젯이라 여기 오지 않는다).
 */
export function listItemOp(edits: PageEdits, derived: CNode, itemId: string, op: ListOp): PageEdits {
  const path = findPath(derived, itemId);
  if (!path || path.length < 2) return edits;
  const parent = path[path.length - 2];
  const item = path[path.length - 1];
  const apply = (list: CNode[], targetId: string): CNode[] => {
    const i = list.findIndex((c) => c.id === targetId);
    if (i < 0) return list;
    const out = [...list];
    if (op === "duplicate") out.splice(i + 1, 0, freshCopy(out[i]));
    else if (op === "remove") {
      if (out.filter((c) => c.tag !== "#text").length <= 1) return list;
      out.splice(i, 1);
    } else {
      const j = op === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= out.length) return list;
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const next = cloneEdits(edits);
  if (!parent.origin || parent.origin === "base") {
    const ne = nodeEdit(next, parent.id);
    if (!ne.content) {
      // 고정: 지금 보이는 자식을 사용자 노드로 복사(항목 id 는 새로) — 조작 대상 항목의 새 id 를 찾아 이어서 적용
      const copied = (parent.children ?? []).map((c) => freshCopy(c));
      const idx = (parent.children ?? []).findIndex((c) => c.id === item.id);
      ne.content = copied;
      if (idx < 0) return next;
      ne.content = apply(copied, copied[idx].id);
      return next;
    }
    ne.content = apply(ne.content, item.id);
    return next;
  }
  if (parent.origin === "pin" && parent.owner) {
    const ne = nodeEdit(next, parent.owner);
    ne.content = parent.id === parent.owner ? apply(ne.content ?? [], item.id) : mutateIn(ne.content ?? [], parent.id, (p) => ({ ...p, children: apply(p.children ?? [], item.id) }));
    return next;
  }
  if (parent.origin === "add") {
    next.added = mutateIn(next.added ?? [], parent.id, (p) => ({ ...p, children: apply(p.children ?? [], item.id) }));
    return next;
  }
  return edits;
}

/** 요소 추가(L3) */
export function addElement(edits: PageEdits, node: CNode): PageEdits {
  const budget: Budget = { nodes: 400, ids: new Set() };
  const clean = sanitizeAdded(stripDerived(node), budget);
  if (!clean) return edits;
  const next = cloneEdits(edits);
  next.added = [...(next.added ?? []), clean].slice(0, 40);
  return next;
}

/** 쪽 변형(L2) — value null = 지우기 */
export function setVariant(edits: PageEdits, key: string, value: string | null): PageEdits {
  const next = cloneEdits(edits);
  if (value == null) {
    if (next.variant) delete next.variant[key];
    if (next.variant && Object.keys(next.variant).length === 0) delete next.variant;
  } else if (VARIANT_KEY.test(key) && VARIANT_VAL.test(value)) {
    next.variant = { ...(next.variant ?? {}), [key]: value };
  }
  return next;
}

/** 이 쪽 편집층이 가리키지만 지금 기본 트리에 없는 노드 id(데이터 구조가 바뀌어 붙을 곳을 잃은 편집) */
export function orphanEdits(base: CNode, edits: PageEdits | undefined): string[] {
  const ids = new Set<string>();
  const walk = (n: CNode) => {
    ids.add(n.id);
    n.children?.forEach(walk);
  };
  walk(base);
  return Object.keys(edits?.nodes ?? {}).filter((id) => !ids.has(id));
}
