/*
 * 회사소개서 일러스트 라이브러리(313) — 보유 스톡 인포그래픽 일러스트의 정보·색·글자 자리·후보 고르기. 클라이언트 안전.
 *
 * 일러스트는 인포그래픽의 '모양' 하나다(블루프린트 §4-5). 내용(InfoContent)은 그대로 두고 그림만 바꾼다.
 *   · 기본 인포그래픽 16종은 항목 수에 맞춰 늘고 줄지만, 일러스트는 그림에 항목 수가 고정돼 있어 항목 수가 같은 자리에만 후보로 뜬다.
 *   · 글자는 그림 위 글자 자리(slots)에 HTML 로 얹는다 → PDF 에서 검색·복사되고, 지표 칩은 계속 최신 값이다.
 *   · 색은 SVG 안 var(--il-cN, #원래색) 변수만 바꿔 KESI 토큰·분야 색으로 칠한다(원래 색 = 변수를 두지 않음).
 */
import { fmt } from "@/lib/catalog/render/components/parts";
import { isInfoType, INFO_TYPE_META, type InfoContent, type InfoItem, type InfoType } from "@/lib/catalog/render/infographic/types";
import { isColorToken } from "@/lib/catalog/studio/design-system";
import tokensJson from "@/lib/catalog/render/tokens.json";
import { resolveColor, type DesignTokens } from "@/lib/print-kit/tokens";

export type IllustSlotRole = "title" | "sub" | "desc" | "number" | "center" | "heading";
export const ILLUST_SLOT_ROLES: Array<{ id: IllustSlotRole; label: string }> = [
  { id: "title", label: "제목" },
  { id: "sub", label: "머리글" },
  { id: "desc", label: "설명" },
  { id: "number", label: "번호·숫자" },
  { id: "center", label: "중심" },
  { id: "heading", label: "큰 제목" },
];

export interface IllustSlot {
  id: string;
  role: IllustSlotRole;
  /** 항목 순번(1부터) — 0 = 항목 밖(중심·큰 제목) */
  item: number;
  /** 그림 대비 비율 상자 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 원래 그림의 줄 수 */
  lines: number;
  /** 글자 크기 = 그림 폭 대비 비율 */
  fs: number;
  /** 줄 간격(글자 크기 배수) */
  lh: number;
  align: "left" | "center" | "right";
  /** 원래 글자 색(#hex) — 팔레트 색이면 재채색을 따라가고, 아니면 밝기로 글자 토큰을 고른다 */
  color?: string;
  /** 글자 자리 아래 도형 색(#hex) — 바꿔 칠한 뒤 대비(4.5:1)가 모자라면 흰 글자·짙은 글자 중 나은 쪽으로 */
  bg?: string;
}

export interface IllustPaletteEntry {
  /** SVG 변수 이름 — var(--il-{v}) */
  v: string;
  hex: string;
  /** 쓰임 비중(0~1) */
  use: number;
  /** 밝기(0~1) */
  l: number;
  /** 유채색 무리 순위(쓰임 순, 0부터) */
  group?: number;
  /** 무리 안 밝기 차(-1~1) */
  shade?: number;
  neutral?: boolean;
}

export interface IllustLicense {
  provider: string;
  stockId?: string;
  license?: string;
  url?: string;
  file?: string;
  purchasedAt?: string;
  note?: string;
}

export interface IllustFit {
  item: string;
  page: string;
  title?: string;
  score?: number;
  fit?: string;
}

export interface IllustrationInfo {
  assetId: string;
  sourceKey: string;
  title: string;
  type: InfoType;
  altTypes: InfoType[];
  count: number;
  center: boolean;
  loop: boolean;
  quality: number | null;
  note: string;
  view: [number, number];
  slots: IllustSlot[];
  palette: IllustPaletteEntry[];
  license: IllustLicense;
  fits: IllustFit[];
  status: "active" | "archived";
  svgBytes: number | null;
  updatedAt: string;
}

