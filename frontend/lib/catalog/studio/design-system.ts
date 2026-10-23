/*
 * 스튜디오 자유도의 경계 — 디자인 시스템 토큰 안에서만 고친다(블루프린트 §8-1 '토큰 스타일', §8-2 L3).
 *   색: 토큰 팔레트(var(--토큰))만 · 글자 크기: 타입 스케일 단계만 · 위치·크기: 12열 그리드와 4pt 기준선에 맞춤
 * tokens.json(디자인 시스템 아티팩트 사본)에서 읽는다. 클라이언트 안전.
 */
import tokensJson from "@/lib/catalog/render/tokens.json";

interface TypeStyleRaw {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
  usage?: string;
}
interface TokenRaw {
  name: string;
  value: unknown;
  usage?: string;
}
const T = tokensJson as unknown as {
  color: { themes: Array<{ id: string; name: string }>; tokens: TokenRaw[] };
  type: { groups: Array<{ name: string; styles: TypeStyleRaw[] }> };
  spacing: { tokens: TokenRaw[] };
  radius: { tokens: TokenRaw[] };
  stroke: { tokens: TokenRaw[] };
  ratio?: { tokens: TokenRaw[] };
};

// ── 쪽·그리드 ──
export const PAGE_W = 842;
export const PAGE_H = 595;
export const MARGIN_X = 48;
export const MARGIN_TOP = 28;
export const MARGIN_BOTTOM = 32;
export const CONTENT_W = 746;
export const GUTTER = 24;
export const COLUMNS = 12;
export const COL_W = (CONTENT_W - GUTTER * (COLUMNS - 1)) / COLUMNS; // 40.17
export const COL_STEP = COL_W + GUTTER; // 64.17
export const BASELINE = 4;

/** 그리드 열 시작선(x, 쪽 기준) */
export const columnStarts = (): number[] => Array.from({ length: COLUMNS }, (_, i) => MARGIN_X + i * COL_STEP);
/** n 열 폭 */
export const spanWidth = (n: number): number => n * COL_W + (n - 1) * GUTTER;

