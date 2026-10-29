"use client";

// 스튜디오 품질 검사(블루프린트 §8-3) — 캔버스 쪽 하나를 그린 뒤 iframe 안에서 잰다.
//   넘침: PDF 와 같은 검사(print-kit paginate.js 의 checkSheet, __pkCheckSheet)
//   대비: 글자색 ÷ 바탕색 4.5:1(큰 글자 3:1) 미만
//   해상도: 사진이 쪽에 놓인 크기 대비 원본 화소 — 인쇄 300dpi 권장, 150dpi 미만 경고
//   글자 크기: 7pt 미만(디자인 시스템 최소 각주 7pt)
// 전체 검사: 모든 쪽을 정적 HTML 로 숨은 틀에 싣고 paginate 로 쪽을 나눈 뒤 넘침 경고를 쪽 키별로 모은다(서체 바꾼 뒤 재검사).
//   서체 라이브러리 세트면 문서에 실제로 쓰인 글자 중 역할 서체에 없는 글자(빠진 글자 — 프리텐다드로 채워짐)도 모은다.

import type { RoleFontInfo } from "@/lib/catalog/fonts";
import { FONT_ROLE_LABEL, inRanges, type FontRole } from "@/lib/catalog/font-types";

export type CheckKind = "overflow" | "contrast" | "resolution" | "size" | "asset";

export interface CheckItem {
  kind: CheckKind;
  severity: "error" | "warn" | "info";
  message: string;
  text?: string;
  nodeId: string | null;
}

export const CHECK_LABEL: Record<CheckKind, string> = { overflow: "넘침", contrast: "대비", resolution: "해상도", size: "글자 크기", asset: "자산" };

interface PkWarning {
  kind: string;
  message: string;
  text?: string;
  page?: number;
  el?: Element;
}

const idOf = (el: Element | null | undefined): string | null => (el?.closest?.("[data-cn]") as HTMLElement | null)?.getAttribute("data-cn") ?? null;

/** 계산된 색 → [r, g, b, a](0~255, a 0~1). rgb()·rgba() 와 color-mix 결과인 color(srgb …) 를 읽는다 */
function parseRgb(v: string): [number, number, number, number] | null {
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  const c = /color\(srgb\s+([^)]+)\)/.exec(v);
  if (c) {
    const p = c[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number, number], b: [number, number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function ownText(el: Element): string {
  let t = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) t += n.nodeValue ?? "";
  });
  return t.trim();
}