/** 그릴 때 필요한 것(정보 + 정리한 SVG 본문) */
export interface IllustrationRender {
  info: IllustrationInfo;
  /** 정리한 SVG 마크업(id 는 자산마다 접두사가 붙어 있다) */
  svg: string;
}

/** 편집층·문서 상태(JSON) 안에서 일러스트 자산 id 를 모은다 */
export function illustIdsIn(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return [...new Set(text.match(/cil_[a-f0-9]{16}/g) ?? [])];
}

// ───────────────────────── 정리 ─────────────────────────

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export function sanitizeSlots(input: unknown): IllustSlot[] {
  if (!Array.isArray(input)) return [];
  const out: IllustSlot[] = [];
  for (const raw of input.slice(0, 80)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const role = ILLUST_SLOT_ROLES.some((r) => r.id === o.role) ? (o.role as IllustSlotRole) : "desc";
    const x = num(o.x, -0.2, 1.2);
    const y = num(o.y, -0.2, 1.2);
    const w = num(o.w, 0.001, 1.4);
    const h = num(o.h, 0.001, 1.4);
    if (x == null || y == null || w == null || h == null) continue;
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    out.push({
      id: typeof o.id === "string" && /^[a-z0-9]{1,8}$/.test(o.id) && !out.some((s) => s.id === o.id) ? o.id : `s${out.length + 1}`,
      role,
      item: role === "center" || role === "heading" ? 0 : Math.round(num(o.item, 0, 30) ?? 0),
      x: r4(x),
      y: r4(y),
      w: r4(w),
      h: r4(h),
      lines: Math.round(num(o.lines, 1, 12) ?? 1),
      fs: Math.round((num(o.fs, 0.001, 0.2) ?? 0.015) * 100000) / 100000,
      lh: Math.round((num(o.lh, 0.9, 2.4) ?? 1.3) * 100) / 100,
      align: o.align === "center" || o.align === "right" ? o.align : "left",
      ...(typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color) ? { color: o.color.toLowerCase() } : {}),
      ...(typeof o.bg === "string" && /^#[0-9a-f]{6}$/i.test(o.bg) ? { bg: o.bg.toLowerCase() } : {}),
    });
  }
  return out;
}

export function sanitizePalette(input: unknown): IllustPaletteEntry[] {
  if (!Array.isArray(input)) return [];
  const out: IllustPaletteEntry[] = [];
  for (const raw of input.slice(0, 400)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.v !== "string" || !/^c\d{1,3}$/.test(o.v) || typeof o.hex !== "string" || !/^#[0-9a-f]{6}$/i.test(o.hex) || "alias" in o) continue;
    const e: IllustPaletteEntry = { v: o.v, hex: o.hex.toLowerCase(), use: num(o.use, 0, 1) ?? 0, l: num(o.l, 0, 1) ?? 0.5 };
    const g = num(o.group, 0, 99);
    if (g != null && !o.neutral) {
      e.group = Math.round(g);
      e.shade = num(o.shade, -1, 1) ?? 0;
    } else e.neutral = true;
    out.push(e);
  }
  return out;
}

export function sanitizeLicense(input: unknown): IllustLicense {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const url = str(o.url, 300);
  return {
    provider: str(o.provider, 60) || "보유 파일",
    stockId: str(o.stockId, 40),
    license: str(o.license, 60),
    url: /^https:\/\/[^\s"'<>]+$/.test(url) ? url : "",
    file: str(o.file, 200),
    purchasedAt: /^\d{4}-\d{2}-\d{2}$/.test(str(o.purchasedAt, 10)) ? str(o.purchasedAt, 10) : "",
    note: str(o.note, 300),
  };
}

export function sanitizeFits(input: unknown): IllustFit[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 12)
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({ item: str(f.item, 40), page: str(f.page, 20), title: str(f.title, 60), score: num(f.score, 0, 2) ?? undefined, fit: str(f.fit, 4) }))
    .filter((f) => f.item && f.page);
}

