// 제안서 디자인 시스템 2.0 — 미리보기 CSS 와 HWPX 조판이 같은 값을 쓴다(한 곳에서만 정의).
// 색: MCM 회사소개서 tokens(navy·steel 계열) + ESG-KESI kesi_report_ds(slate·burgundy·ocean) 를 제안서 세로 지면용으로 정리.
// 원칙(ESG DS 계승): 그라데이션·그림자 없음, 표 세로선 최소화, 장식은 주색 선·옅은 면 두 가지로만.
// 2.1(2026-11-01 사용자 요청): 구조(표 머리·단계 머리·제목·선)는 그래파이트 회색, 옅은 면은 회색 — 테마 주색은 포인트(장 배지·강조·번호)에만.
import type { ProposalDocument, ProposalTheme } from "./types";

export interface ThemePalette {
  label: string;
  /** 짙은 주색 — 제목·머리띠·표 머리칸 */
  primary: string;
  /** 중간 주색 — 단계·막대·보조 강조 */
  primary2: string;
  /** 포인트 색 — 번호·POINT 라벨·일정 보고 칸 */
  accent: string;
  /** 옅은 면 — 핵심 메시지·표 머리(clean) */
  tint: string;
  /** 더 옅은 면 — 카드·단계 본문 */
  tint2: string;
  /** 주색 계열 선 */
  line: string;
  /** 도식·인포그래픽용 다색 6색(항목 순서대로, 순환하지 않고 6개까지) — paletteOf 가 채운다 */
  series?: string[];
}

export const PROPOSAL_THEMES: Record<ProposalTheme, ThemePalette> = {
  navy: { label: "네이비 · 통합허가", primary: "#1F3A68", primary2: "#3A62A7", accent: "#0E9AA7", tint: "#E8EEF7", tint2: "#F4F7FB", line: "#C5D1E4" },
  ocean: { label: "오션 · 발전", primary: "#0B4F7C", primary2: "#1F7AB8", accent: "#E08A1E", tint: "#E3EFF6", tint2: "#F2F8FB", line: "#BFD7E8" },
  slate: { label: "슬레이트 · 정기검사", primary: "#2C3A57", primary2: "#4D6491", accent: "#C0841A", tint: "#E7EAF1", tint2: "#F4F5F8", line: "#CBD2DF" },
  forest: { label: "포레스트 · ESG", primary: "#1D5C45", primary2: "#2E8B63", accent: "#7DB33A", tint: "#E5F1EB", tint2: "#F3F8F5", line: "#C3DBCF" },
  burgundy: { label: "버건디", primary: "#7D1F2C", primary2: "#A63D4B", accent: "#2F6F5E", tint: "#F4E6E8", tint2: "#FAF3F4", line: "#E3C8CC" },
};

/**
 * 도식 다색 팔레트 — 레이아웃(머리띠·표·카드)은 테마 단색, 도식은 항목마다 다른 색으로 변화를 주되 튀지 않게(2026-10-31 사용자 요청).
 * 채도를 OKLCH C≈0.075 로 낮추고 명도를 진·밝으로 번갈아 구분을 확보한 '차분한 6색': 스틸 블루·샌드·더스티 플럼·세이지·더스티 로즈·뮤트 틸.
 * dataviz 검증기(흰 바탕): 명도 띠 통과, 인접 색약 ΔE ≥ 13.8, 정상시 ΔE ≥ 15.8, 대비 ≥ 3:1. 채도 하한(0.1)은 차분함을 위해 의도적으로 밑돈다.
 * 순서 고정, 테마마다 시작 색만 돌린다(네이비·슬레이트=블루, 오션=틸, 포레스트=세이지, 버건디=로즈).
 */
export const SERIES = ["#41668D", "#A78657", "#705783", "#74986C", "#895155", "#4F9B9A"] as const;
/** 흙빛 6색 — 오커·슬레이트·올리브·모브·모스·클레이(C≈0.07, 같은 검증: 색약 ΔE 13.7, 정상시 ΔE 18.9) */
export const SERIES_EARTH = ["#A3885A", "#3F6789", "#8A9260", "#80536C", "#669A7E", "#87534F"] as const;
const SERIES_START: Record<ProposalTheme, number> = { navy: 0, ocean: 5, slate: 0, forest: 3, burgundy: 4 };
export const seriesFor = (theme: ProposalTheme): string[] => { const k = SERIES_START[theme] ?? 0; return [...SERIES.slice(k), ...SERIES.slice(0, k)]; };
export type SeriesPalette = "calm" | "earth" | "mono";
export const SERIES_LABEL: Record<SeriesPalette, string> = { calm: "차분한 6색", earth: "흙빛 6색", mono: "모노톤(회색 + 주색)" };
/** 문서의 도식 팔레트 — 모노톤은 테마 주색과 회색 단계만 쓴다 */
export function seriesOf(theme: ProposalTheme, kind: SeriesPalette | undefined, primary: string): string[] {
  if (kind === "earth") return [...SERIES_EARTH];
  if (kind === "mono") return [primary, "#59616B", mixWhite(primary, 0.4), "#8A9199", mixWhite(primary, 0.62), "#B3B9BF"];
  return seriesFor(theme);
}

