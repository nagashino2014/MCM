/**
 * cdash 토큰의 JS 상수판.
 *
 * className 으로 색을 줄 수 있는 곳은 tailwind 의 `cd-*` 유틸(= global.css 의 CSS 변수)을 쓰고,
 * **style prop 이나 라이브러리 옵션으로 색 문자열이 필요한 곳**(expo-router Tabs/Stack 옵션,
 * Ionicons color, StatusBar, RefreshControl, WebView 배경 등)에서만 이 상수를 쓴다.
 *
 * ⚠ 값은 웹 frontend/components/cdash/cdash.css 및 src/global.css 와 **같은 값**을 유지한다.
 */

export interface CdPalette {
  bg: string;
  card: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  primary: string;
  primarySoft: string;
  primaryStrong: string;
  secondary: string;
  secondarySoft: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  gridLine: string;
}

export const LIGHT: CdPalette = {
  bg: "#eef2f8",
  card: "#ffffff",
  surface: "#f2f6fa",
  border: "#e5eaef",
  text: "#2a3547",
  muted: "#5a6a85",
  faint: "#7c8fac",
  primary: "#5d87ff",
  primarySoft: "#ecf2ff",
  primaryStrong: "#4570ea",
  secondary: "#49beff",
  secondarySoft: "#e8f7ff",
  accent: "#fa896b",
  accentSoft: "#fbf2ef",
  accentStrong: "#f3704d",
  success: "#7eba56",
  successSoft: "#eef6e7",
  warning: "#ffae1f",
  warningSoft: "#fef5e5",
  error: "#f3704d",
  errorSoft: "#fdede8",
  gridLine: "#ebf1f6",
};

export const DARK: CdPalette = {
  ...LIGHT,
  bg: "#11161d",
  card: "#171c23",
  surface: "#1d2530",
  border: "#333f55",
  text: "#eaeff4",
  muted: "#8c9bb5",
  faint: "#5a6a85",
  primarySoft: "#253662",
  secondarySoft: "#1c455d",
  accentSoft: "#4b313d",
  successSoft: "#2e3b27",
  warningSoft: "#4d3a2a",
  errorSoft: "#4b313d",
  gridLine: "#232c39",
};

/** "#5d87ff" → "93 135 255" (tailwind 의 `rgb(var(--x) / <alpha-value>)` 가 요구하는 형식). */
function triplet(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** 팔레트 → CSS 변수 맵. nativewind `vars()` 로 루트에 주입해 테마를 런타임 전환한다. */
export function paletteVars(p: CdPalette): Record<string, string> {
  return {
    "--cd-bg": triplet(p.bg),
    "--cd-card": triplet(p.card),
    "--cd-surface": triplet(p.surface),
    "--cd-border": triplet(p.border),
    "--cd-text": triplet(p.text),
    "--cd-muted": triplet(p.muted),
    "--cd-faint": triplet(p.faint),
    "--cd-primary": triplet(p.primary),
    "--cd-primary-soft": triplet(p.primarySoft),
    "--cd-primary-strong": triplet(p.primaryStrong),
    "--cd-secondary": triplet(p.secondary),
    "--cd-secondary-soft": triplet(p.secondarySoft),
    "--cd-accent": triplet(p.accent),
    "--cd-accent-soft": triplet(p.accentSoft),
    "--cd-accent-strong": triplet(p.accentStrong),
    "--cd-success": triplet(p.success),
    "--cd-success-soft": triplet(p.successSoft),
    "--cd-warning": triplet(p.warning),
    "--cd-warning-soft": triplet(p.warningSoft),
    "--cd-error": triplet(p.error),
    "--cd-error-soft": triplet(p.errorSoft),
    "--cd-grid-line": triplet(p.gridLine),
  };
}

/** 타이포 하한(블루프린트 §2-7) — 축소로 밀도를 해결하지 않는다. */
export const TYPO = {
  body: 15,
  meta: 12,
  title: 17,
} as const;

/** 터치 타깃 최소 크기(pt). */
export const HIT = 44;