/** 매처 meta.json·관리 화면 수정값 → 정리된 정보(자산 id·상태는 따로) */
export function sanitizeIllustrationMeta(input: unknown): Omit<IllustrationInfo, "assetId" | "status" | "svgBytes" | "updatedAt" | "sourceKey"> & { sourceKey: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type: InfoType = isInfoType(o.type) ? o.type : "process";
  const view = Array.isArray(o.view) ? o.view : [];
  const vw = num(view[0], 0.1, 100000) ?? 100;
  const vh = num(view[1], 0.1, 100000) ?? 100;
  const slots = sanitizeSlots(o.slots);
  const maxItem = slots.reduce((m, s) => Math.max(m, s.item), 0);
  return {
    sourceKey: str(o.key ?? o.sourceKey, 120),
    title: str(o.title, 80) || "이름 없는 일러스트",
    type,
    altTypes: (Array.isArray(o.alt) ? o.alt : Array.isArray(o.altTypes) ? o.altTypes : []).filter(isInfoType).slice(0, 6),
    count: Math.round(num(o.count, 1, 30) ?? (maxItem || 1)),
    center: o.center === true,
    loop: o.loop === true,
    quality: num(o.quality, 1, 5),
    note: str(o.note, 300),
    view: [vw, vh],
    slots,
    palette: sanitizePalette(o.palette),
    license: sanitizeLicense(o.license),
    fits: sanitizeFits(o.fits),
  };
}

// ───────────────────────── 색 ─────────────────────────

export type IllustColorMode = "area" | "areas" | "brand" | "mono" | "original";
export const ILLUST_COLOR_MODES: Array<{ id: IllustColorMode; label: string }> = [
  { id: "area", label: "이 쪽 분야 색" },
  { id: "areas", label: "분야 6색" },
  { id: "brand", label: "브랜드 색" },
  { id: "mono", label: "단색" },
  { id: "original", label: "원래 색" },
];

export interface IllustColors {
  mode: IllustColorMode;
  /** 무리(group 순번 문자열) → 색 토큰 이름 — 무리마다 직접 고른 색 */
  map?: Record<string, string>;
}

export function sanitizeIllustColors(input: unknown): IllustColors {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = ILLUST_COLOR_MODES.some((m) => m.id === o.mode) ? (o.mode as IllustColorMode) : "area";
  const out: IllustColors = { mode };
  if (o.map && typeof o.map === "object") {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.map as Record<string, unknown>).slice(0, 12)) {
      if (/^\d{1,2}$/.test(k) && typeof v === "string" && isColorToken(v)) map[k] = v;
    }
    if (Object.keys(map).length) out.map = map;
  }
  return out;
}

const SEQ: Record<Exclude<IllustColorMode, "original">, string[]> = {
  area: ["var(--area-mid)", "var(--area)", "color-mix(in srgb, var(--area-mid) 55%, white)", "color-mix(in srgb, var(--area) 70%, black)"],
  areas: [1, 2, 3, 4, 5, 6].map((i) => `var(--area-${i}-mid)`),
  brand: ["var(--brand)", "var(--accent-2)", "var(--accent)", "var(--ci-gray)", "var(--area-6-mid)", "var(--area-3-mid)"],
  mono: ["var(--brand)", "color-mix(in srgb, var(--brand) 70%, white)", "color-mix(in srgb, var(--brand) 45%, white)", "color-mix(in srgb, var(--brand) 25%, white)"],
};

/** 무리 순번 → 바탕 색(모드 순서표, 넘치면 되풀이) */
export function groupBase(colors: IllustColors, g: number): string | null {
  const own = colors.map?.[String(g)];
  if (own) return `var(--${own})`;
  if (colors.mode === "original") return null;
  const seq = SEQ[colors.mode];
  return seq[g % seq.length];
}

/** 일러스트에 쓰인 유채색 무리 수 */
export function groupCount(palette: IllustPaletteEntry[]): number {
  return palette.reduce((m, p) => (p.group != null ? Math.max(m, p.group + 1) : m), 0);
}

