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
  /** 카드·박스 경계선. 웹의 --cd-ring 과 같은 역할(배경과 구분되는 실제 테두리). */
  border: string;
  text: string;
  /** 본문 글자색(제목=text 보다 한 단계 옅음). */
  body: string;
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

/**
 * Soft Glass Ink 팔레트 — 웹 cdash.css 와 같은 색.
 * 다만 웹의 글라스(반투명 + backdrop blur)는 RN 에 없고, tailwind 색 토큰이
 * "R G B" 트리플릿이라 알파를 담을 수 없다 → **불투명 근사값**으로 옮긴다.
 *   card = 흰색, surface·soft 류 = 해당 알파를 배경 위에 합성한 결과값.
 */
export const LIGHT: CdPalette = {
  bg: "#eff1f8",
  card: "#ffffff",
  surface: "#f7f8fc",
  border: "#d7dcea",
  text: "#2a3040",
  body: "#3a4055",
  muted: "#7b839c",
  faint: "#9aa1b8",
  primary: "#4a63d8",
  primarySoft: "#eceffd",
  primaryStrong: "#3d53c2",
  secondary: "#3d8fc4",
  secondarySoft: "#e9f5fc",
  // accent 는 폐기 토큰 — 웹과 동일하게 error 로 통합한다(신규 사용 금지).
  accent: "#d05743",
  accentSoft: "#fcebe8",
  accentStrong: "#d05743",
  success: "#2e8c71",
  successSoft: "#e4f4f0",
  warning: "#b57f1d",
  warningSoft: "#fbf1e0",
  error: "#d05743",
  errorSoft: "#fcebe8",
  gridLine: "#e7ebf4",
};

export const DARK: CdPalette = {
  ...LIGHT,
  bg: "#141824",
  card: "#1b2136",
  surface: "#262c40",
  border: "#303548",
  text: "#e7eaf4",
  body: "#c6cde0",
  muted: "#9aa3bc",
  faint: "#6e7a96",
  primary: "#a9b8ff",
  primarySoft: "#2e3656",
  primaryStrong: "#8fa5ff",
  secondary: "#7ec8f0",
  secondarySoft: "#293850",
  accent: "#f09a8b",
  accentSoft: "#3d3444",
  accentStrong: "#f09a8b",
  success: "#5fc7a5",
  successSoft: "#253846",
  warning: "#ebc06a",
  warningSoft: "#3c3a3e",
  error: "#f09a8b",
  errorSoft: "#3d3444",
  gridLine: "#303548",
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
    "--cd-body": triplet(p.body),
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