/** 무채색 — 테마와 무관 */
export const NEUTRAL = {
  ink: "#1F2328",
  ink2: "#454B53",
  muted: "#737A83",
  rule: "#D9DCE0",
  /** 그래파이트 — 표·단계 머리, 제목 선, 머리말 선, 간지 바탕 */
  graphite: "#3A3F46",
  /** 중간 회색 — 일정 막대(일반 과업)·보조 선 */
  steel: "#8E959D",
  /** 회색 선(표 안쪽 굵은 선·칸 구분) */
  line: "#C4C9CF",
  /** 옅은 회색 면 — 핵심 메시지·표 첫 열·구분 칸 */
  panel: "#F1F2F4",
  /** 더 옅은 회색 면 — 카드·단계 본문 */
  panel2: "#F7F8F9",
  white: "#FFFFFF",
} as const;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** a 를 흰색 쪽으로 t(0~1) 섞는다 */
export const mixWhite = (a: string, t: number) => toHex(hex(a).map((v) => v + (255 - v) * t));
const luminance = (h: string) => {
  const [r, g, b] = hex(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v);

/** 발주처 주색 덮어쓰기(ESG DS tokens.py 방식) — 흰 글자 대비 4.5:1 미만이면 쓰지 않는다. */
export function paletteOf(doc: Pick<ProposalDocument, "theme" | "options">): ThemePalette {
  const theme = PROPOSAL_THEMES[doc.theme] ?? PROPOSAL_THEMES.navy;
  const kind = doc.options?.palette;
  const brand = doc.options?.brandColor;
  if (!isHexColor(brand) || contrast(brand, "#FFFFFF") < 4.5) return { ...theme, series: seriesOf(doc.theme, kind, theme.primary) };
  const primary = brand.toUpperCase();
  return { ...theme, primary, primary2: mixWhite(primary, 0.28), tint: mixWhite(primary, 0.89), tint2: mixWhite(primary, 0.95), line: mixWhite(primary, 0.72), series: seriesOf(doc.theme, kind, primary) };
}

/** 글자 크기(pt) — 원본 4종은 본문 12~14pt 명조였으나 정보 밀도를 위해 10.5pt 고딕으로 정리했다. */
export const TYPE = {
  coverTitle: 26,
  dividerTitle: 24,
  pageTitle: 17.5,
  h1: 15,
  h2: 13,
  h3: 12,
  lead: 12,
  body: 11.5,
  bullet2: 11,
  bullet3: 10.5,
  note: 10,
  table: 10,
  tableTitle: 10.5,
  cardTitle: 11.5,
  cardBody: 10,
  stepTitle: 10.5,
  stepBody: 9.8,
  stage: 11.5,
  callout: 10.5,
  kpi: 22,
  kpiLabel: 9.5,
  gantt: 9,
  caption: 9,
  header: 9,
  footer: 8,
} as const;

/** 세로 간격(pt) — 문단 앞·뒤, 표 칸 여백. 미리보기 CSS 와 HWPX paraPr·cellMargin 이 같은 값을 쓴다. */
export const SPACE = {
  titleAfter: 12, leadAfter: 16,
  h1: [18, 9], h2: [17, 8], h3: [13, 5],
  text: 8, bullet: 5.5, block: 16,
  cellX: 7, cellY: 6, cardPad: 11, stepPad: 8,
} as const;

/** 줄 간격(%) — 2.1 에서 165→175 로 넓혔다(사용자 요청: 항목 간 행간 여유) */
export const LINE = { body: 175, tight: 140, table: 150 } as const;

/** 지면(mm) — A4 세로. 본문 폭 174mm */
export const PAGE = {
  width: 210,
  height: 297,
  left: 18,
  right: 18,
  top: 12,
  header: 9,
  bottom: 10,
  footer: 8,
} as const;
export const BODY_WIDTH_MM = PAGE.width - PAGE.left - PAGE.right;

/** 글꼴 — HWPX 는 기관 PC 공통 글꼴인 맑은 고딕, 미리보기도 같은 글꼴로 맞춘다. */
export const FONT = { hwpx: "맑은 고딕", css: "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',Pretendard,sans-serif" } as const;

/** 개조식 글머리 — 원본의 ❑(제목3) > ❍ > - > · 위계를 따른다. */
export const BULLET = { 1: "○", 2: "-", 3: "·", note: "※", result: "⇒", check: "✓" } as const;
/** 글머리 수준별 왼쪽 여백(pt) — 둘째 줄부터 글이 시작하는 자리 */
export const BULLET_LEFT = { 1: 15, 2: 29, 3: 40 } as const;
/** 글머리 기호 + 띄어쓰기 폭(pt) = 내어쓰기. 미리보기(text-indent)와 HWPX(intent)가 같은 값을 쓴다. */
export const BULLET_HANG: Record<string, number> = { "○": 14, "-": 7, "·": 6.5, "※": 12.5, "⇒": 14, "✓": 12 };
export const BULLET_SIZE = { 1: TYPE.body, 2: TYPE.bullet2, 3: TYPE.bullet3 } as const;

export const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"];

export const PROPOSAL_DESIGN_VERSION = "proposal-2.1";

/** 본문 인라인 강조 — **굵게** 는 주색 굵은 글자. 원본의 '청색 굵은 핵심 구절' 관습을 따른다. */
export interface RichRun { text: string; strong?: boolean }
export function parseRich(text: string): RichRun[] {
  const out: RichRun[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], strong: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: "" }];
}
export const plainRich = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1");

/** 장 목록 — 섹션의 chapter 등장 순서로 Ⅰ·Ⅱ… 번호를 붙인다. */
export function chaptersOf(doc: Pick<ProposalDocument, "sections">): Array<{ name: string; roman: string; first: number }> {
  const out: Array<{ name: string; roman: string; first: number }> = [];
  doc.sections.forEach((s, i) => {
    const name = s.chapter?.trim();
    if (name && !out.some((c) => c.name === name)) out.push({ name, roman: ROMAN[out.length] ?? String(out.length + 1), first: i });
  });
  return out;
}