/** 쪽 하나 검사(캔버스) */
export function checkSheet(win: Window, sheet: HTMLElement): CheckItem[] {
  const out: CheckItem[] = [];
  // 템플릿 사진 폴백(TP2) — 사진이 필요한 변형인데 사진이 없어 다른 변형으로 그린 쪽(쪽 루트 data-fallback-note, plan.tsx resolveVariant)
  const fallback = sheet.getAttribute("data-fallback-note");
  if (fallback) out.push({ kind: "asset", severity: "info", message: fallback, nodeId: null });
  const pk = (win as unknown as { __pkCheckSheet?: (s: Element) => PkWarning[] }).__pkCheckSheet;
  if (pk) {
    try {
      for (const w of pk(sheet)) out.push({ kind: "overflow", severity: "error", message: w.message, text: w.text, nodeId: idOf(w.el) });
    } catch {
      // 검사 실패는 화면을 막지 않는다
    }
  }
  const style = (el: Element) => win.getComputedStyle(el);
  const els = Array.from(sheet.querySelectorAll("*"));
  let contrastCount = 0;
  let sizeCount = 0;
  for (const el of els) {
    if (el.closest("[aria-hidden='true'], .pk-outline, svg, [data-overflow-ok]")) continue;
    const text = ownText(el);
    if (!text) continue;
    const cs = style(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const size = parseFloat(cs.fontSize);
    if (size < 7 && sizeCount < 4) {
      sizeCount++;
      out.push({ kind: "size", severity: "warn", message: `글자가 ${size}pt 로 너무 작습니다(최소 7pt).`, text: text.slice(0, 40), nodeId: idOf(el) });
    }
    if (contrastCount >= 4) continue;
    const fg = parseRgb(cs.color);
    if (!fg || fg[3] < 0.99) continue;
    // 바탕: 가장 가까운 불투명 배경색(그림 바탕이면 건너뜀)
    let bg: [number, number, number, number] | null = null;
    for (let a: Element | null = el; a; a = a.parentElement) {
      // 일러스트 글자 자리(313) — 바탕은 그 아래 SVG 도형을 바꿔 칠한 색
      const illBg = a.getAttribute("data-ill-bg");
      if (illBg && /^#[0-9a-f]{6}$/i.test(illBg)) {
        bg = [parseInt(illBg.slice(1, 3), 16), parseInt(illBg.slice(3, 5), 16), parseInt(illBg.slice(5, 7), 16), 1];
        break;
      }
      const as = style(a);
      if (as.backgroundImage && as.backgroundImage !== "none") {
        bg = null;
        break;
      }
      const c = parseRgb(as.backgroundColor);
      if (c && c[3] >= 0.99) {
        bg = c;
        break;
      }
      // 반투명 바탕은 겹친 결과를 알 수 없어 판정하지 않는다
      if (c && c[3] > 0.01) {
        bg = null;
        break;
      }
      if (a === sheet) break;
    }
    if (!bg) continue;
    const ratio = contrast(fg, bg);
    const large = size >= 18.66 || (size >= 14 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      contrastCount++;
      out.push({ kind: "contrast", severity: "warn", message: `글자와 바탕의 대비가 ${ratio.toFixed(1)}:1 입니다(기준 ${need}:1).`, text: text.slice(0, 40), nodeId: idOf(el) });
    }
  }
  for (const img of Array.from(sheet.querySelectorAll("img"))) {
    if (!img.complete || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    const sheetRect = sheet.getBoundingClientRect();
    const scale = sheetRect.width / 842 || 1;
    const w = r.width / scale;
    const h = r.height / scale;
    if (w < 24 || h < 24) continue;
    const fit = style(img).objectFit;
    const ptPerPx = fit === "contain" ? Math.max(w / img.naturalWidth, h / img.naturalHeight) : Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dpi = Math.round(72 / ptPerPx);
    if (dpi < 150) out.push({ kind: "resolution", severity: "warn", message: `사진 해상도가 약 ${dpi}dpi 입니다(인쇄 최소 150dpi). 더 큰 사진으로 바꾸세요.`, text: img.alt, nodeId: idOf(img) });
    else if (dpi < 300) out.push({ kind: "resolution", severity: "info", message: `사진 약 ${dpi}dpi — 화면·PDF 는 충분, 인쇄 권장 300dpi 미만입니다.`, text: img.alt, nodeId: idOf(img) });
  }
  return out;
}

/** 역할 서체에 없어 대체 서체가 그린 글자 */
export interface GlyphMiss {
  role: FontRole;
  label: string;
  /** 빠진 글자(겹치지 않게, 앞 60자) */
  chars: string;
  distinct: number;
  /** 문서에 나온 횟수 */
  count: number;
  /** 나온 쪽 키(앞 6개) */
  pages: string[];
  /** 본문·제목의 한글이 빠졌거나 종류가 많다 — 서체를 바꾸는 편이 낫다 */
  severe: boolean;
}

export interface FullCheckResult {
  pages: number;
  /** 쪽 키 → 넘침 경고 */
  byKey: Record<string, Array<{ message: string; text?: string }>>;
  total: number;
  /** 빠진 글자(서체 라이브러리 세트만) */
  glyphs?: GlyphMiss[];
  error?: string;
}

const isBlank = (cp: number) => cp <= 0x20 || cp === 0xa0 || cp === 0xad || cp === 0xfeff || (cp >= 0x2000 && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202f);

/** 문서 글자 중 역할 서체에 없는 것 — 글자의 계산된 font-family 첫 이름(kcs-{세트}-{역할})으로 역할을 찾는다 */
export function findMissingGlyphs(doc: Document, win: Window, roleFonts: Partial<Record<FontRole, RoleFontInfo>>): GlyphMiss[] {
  const byFamily = new Map<string, { role: FontRole; info: RoleFontInfo }>();
  // 기준 서체 프리텐다드는 빼고 본다(前·現 같은 한자는 원래 시스템 대체 서체가 그린다 — P4)
  for (const [role, info] of Object.entries(roleFonts) as Array<[FontRole, RoleFontInfo | undefined]>)
    if (info && info.fontId !== "b-pretendard") byFamily.set(info.family.toLowerCase(), { role, info });
  if (!byFamily.size) return [];
  const cache = new Map<Element, { role: FontRole; info: RoleFontInfo } | null>();
  const acc = new Map<FontRole, { info: RoleFontInfo; chars: Map<string, number>; pages: Set<string> }>();
  const root = doc.querySelector(".pk-book") ?? doc.body;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el) continue;
    let hit = cache.get(el);
    if (hit === undefined) {
      hit = null;
      if (!el.closest(".pk-outline, svg, [aria-hidden='true']") && el.getClientRects().length) {
        const first = win.getComputedStyle(el).fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "").toLowerCase() ?? "";
        hit = byFamily.get(first) ?? null;
      }
      cache.set(el, hit);
    }
    if (!hit) continue;
    for (const ch of n.nodeValue ?? "") {
      const cp = ch.codePointAt(0) ?? 0;
      if (isBlank(cp) || inRanges(hit.info.ranges, cp)) continue;
      const a = acc.get(hit.role) ?? { info: hit.info, chars: new Map<string, number>(), pages: new Set<string>() };
      acc.set(hit.role, a);
      a.chars.set(ch, (a.chars.get(ch) ?? 0) + 1);
      const key = el.closest(".pk-sheet")?.getAttribute("data-studio-key");
      if (key) a.pages.add(key);
    }
  }
  const order: FontRole[] = ["display", "body", "figure"];
  return order
    .filter((r) => acc.has(r))
    .map((role) => {
      const a = acc.get(role)!;
      const chars = Array.from(a.chars.keys());
      const hangul = chars.some((c) => /[가-힣]/.test(c));
      return {
        role,
        label: a.info.label,
        chars: chars.slice(0, 60).join(""),
        distinct: chars.length,
        count: Array.from(a.chars.values()).reduce((x, y) => x + y, 0),
        pages: Array.from(a.pages).slice(0, 6),
        severe: (role !== "figure" && hangul) || chars.length > 20,
      };
    });
}

