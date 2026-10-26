/*
 * 일러스트 SVG 정리 — 올린 SVG 는 신뢰하지 않는 입력이다. 화이트리스트로 다시 쓴다(의존성 없는 작은 토크나이저).
 *   · 요소: 그리기·묶음·정의·그라데이션·클립·마스크만. script·foreignObject·style·a·animate·외부 image 는 통째로 버린다.
 *   · 속성: 모양·표현 속성·id·참조만. on* 처리기·외부 href·javascript:·url(외부)·CSS @import 는 버린다.
 *   · image 는 data:image/png|jpeg|webp base64 만(매처가 효과를 남긴 경우).
 *   · id 는 자산마다 접두사를 붙인다(한 쪽에 여러 일러스트가 있어도 겹치지 않게) — url(#…)·href="#…" 도 함께.
 *   · 주석·처리 지시·DOCTYPE·CDATA 는 지운다. 엔터티 선언이 있으면 거부한다.
 * 결과 루트 <svg> 는 viewBox 와 preserveAspectRatio 만 남긴다(크기는 앱이 CSS 로 정한다).
 */

export const ILLUST_SVG_MAX_BYTES = 3 * 1024 * 1024;
const MAX_ELEMENTS = 60000;
const MAX_DEPTH = 64;

const ELEMENTS = new Set([
  "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "clipPath", "mask", "linearGradient", "radialGradient", "stop", "use", "symbol", "image",
  "filter", "feGaussianBlur", "feColorMatrix", "feOffset", "feBlend", "feMerge", "feMergeNode", "feFlood", "feComposite",
]);
/** 내용째 버리는 요소 */
const DROP_WITH_CONTENT = new Set(["script", "style", "foreignObject", "a", "animate", "animateMotion", "animateTransform", "set", "title", "desc", "metadata", "switch", "iframe", "text", "textPath", "tspan", "font", "font-face", "pattern", "marker", "view", "cursor", "feImage"]);

const ATTRS = new Set([
  "id", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "width", "height", "points", "transform",
  "viewBox", "preserveAspectRatio", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "clip-path", "clip-rule", "mask", "filter",
  "style", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits",
  "maskContentUnits", "filterUnits", "primitiveUnits", "href", "xlink:href", "overflow", "visibility", "display", "mix-blend-mode",
  "isolation", "in", "in2", "result", "stdDeviation", "dx", "dy", "type", "values", "mode", "operator", "k1", "k2", "k3", "k4",
  "flood-color", "flood-opacity", "color-interpolation-filters", "vector-effect", "paint-order",
]);
const STYLE_PROPS = new Set([
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "stop-color", "stop-opacity", "mix-blend-mode", "isolation",
  "clip-path", "clip-rule", "mask", "filter", "display", "visibility", "flood-color", "flood-opacity", "vector-effect",
]);