/** 색 변수 값 — style 에 그대로 넣는다(--il-cN: …). 원래 색 모드에서 직접 고른 무리가 없으면 빈 객체 */
export function illustColorVars(palette: IllustPaletteEntry[], colors: IllustColors): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of palette) {
    if (p.group != null) {
      const base = groupBase(colors, p.group);
      if (!base) continue;
      const sh = p.shade ?? 0;
      out[`--il-${p.v}`] =
        sh > 0.05
          ? `color-mix(in srgb, ${base} ${Math.round(100 - Math.min(0.75, sh * 0.7) * 100)}%, white)`
          : sh < -0.05
            ? `color-mix(in srgb, ${base} ${Math.round(100 - Math.min(0.5, -sh * 0.5) * 100)}%, black)`
            : base;
    } else if (colors.mode !== "original") {
      // 무채색: 흰색은 그대로, 나머지는 글자·회색 토큰 단계
      if (p.l >= 0.93) continue;
      out[`--il-${p.v}`] = p.l <= 0.22 ? "var(--ink)" : p.l < 0.55 ? "var(--ink-muted)" : p.l < 0.82 ? "var(--chart-past)" : "var(--rule)";
    }
  }
  return out;
}

const TEXT_SEQ: Record<Exclude<IllustColorMode, "original">, string[]> = {
  area: ["var(--area)"],
  areas: [1, 2, 3, 4, 5, 6].map((i) => `var(--area-${i})`),
  brand: ["var(--brand)", "var(--area-1)", "var(--accent-ink)", "var(--ink-muted)", "var(--area-6)", "var(--area-3)"],
  mono: ["var(--brand)"],
};