/** 빠진 글자 한 줄 설명 */
export function glyphMissText(g: GlyphMiss): string {
  return `${FONT_ROLE_LABEL[g.role]} 서체 '${g.label}'에 없는 글자 ${g.distinct}자(${g.count}곳)`;
}

/** 문서 전체 넘침 검사 — 정적 쪽 HTML(루트에 data-studio-key)을 숨은 틀에서 paginate 로 나눠 본다. roleFonts 를 주면 빠진 글자도 찾는다 */
export function runFullCheck(srcDoc: string, timeoutMs = 60000, roleFonts?: Partial<Record<FontRole, RoleFontInfo>>): Promise<FullCheckResult> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "900px", height: "700px", border: "0", visibility: "hidden" });
    let done = false;
    const finish = (r: FullCheckResult) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(limit);
      frame.remove();
      resolve(r);
    };
    const timer = setInterval(() => {
      const doc = frame.contentDocument;
      const state = doc?.documentElement?.getAttribute("data-pk-ready");
      if (!doc || !state) return;
      const res = (frame.contentWindow as unknown as { __pkResult?: { pages: number; warnings: PkWarning[]; error?: string } }).__pkResult;
      if (state === "error" || !res) {
        finish({ pages: 0, byKey: {}, total: 0, error: res?.error ?? "쪽 나누기에 실패했습니다." });
        return;
      }
      const sheets = Array.from(doc.querySelectorAll(".pk-sheet"));
      const byKey: FullCheckResult["byKey"] = {};
      for (const w of res.warnings.filter((x) => x.kind === "overflow" || x.kind === "loop")) {
        const key = sheets[(w.page ?? 1) - 1]?.getAttribute("data-studio-key") ?? "?";
        (byKey[key] ??= []).push({ message: w.message, text: w.text });
      }
      let glyphs: GlyphMiss[] | undefined;
      try {
        glyphs = roleFonts && frame.contentWindow ? findMissingGlyphs(doc, frame.contentWindow, roleFonts) : undefined;
      } catch {
        glyphs = undefined;
      }
      finish({ pages: res.pages, byKey, total: Object.values(byKey).reduce((a, l) => a + l.length, 0), glyphs });
    }, 250);
    const limit = setTimeout(() => finish({ pages: 0, byKey: {}, total: 0, error: "검사 시간이 초과됐습니다." }), timeoutMs);
    frame.srcdoc = srcDoc;
    document.body.appendChild(frame);
  });
}