/** 왼쪽 가장자리를 가장 가까운 열 시작선에 맞춘다(쪽 기준 x) */
export function snapX(x: number): number {
  let best = MARGIN_X;
  let bestD = Infinity;
  for (const s of columnStarts()) {
    const d = Math.abs(s - x);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  // 쪽 가장자리(0)도 맞춤 대상(표지·뒤표지의 꽉 찬 요소)
  if (Math.abs(x) < bestD) return 0;
  return Math.round(best * 100) / 100;
}

/** 폭을 가장 가까운 열 묶음 폭(1~12열)에 맞춘다. 쪽 전체 폭(842)도 허용 */
export function snapWidth(w: number): { width: number; span: number } {
  let best = { width: spanWidth(1), span: 1 };
  let bestD = Infinity;
  for (let n = 1; n <= COLUMNS; n++) {
    const d = Math.abs(spanWidth(n) - w);
    if (d < bestD) {
      bestD = d;
      best = { width: Math.round(spanWidth(n) * 100) / 100, span: n };
    }
  }
  if (Math.abs(PAGE_W - w) < bestD) return { width: PAGE_W, span: 0 };
  return best;
}

export const snapY = (y: number): number => Math.round(y / BASELINE) * BASELINE;

// ── 타입 스케일 ──
export interface TypeStep {
  name: string;
  group: string;
  label: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
  usage: string;
}

const TYPE_LABEL: Record<string, string> = {
  "display-xl": "표지 제목",
  "display-l": "간지 제목",
  "display-m": "핵심 메시지",
  "page-title": "쪽 제목",
  "section-title": "블록 제목",
  h3: "소제목",
  "display-number": "간지 번호",
  lead: "리드문",
  body: "본문",
  "body-sm": "작은 본문",
  label: "라벨",
  caption: "캡션",
  footnote: "각주",
  table: "표 본문",
  "table-head": "표 머리",
  "kpi-xl": "대표 숫자",
  "kpi-l": "KPI 숫자",
  "kpi-m": "분야 KPI 숫자",
  "figure-s": "작은 수치",
  "table-figure": "표 숫자",
  folio: "쪽 번호",
};

export const TYPE_STEPS: TypeStep[] = T.type.groups.flatMap((g) =>
  g.styles.map((s) => ({
    name: s.name,
    group: g.name,
    label: TYPE_LABEL[s.name] ?? s.name,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    fontWeight: s.fontWeight,
    letterSpacing: s.letterSpacing,
    usage: s.usage ?? "",
  }))
);
const TYPE_BY_NAME = new Map(TYPE_STEPS.map((s) => [s.name, s]));

/** 스튜디오에서 고를 수 있는 단계(간지 번호·쪽 번호 같은 전용 단계는 뺀다) */
export const PICKABLE_TYPE_STEPS = TYPE_STEPS.filter((s) => !["display-number", "folio", "table-figure"].includes(s.name));

export function isTypeStep(v: unknown): v is string {
  return typeof v === "string" && TYPE_BY_NAME.has(v);
}

/** 단계 → 스타일. 숫자 단계는 숫자 서체 */
export function typeStepStyle(name: string): Record<string, string> {
  const s = TYPE_BY_NAME.get(name);
  if (!s) return {};
  const out: Record<string, string> = { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: String(s.fontWeight) };
  out.letterSpacing = s.letterSpacing ?? "0px";
  if (s.group === "숫자") out.fontFamily = "var(--kc-font-figure)";
  else if (s.group.startsWith("표지")) out.fontFamily = "var(--kc-font-display)";
  return out;
}

/** px 글자 크기 → 가장 가까운 단계 이름 */
export function nearestTypeStep(px: number): string {
  let best = "body";
  let bestD = Infinity;
  for (const s of PICKABLE_TYPE_STEPS) {
    const d = Math.abs(parseFloat(s.fontSize) - px);
    if (d < bestD) {
      bestD = d;
      best = s.name;
    }
  }
  return best;
}

// ── 색 토큰 ──
export const COLOR_TOKENS: Array<{ name: string; usage: string }> = T.color.tokens.map((t) => ({ name: t.name, usage: t.usage ?? "" }));
const COLOR_SET = new Set(COLOR_TOKENS.map((t) => t.name));
const OTHER_TOKEN_SET = new Set([...T.spacing.tokens, ...T.radius.tokens, ...T.stroke.tokens, ...(T.ratio?.tokens ?? [])].map((t) => t.name));

/** 스튜디오 색 고르기 팔레트(글자·면) — 지면 의미가 분명한 것만 */
export const TEXT_COLORS = ["ink", "ink-muted", "brand", "accent", "accent-ink", "on-field", "on-brand", "area-1", "area-2", "area-3", "area-4", "area-5", "area-6"];
export const FILL_COLORS = ["paper", "canvas", "panel", "brand-tint", "field", "brand", "accent", "area-1-tint", "area-2-tint", "area-3-tint", "area-4-tint", "area-5-tint", "area-6-tint", "rule"];

export function isColorToken(name: string): boolean {
  return COLOR_SET.has(name);
}

/** var(--토큰) 값인지(색·간격·반경·선·서체 역할) */
export function isTokenVar(v: string, kind: "color" | "any" = "any"): boolean {
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(v.trim());
  if (!m) return false;
  if (COLOR_SET.has(m[1])) return true;
  if (kind === "color") return false;
  return OTHER_TOKEN_SET.has(m[1]) || /^kc-font-(display|body|figure)$/.test(m[1]);
}

// ── 사진 비율 ──
export const PHOTO_RATIOS: Array<{ id: string; label: string; value: string }> = [
  { id: "hero", label: "가로 띠(2.4:1)", value: "2.4" },
  { id: "16x9", label: "16:9", value: "16 / 9" },
  { id: "3x2", label: "3:2", value: "3 / 2" },
  { id: "4x3", label: "4:3", value: "4 / 3" },
  { id: "1x1", label: "1:1", value: "1" },
  { id: "3x4", label: "3:4(세로)", value: "3 / 4" },
];