const NAME_RE = /^[A-Za-z_][\w:.-]*$/;
const SAFE_URL_REF = /url\(\s*['"]?#([\w.:-]+)['"]?\s*\)/g;

export interface SanitizedSvg {
  svg: string;
  viewBox: [number, number, number, number];
  elements: number;
  dropped: string[];
}

function decodeEntities(v: string): string {
  return v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function unsafeValue(v: string): boolean {
  const s = v.toLowerCase().replace(/\s+/g, "");
  if (s.includes("javascript:") || s.includes("vbscript:") || s.includes("expression(") || s.includes("@import") || s.includes("<")) return true;
  // url() 는 같은 문서 안 참조(#id)만
  const urls = s.match(/url\(/g)?.length ?? 0;
  const local = s.match(/url\(['"]?#/g)?.length ?? 0;
  return urls !== local;
}

function cleanStyle(v: string): string | null {
  const out: string[] = [];
  for (const part of v.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (!val || val.length > 300) continue;
    if (!STYLE_PROPS.has(k) || unsafeValue(val)) continue;
    // 색 변수는 매처가 만든 --il-cN(색)·--il-i{항목}{밝기}(항목별 색)만
    const vars = val.match(/var\(\s*--[\w-]+/g) ?? [];
    if (vars.some((x) => !/^var\(\s*--il-(c\d{1,3}|i\d{1,2}(m2|m1|0|p1|p2))$/.test(x))) continue;
    out.push(`${k}:${val}`);
  }
  return out.length ? out.join(";") : null;
}

interface Tok {
  kind: "open" | "close" | "self" | "text";
  name?: string;
  attrs?: Array<[string, string]>;
}

function* tokenize(src: string): Generator<Tok> {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      yield { kind: "text" };
      return;
    }
    if (lt > i) yield { kind: "text" };
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      if (e < 0) throw new Error("주석이 닫히지 않았습니다.");
      i = e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt);
      if (e < 0) throw new Error("CDATA 가 닫히지 않았습니다.");
      i = e + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const e = src.indexOf("?>", lt);
      if (e < 0) throw new Error("처리 지시가 닫히지 않았습니다.");
      i = e + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      const e = src.indexOf(">", lt);
      const decl = src.slice(lt, e < 0 ? n : e + 1);
      if (/<!ENTITY/i.test(decl) || decl.includes("[")) throw new Error("엔터티 선언이 있는 SVG 는 받지 않습니다.");
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (src[lt + 1] === "/") {
      const e = src.indexOf(">", lt);
      if (e < 0) throw new Error("닫는 태그가 끝나지 않았습니다.");
      yield { kind: "close", name: src.slice(lt + 2, e).trim() };
      i = e + 1;
      continue;
    }
    // 여는 태그 — 속성값 안의 > 를 건너뛰며 끝을 찾는다
    let j = lt + 1;
    let q: string | null = null;
    while (j < n) {
      const c = src[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === ">") break;
      j++;
    }
    if (j >= n) throw new Error("태그가 끝나지 않았습니다.");
    let body = src.slice(lt + 1, j);
    const self = body.endsWith("/");
    if (self) body = body.slice(0, -1);
    const m = /^([A-Za-z_][\w:.-]*)/.exec(body);
    if (!m) throw new Error("태그 이름이 올바르지 않습니다.");
    const attrs: Array<[string, string]> = [];
    const re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    const rest = body.slice(m[1].length);
    let am: RegExpExecArray | null;
    while ((am = re.exec(rest))) attrs.push([am[1], decodeEntities(am[3] ?? am[4] ?? "")]);
    yield { kind: self ? "self" : "open", name: m[1], attrs };
    i = j + 1;
  }
}

function localName(name: string): string {
  const k = name.indexOf(":");
  return k >= 0 && !name.startsWith("xlink:") ? name.slice(k + 1) : name;
}

/** SVG 문자열 → 정리한 SVG. prefix = id 접두사(예: "il3f9a-"). 형식이 깨졌거나 너무 크면 예외. */
export function sanitizeIllustrationSvg(src: string, prefix: string): SanitizedSvg {
  if (Buffer.byteLength(src, "utf8") > ILLUST_SVG_MAX_BYTES) throw new Error(`SVG 가 ${Math.round(ILLUST_SVG_MAX_BYTES / 1048576)}MB 를 넘습니다.`);
  if (!/^[a-z][a-z0-9-]{0,20}$/.test(prefix)) throw new Error("id 접두사가 올바르지 않습니다.");
  const out: string[] = [];
  const stack: Array<{ name: string; keep: boolean }> = [];
  const dropped = new Set<string>();
  let dropDepth = 0;
  let count = 0;
  let viewBox: [number, number, number, number] | null = null;
  let rootSeen = false;
  const fix = (v: string) =>
    v.replace(SAFE_URL_REF, (_m, id: string) => `url(#${prefix}${id})`);
  for (const t of tokenize(src)) {
    if (t.kind === "text") continue;
    if (t.kind === "close") {
      const top = stack.pop();
      if (!top) throw new Error("태그 짝이 맞지 않습니다.");
      if (localName(top.name) !== localName(t.name!)) throw new Error(`태그 짝이 맞지 않습니다(${top.name}).`);
      if (dropDepth > 0) {
        dropDepth--;
        continue;
      }
      if (top.keep) out.push(`</${localName(top.name)}>`);
      continue;
    }
    const name = localName(t.name!);
    if (dropDepth > 0) {
      if (t.kind === "open") {
        stack.push({ name: t.name!, keep: false });
        dropDepth++;
      }
      continue;
    }
    if (++count > MAX_ELEMENTS) throw new Error("요소가 너무 많습니다.");
    if (stack.length >= MAX_DEPTH) throw new Error("중첩이 너무 깊습니다.");
    if (!rootSeen) {
      if (name !== "svg") throw new Error("SVG 문서가 아닙니다.");
      rootSeen = true;
    }
    const isRoot = stack.length === 0;
    if (!ELEMENTS.has(name) || DROP_WITH_CONTENT.has(name) || (name === "svg" && !isRoot)) {
      dropped.add(name);
      if (t.kind === "open") {
        stack.push({ name: t.name!, keep: false });
        dropDepth = 1;
      }
      continue;
    }
    const attrs: string[] = [];
    let keepEl = true;
    for (const [rawK, rawV] of t.attrs ?? []) {
      const k = rawK === "xlink:href" ? "href" : rawK;
      if (!NAME_RE.test(k) || /^on/i.test(k) || !ATTRS.has(k)) continue;
      if (isRoot && k !== "viewBox" && k !== "preserveAspectRatio") continue;
      let v = rawV.trim();
      if (v.length > 200000) continue;
      if (k === "href") {
        if (name === "image") {
          if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(v)) {
            keepEl = false;
            break;
          }
        } else if (/^#[\w.:-]+$/.test(v)) v = `#${prefix}${v.slice(1)}`;
        else continue;
      } else if (k === "id") {
        if (!/^[\w.:-]{1,120}$/.test(v)) continue;
        v = prefix + v;
      } else if (k === "style") {
        const st = cleanStyle(v);
        if (!st) continue;
        v = fix(st);
      } else {
        if (unsafeValue(v)) continue;
        v = fix(v);
      }
      if (k === "viewBox") {
        const nums = v.split(/[\s,]+/).map(Number);
        if (nums.length !== 4 || nums.some((x) => !Number.isFinite(x)) || nums[2] <= 0 || nums[3] <= 0) continue;
        viewBox = nums as [number, number, number, number];
      }
      attrs.push(`${k === "href" ? "href" : k}="${escAttr(v)}"`);
    }
    if (!keepEl) {
      dropped.add(name);
      if (t.kind === "open") {
        stack.push({ name: t.name!, keep: false });
        dropDepth = 1;
      }
      continue;
    }
    if (isRoot) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    const tag = `<${name}${attrs.length ? " " + attrs.join(" ") : ""}`;
    if (t.kind === "self") out.push(`${tag}/>`);
    else {
      out.push(`${tag}>`);
      stack.push({ name: t.name!, keep: true });
    }
  }
  if (stack.length) throw new Error("닫히지 않은 태그가 있습니다.");
  if (!rootSeen) throw new Error("SVG 문서가 아닙니다.");
  if (!viewBox) throw new Error("viewBox 가 없는 SVG 입니다.");
  return { svg: out.join(""), viewBox, elements: count, dropped: [...dropped] };
}

// ───────────────────────── 색 변수 만들기(매처를 거치지 않은 SVG) ─────────────────────────

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(v: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function parseRgbFn(v: string): Rgb | null {
  const m = /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/i.exec(v.trim());
  if (!m) return null;
  const c = (n: string, pct: string) => Math.max(0, Math.min(255, Math.round(pct ? Number(n) * 2.55 : Number(n))));
  return { r: c(m[1], m[2]), g: c(m[3], m[4]), b: c(m[5], m[6]) };
}

const toHex = (c: Rgb) => "#" + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, "0")).join("");

function hsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return { h, s, l };
}

/**
 * 색 값마다 var(--il-cN, #원래색) 으로 바꾸고 팔레트를 만든다 — 매처 export 의 palette_vars 와 같은 규칙(쓰임 순, 색상 무리, 무리 안 밝기 차).
 * 이미 --il- 변수가 있는 SVG(매처 결과)는 그대로 둔다.
 */
export function paletteizeSvg(svg: string): { svg: string; palette: Array<{ v: string; hex: string; use: number; l: number; group?: number; shade?: number; neutral?: boolean }> } {
  if (svg.includes("var(--il-")) return { svg, palette: [] };
  const COLOR_RE = /\b(fill|stroke|stop-color|flood-color)(="|:)\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]*\))/g;
  const count = new Map<string, number>();
  for (const m of svg.matchAll(COLOR_RE)) {
    const c = parseHex(m[3]) ?? parseRgbFn(m[3]);
    if (!c) continue;
    const h = toHex(c);
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  const order = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!).slice(0, 300);
  const total = order.reduce((a, h) => a + count.get(h)!, 0) || 1;
  const clusters: Array<{ h: number; m: string[]; n: number }> = [];
  for (const h of order) {
    const c = hsl(parseHex(h)!);
    const rgb = parseHex(h)!;
    const chroma = (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
    if (chroma < 0.2 || c.l > 0.97 || c.l < 0.04) continue;
    const hit = clusters.find((k) => Math.min(Math.abs(k.h - c.h), 1 - Math.abs(k.h - c.h)) < 0.04);
    if (hit) {
      hit.m.push(h);
      hit.n += count.get(h)!;
    } else clusters.push({ h: c.h, m: [h], n: count.get(h)! });
  }
  clusters.sort((a, b) => b.n - a.n);
  const group = new Map<string, { g: number; shade: number }>();
  clusters.forEach((k, g) => {
    const ls = k.m.map((h) => hsl(parseHex(h)!).l).sort((a, b) => a - b);
    const ref = ls[Math.floor(ls.length / 2)];
    for (const h of k.m) group.set(h, { g, shade: Math.round(Math.max(-1, Math.min(1, (hsl(parseHex(h)!).l - ref) / 0.5)) * 1000) / 1000 });
  });
  const vars = new Map<string, string>();
  const palette = order.map((h, i) => {
    vars.set(h, `c${i + 1}`);
    const gr = group.get(h);
    const base = { v: `c${i + 1}`, hex: h, use: Math.round((count.get(h)! / total) * 10000) / 10000, l: Math.round(hsl(parseHex(h)!).l * 1000) / 1000 };
    return gr ? { ...base, group: gr.g, shade: gr.shade } : { ...base, neutral: true };
  });
  const out = svg.replace(/(\s)(fill|stroke|stop-color|flood-color)="(#[0-9a-fA-F]{3,6}|rgb\([^)]*\))"/g, (m, sp: string, k: string, v: string) => {
    const c = parseHex(v) ?? parseRgbFn(v);
    const name = c ? vars.get(toHex(c)) : undefined;
    return name ? `${sp}style="${k}:var(--il-${name},${toHex(c!)})"` : m;
  });
  // 같은 요소에 style 이 둘이 되면 합친다(앞의 style 에 이어 붙임)
  const merged = out.replace(/<([a-zA-Z]+)([^<>]*?)>/g, (tag: string, name: string, attrs: string) => {
    const styles = [...attrs.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);
    if (styles.length < 2) return tag;
    const rest = attrs.replace(/\sstyle="[^"]*"/g, "");
    const selfClose = rest.trimEnd().endsWith("/");
    return `<${name}${selfClose ? rest.trimEnd().slice(0, -1) : rest} style="${styles.join(";")}"${selfClose ? "/" : ""}>`;
  });
  // style 안 색 값도 바꾼다
  const final = merged.replace(/style="([^"]*)"/g, (m, st: string) => {
    const next = st.replace(/(fill|stroke|stop-color|flood-color):\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]*\))/g, (mm, k: string, v: string) => {
      const c = parseHex(v) ?? parseRgbFn(v);
      const name = c ? vars.get(toHex(c)) : undefined;
      return name ? `${k}:var(--il-${name},${toHex(c!)})` : mm;
    });
    return `style="${next}"`;
  });
  return { svg: final, palette };
}