function hexL(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

// ── 대비 — 토큰 색을 실제 값으로 풀어(기본 navy 컨셉) 글자와 그 아래 도형의 대비를 잰다 ──
const TOKENS = (tokensJson as unknown as DesignTokens).color.tokens;

function tokenHex(name: string): string | null {
  try {
    const v = resolveColor(TOKENS, name, "navy", "navy");
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (c: number[]) => "#" + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");

/** 색 값(var(--토큰) · color-mix(in srgb, var(--토큰) P%, white|black) · #hex) → #hex. area = 쪽 분야 번호(없으면 기본 --area = 브랜드) */
export function cssColorHex(css: string, area?: number): string | null {
  const v = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const alias = (name: string) =>
    name === "area" ? (area ? `area-${area}` : "brand") : name === "area-mid" ? (area ? `area-${area}-mid` : "accent-2") : name === "area-tint" ? (area ? `area-${area}-tint` : "brand-tint") : name;
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (m) return tokenHex(alias(m[1]));
  const mix = /^color-mix\(in srgb, (.+) (\d+)%, (white|black)\)$/.exec(v);
  if (mix) {
    const base = cssColorHex(mix[1], area);
    if (!base) return null;
    const p = Number(mix[2]) / 100;
    const to = mix[3] === "white" ? 255 : 0;
    return hexOf(rgbOf(base).map((c) => c * p + to * (1 - p)));
  }
  return null;
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 글자 자리 색 — 유채색 글자는 그 무리의 글자용 색(4.5:1 키 색), 무채색은 밝기로 ink·ink-muted·흰 글자.
 *  자리 아래에 칠한 도형이 있으면(bg) 바꿔 칠한 색과 대비를 재서 모자라면 흰 글자·짙은 글자 중 대비가 큰 쪽으로 바꾼다. */
export function slotTextColor(slot: IllustSlot, palette: IllustPaletteEntry[], colors: IllustColors, area?: number): string {
  const base = baseTextColor(slot, palette, colors);
  const bgHex = slotBgHex(slot, palette, colors, area);
  if (!bgHex) return base;
  const fg = cssColorHex(base, area);
  if (!bgHex || !fg || contrastRatio(fg, bgHex) >= 4.5) return base;
  const white = tokenHex("on-area") ?? "#ffffff";
  const ink = tokenHex("ink") ?? "#141a23";
  return contrastRatio(white, bgHex) >= contrastRatio(ink, bgHex) ? "var(--on-area)" : "var(--ink)";
}

/** 글자 자리 아래 도형을 바꿔 칠한 색(#hex) — 모르면 null. 캔버스 대비 검사의 바탕(data-ill-bg)으로도 쓴다 */
export function slotBgHex(slot: IllustSlot, palette: IllustPaletteEntry[], colors: IllustColors, area?: number): string | null {
  if (!slot.bg) return null;
  const bp = palette.find((e) => e.hex === slot.bg);
  const fill = bp ? (illustColorVars([bp], colors)[`--il-${bp.v}`] ?? slot.bg) : slot.bg;
  return cssColorHex(fill, area);
}

function baseTextColor(slot: IllustSlot, palette: IllustPaletteEntry[], colors: IllustColors): string {
  const hex = slot.color;
  if (!hex) return "var(--ink)";
  const p = palette.find((e) => e.hex === hex);
  if (p?.group != null) {
    const own = colors.map?.[String(p.group)];
    if (own) return `var(--${own.replace(/-(mid|tint)$/, "")})`;
    if (colors.mode === "original") return hex;
    const seq = TEXT_SEQ[colors.mode];
    return seq[p.group % seq.length];
  }
  const l = p?.l ?? hexL(hex);
  if (colors.mode === "original") return hex;
  if (l >= 0.85) return "var(--on-area)";
  return l <= 0.3 ? "var(--ink)" : "var(--ink-muted)";
}

// ───────────────────────── 글자 자리 ─────────────────────────

export interface SlotText {
  slot: IllustSlot;
  text: string;
  /** 숫자 자리의 지표 바인딩 */
  metric?: string;
  /** 자리에 들어갈 대략 글자 수(넘침 판정, 한글 기준) */
  capacity: number;
  /** 넘침 — 글자별 폭(한글·영문·숫자·공백)으로 잰 글이 자리 줄 수를 넘는지 */
  overflow: boolean;
}

/** 자리 글자 수 용량 — 한 줄 폭 ÷ 글자 폭(한글 ≈ 0.95em) × 줄 수(설명은 1줄 여유) */
/** 역할별 최소 글자 크기(pt) — 스톡 그림을 쪽 폭으로 줄이면 설명 글자가 5pt 안팎이 되므로 가독 하한을 둔다 */
export const ILLUST_MIN_PT: Record<IllustSlotRole, number> = { title: 8, sub: 7, desc: 7, number: 9, center: 9, heading: 12 };
/** 역할별 최소 자리 폭(글자 크기 배수) — 원래 그림의 자리 표시가 짧아도(01·영문 두 글자) 한글이 들어갈 폭 */
export const ILLUST_MIN_CHARS: Record<IllustSlotRole, number> = { title: 4, sub: 4, desc: 6, number: 2.6, center: 5, heading: 6 };

/** 자리 글자 수 용량 — 그린 그림 폭(pt)에서 실제 글자 크기(최소 크기 적용)·자리 폭(최소 폭 적용)으로 한 줄 글자 수(한글 ≈ 0.95em) × 줄 수(설명은 1줄 여유) */
export function slotCapacity(s: IllustSlot, widthPt = 400): number {
  const font = Math.max(ILLUST_MIN_PT[s.role], s.fs * widthPt);
  const slotW = Math.max(s.w * widthPt, font * ILLUST_MIN_CHARS[s.role]);
  const perLine = Math.max(1, Math.floor(slotW / (font * 0.95)));
  return perLine * (s.role === "desc" ? s.lines + 1 : s.lines);
}

/** 글 폭(em) 근사 — 프리텐다드 기준 한글 0.92, 영문 대문자 0.66, 소문자·숫자 0.56, 공백 0.27, 문장부호 0.35 */
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f) || (c >= 0x4e00 && c <= 0x9fff)) w += 0.92;
    else if (ch === " ") w += 0.27;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else if (/[a-z0-9]/.test(ch)) w += 0.56;
    else if (/[.,·:;'"()\-/%]/.test(ch)) w += 0.35;
    else w += 0.8;
  }
  return w;
}

/** 이 글이 자리에 넘치는지 — 낱말 단위 줄바꿈 여유(0.9)를 두고 줄 수와 비교 */
export function slotOverflows(s: IllustSlot, text: string, widthPt = 400): boolean {
  if (!text) return false;
  const font = Math.max(ILLUST_MIN_PT[s.role], s.fs * widthPt);
  const slotW = Math.max(s.w * widthPt, font * ILLUST_MIN_CHARS[s.role]);
  const lines = s.role === "desc" ? s.lines + 1 : s.lines;
  const explicit = text.split("\n");
  if (explicit.length > lines) return true;
  const need = explicit.reduce((n, ln) => n + Math.max(1, Math.ceil((textWidthEm(ln) * font) / (slotW * 0.9))), 0);
  return need > lines;
}

function numberText(it: InfoItem | undefined, i: number, unit?: string): string {
  if (!it) return String(i).padStart(2, "0");
  if (it.valueText) return it.valueText;
  if (it.value != null) return `${fmt(it.value)}${it.unit ?? unit ?? ""}`;
  if (it.when) return it.when;
  return String(i).padStart(2, "0");
}

/** 내용(InfoContent) → 자리별 글자. 항목은 자리의 item 순번으로 짝짓는다. */
export function illustSlotTexts(info: Pick<IllustrationInfo, "slots">, content: InfoContent, widthPt?: number): SlotText[] {
  return info.slots.map((slot) => {
    const it = slot.item > 0 ? content.items[slot.item - 1] : undefined;
    let text = "";
    let metric: string | undefined;
    if (slot.role === "title") text = it?.label ?? "";
    else if (slot.role === "sub") text = it?.sub ?? it?.when ?? "";
    else if (slot.role === "desc") text = it?.desc ?? "";
    else if (slot.role === "number") {
      text = numberText(it, slot.item, content.unit);
      if (it?.metric) metric = it.metric;
    } else if (slot.role === "center") text = [content.center?.label ?? content.title ?? "", content.center?.desc ?? ""].filter(Boolean).join("\n");
    else if (slot.role === "heading") text = content.title ?? "";
    return { slot, text, metric, capacity: slotCapacity(slot, widthPt), overflow: slotOverflows(slot, text, widthPt) };
  });
}

// ───────────────────────── 후보 ─────────────────────────

export interface IllustCandidate {
  info: IllustrationInfo;
  score: number;
  reasons: string[];
  /** 글자 수가 자리 용량을 넘는 자리 수 */
  overflow: number;
}

/** 소개서 쪽 유형(C08 등)과 매처 적합도의 쪽 표기(C08·C09 플랫폼)가 맞는지 */
export function fitsPage(info: IllustrationInfo, pageType: string | undefined): IllustFit | null {
  if (!pageType) return null;
  return info.fits.find((f) => f.page.toUpperCase().startsWith(pageType.toUpperCase())) ?? null;
}

/**
 * 이 내용에 쓸 수 있는 일러스트 — 항목 수가 같아야 한다(그림의 항목 수는 고정).
 * 점수: 같은 유형 > 대체 유형, 쪽 적합도, 품질, 글자 넘침 감점. 수치형 내용은 숫자 자리가 항목 수만큼 있어야 한다.
 */
export function illustCandidates(list: IllustrationInfo[], content: InfoContent, ctx: { type: InfoType; pageType?: string; box?: { w: number; h: number } }): IllustCandidate[] {
  const n = content.items.length;
  const numeric = n > 0 && content.items.every((it) => it.value != null || it.metric);
  const out: IllustCandidate[] = [];
  for (const info of list) {
    if (info.status !== "active" || info.count !== n || !info.slots.length) continue;
    const numberSlots = new Set(info.slots.filter((s) => s.role === "number" && s.item > 0).map((s) => s.item)).size;
    if (numeric && numberSlots < n) continue;
    const reasons = [`항목 수 ${n} = 그림 ${info.count}`];
    let score = 40;
    if (info.type === ctx.type) {
      score += 30;
      reasons.push(`같은 유형(${INFO_TYPE_META[info.type].label})`);
    } else if (info.altTypes.includes(ctx.type)) {
      score += 15;
      reasons.push(`대체 유형(${INFO_TYPE_META[info.type].label} → ${INFO_TYPE_META[ctx.type].label})`);
    } else reasons.push(`그림 유형 ${INFO_TYPE_META[info.type].label}`);
    const fit = fitsPage(info, ctx.pageType);
    if (fit) {
      score += fit.fit === "상" ? 20 : fit.fit === "중" ? 10 : 4;
      reasons.push(`${fit.page} 추천 ${fit.fit ?? ""}`.trim());
    }
    if (info.quality) score += info.quality * 2;
    if (info.center && !(content.center?.label || content.title)) {
      score -= 8;
      reasons.push("중심 자리가 비어요");
    }
    const widthPt = ctx.box ? (ctx.box.h > 0 ? Math.min(ctx.box.w, ctx.box.h * (info.view[0] / info.view[1])) : ctx.box.w) : 400;
    const overflow = illustSlotTexts(info, content, widthPt).filter((t) => t.overflow).length;
    if (overflow) {
      score -= overflow * 4;
      reasons.push(`글자 넘침 ${overflow}자리`);
    }
    out.push({ info, score, reasons, overflow });
  }
  return out.sort((a, b) => b.score - a.score || a.info.title.localeCompare(b.info.title, "ko"));
}

/** 새로 넣는 일러스트의 빈 내용 — 자리 역할에 맞춘 자리 표시 글 */
export function placeholderContent(info: IllustrationInfo): InfoContent {
  const items: InfoItem[] = Array.from({ length: info.count }, (_, i) => {
    const has = (role: IllustSlotRole) => info.slots.some((s) => s.item === i + 1 && s.role === role);
    const it: InfoItem = { id: `i${i + 1}`, label: `항목 ${i + 1}` };
    if (has("desc")) it.desc = "설명을 입력합니다";
    if (has("sub")) it.sub = `0${i + 1}`.slice(-2);
    return it;
  });
  const c: InfoContent = { items };
  if (info.slots.some((s) => s.role === "center" || s.role === "heading")) c.title = "제목";
  if (info.center) c.center = { label: "중심" };
  return c;
}

/** 캔버스에서 고친 글자 자리 글 → 내용(InfoContent) 갱신. 바뀐 것이 없으면 null */
export function applySlotText(content: InfoContent, role: IllustSlotRole, item: number, text: string): InfoContent | null {
  const t = text.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
  if (role === "heading") return t === (content.title ?? "") ? null : { ...content, title: t };
  if (role === "center") {
    const [label, ...rest] = t.split("\n");
    const desc = rest.join(" ").trim();
    const cur = content.center;
    if ((cur?.label ?? content.title ?? "") === label && (cur?.desc ?? "") === desc) return null;
    return { ...content, center: { label, ...(desc ? { desc } : {}) } };
  }
  const i = item - 1;
  const it = content.items[i];
  if (!it) return null;
  const one = t.replace(/\n+/g, " ");
  const patch: Partial<InfoItem> =
    role === "title" ? { label: one } : role === "sub" ? { sub: one } : role === "desc" ? { desc: t.replace(/\n+/g, " ") } : role === "number" && !it.metric ? { valueText: one } : {};
  const key = Object.keys(patch)[0] as keyof InfoItem | undefined;
  if (!key || (it[key] ?? "") === patch[key]) return null;
  return { ...content, items: content.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) };
}
