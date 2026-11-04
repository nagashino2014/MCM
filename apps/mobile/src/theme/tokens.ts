/**
 * KESI Frosted 디자인 시스템(2026-10-28 shadcn 결정판) 토큰의 JS 상수판 — 모바일 이식(2026-11-03).
 *
 * className 으로 색을 줄 수 있는 곳은 tailwind 의 `cd-*` 유틸(= global.css 의 CSS 변수)을 쓰고,
 * **style prop 이나 라이브러리 옵션으로 색 문자열이 필요한 곳**(expo-router Tabs/Stack 옵션,
 * Ionicons color, StatusBar, RefreshControl, WebView 배경 등)에서만 이 상수를 쓴다.
 *
 * ⚠ 값은 Claude 앱 「KESI Frosted 디자인 시스템」 tokens.json(정본 = 웹 components/cdash/precision-tokens.css)과
 *   같은 값을 유지한다. 이름은 기존 모바일 팔레트 키(bg·card·surface·text·muted…)를 그대로 두고 값만 Frosted 로 옮겼다 —
 *   화면 300여 곳의 className 을 바꾸지 않기 위해서다. 대응: bg=canvas · card=surface · surface=surface-sunken ·
 *   text/body=ink · muted=ink-muted · border=border · borderStrong=border-strong · cardBorder=card-border.
 */

export interface CdPalette {
  /** 화면 바탕(canvas) — 라이트는 베이지 단색(모바일·로그인은 그라데이션·빛 점 없음). */
  bg: string;
  /** 카드·표·입력·시트의 불투명 흰 면(surface). */
  card: string;
  /** 카드 안 보조 영역·눌림·스켈레톤·중립 배지(surface-sunken). */
  surface: string;
  /** 구분선(hairline)·고스트 버튼 테두리. */
  border: string;
  /** 입력 필드 테두리 — 카드보다 한 단계 진해 "채울 수 있는 곳"으로 읽힌다. */
  borderStrong: string;
  /** 카드·세그먼트 탭 묶음의 바깥 테두리 — border 보다 옅고 그림자와 함께 가장자리만 잡는다. */
  cardBorder: string;
  /** 본문·제목 글자(ink). */
  text: string;
  /** 본문 글자 — Frosted 는 ink 하나라 text 와 같은 값(호환 키). */
  body: string;
  /** 레이블·메타·보조 설명(ink-muted). 11px 메타도 이 색까지만. */
  muted: string;
  /** 호환 키 — ink-muted 보다 한 단계 옅은 보조색(아이콘·구분점). 글자는 muted 를 우선 쓴다. */
  faint: string;
  primary: string;
  /** 선택 상태 바탕·정보 필 바탕. 글자는 primaryStrong. */
  primarySoft: string;
  /** primarySoft 위에 올리는 글자(선택 항목 강조). */
  primaryStrong: string;
  /** 주 버튼 채움(남색 단색) + 한 단계 어두운 1px 테두리. 그라데이션 없음. */
  primaryFill: string;
  primaryFillEdge: string;
  /** 세그먼트 탭 선택 바탕(남색 틴트)·글자. */
  tabSelected: string;
  tabSelectedInk: string;
  secondary: string;
  secondarySoft: string;
  /** 폐기 토큰 — error 와 같은 값(신규 사용 금지). */
  accent: string;
  accentSoft: string;
  accentStrong: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  /** 표·그리드 보조선 — border 보다 옅다(정렬용). */
  gridLine: string;
  /** primary/error 채움 위 글자색. */
  onPrimary: string;
  onError: string;
  /** 시트·모달 뒤 어둡게 하는 막(blur 없음). */
  overlay: string;
  /** 색 점 없는 필터 필의 선택 바탕 — 옅은 회색(남색 틴트는 그라데이션 바탕과 구분되지 않아 2026-11-04 사용자 결정). 글자는 text 600. */
  pillSelected: string;
}

/**
 * 모바일 셸 바탕(2026-11-04 사용자 결정) — 베이지 단색 대신 웹 셸과 같은 그라데이션을 **더 연하게** + 흐린 빛 두 점.
 * ThemeProvider 루트의 ShellBackground 가 한 번만 그리고, 화면 루트는 투명이다. 다크는 단색 bg.
 */
export const SHELL = {
  from: "#f8f9fc",
  mid: "#f4f6fb",
  to: "#f9f7f3",
  glowCool: "#c9d4ff",
  glowWarm: "#f3d9c4",
} as const;

export const LIGHT: CdPalette = {
  // 셸 그라데이션(SHELL)의 중간색 — 그라데이션 위에 놓이는 sticky 헤더 등 불투명 바탕이 필요한 곳만 쓴다.
  bg: "#f4f6fb",
  card: "#ffffff",
  surface: "#f6f7f9",
  border: "#e2e4e9",
  borderStrong: "#d1d4dc",
  cardBorder: "#e8e9ee",
  text: "#21232c",
  body: "#21232c",
  muted: "#646a78",
  faint: "#7a8090",
  primary: "#4a63d8",
  primarySoft: "#eef1fb",
  primaryStrong: "#1a47a8",
  primaryFill: "#4a63d8",
  primaryFillEdge: "#3d55c8",
  tabSelected: "#eef1fb",
  tabSelectedInk: "#2f41a8",
  secondary: "#3d8fc4",
  secondarySoft: "#e9f5fc",
  accent: "#b92727",
  accentSoft: "#faf0f0",
  accentStrong: "#b92727",
  success: "#1c784f",
  successSoft: "#edf4f1",
  warning: "#9a5609",
  warningSoft: "#f6f0e9",
  error: "#b92727",
  errorSoft: "#faf0f0",
  gridLine: "#eceef2",
  onPrimary: "#ffffff",
  onError: "#ffffff",
  // 시스템 overlay(24%)보다 진하게 — 뒤 화면이 비쳐 불편하다는 사용자 피드백(2026-08-09) 유지.
  overlay: "#131720b3",
  pillSelected: "#e6e8ee",
};

export const DARK: CdPalette = {
  ...LIGHT,
  bg: "#141520",
  card: "#1a1d23",
  surface: "#24262e",
  border: "#343742",
  borderStrong: "#484d5b",
  cardBorder: "#343742",
  text: "#e7e9ee",
  body: "#e7e9ee",
  muted: "#a1a8b5",
  faint: "#8a91a0",
  primary: "#a9b8ff",
  primarySoft: "#1f2b47",
  primaryStrong: "#97bcfc",
  primaryFill: "#5269dc",
  primaryFillEdge: "#4a5fd0",
  tabSelected: "#1f2b47",
  tabSelectedInk: "#97bcfc",
  secondary: "#7ec8f0",
  secondarySoft: "#24405a",
  accent: "#f68484",
  accentSoft: "#29242a",
  accentStrong: "#f68484",
  success: "#71d6a8",
  successSoft: "#212c2e",
  warning: "#f3be62",
  warningSoft: "#2d2b29",
  error: "#f68484",
  errorSoft: "#29242a",
  gridLine: "#2b2e38",
  onPrimary: "#111522",
  onError: "#111522",
  overlay: "#000000b3",
  pillSelected: "#30333e",
};

/**
 * 카드 1단 그림자(shadow-card) — 바탕 위에 놓인 첫 겹에만. 카드 안 카드·시트 안 카드는 그림자 없음.
 * RN 은 CSS 다중 그림자를 못 쓰므로 가장 넓은 한 겹으로 근사한다(iOS shadow*, Android elevation).
 */
export const SHADOW_CARD = {
  light: { shadowColor: "#1d2435", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  dark: { shadowColor: "#000000", shadowOpacity: 0.24, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
} as const;

/** 떠 있는 것의 그림자(shadow-popover) — 토스트·팝오버. */
export const SHADOW_POPOVER = {
  light: { shadowColor: "#1d2435", shadowOpacity: 0.13, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  dark: { shadowColor: "#000000", shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
} as const;

/** "#5d87ff" → "93 135 255" (tailwind 의 `rgb(var(--x) / <alpha-value>)` 가 요구하는 형식). 알파 hex 는 버린다. */
function triplet(hex: string): string {
  const h = hex.replace("#", "").slice(0, 6);
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
    "--cd-border-strong": triplet(p.borderStrong),
    "--cd-card-border": triplet(p.cardBorder),
    "--cd-text": triplet(p.text),
    "--cd-body": triplet(p.body),
    "--cd-muted": triplet(p.muted),
    "--cd-faint": triplet(p.faint),
    "--cd-primary": triplet(p.primary),
    "--cd-primary-soft": triplet(p.primarySoft),
    "--cd-primary-strong": triplet(p.primaryStrong),
    "--cd-primary-fill": triplet(p.primaryFill),
    "--cd-primary-fill-edge": triplet(p.primaryFillEdge),
    "--cd-tab-selected": triplet(p.tabSelected),
    "--cd-tab-selected-ink": triplet(p.tabSelectedInk),
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
    "--cd-on-primary": triplet(p.onPrimary),
    "--cd-on-error": triplet(p.onError),
  };
}

/**
 * 타이포 스케일 — Frosted 닫힌 스케일(24·22·16·14·13·12·11)에 모바일 본문 15 를 더한 것.
 * 15 는 블루프린트 §2-7 의 터치 화면 본문 하한(축소로 밀도를 해결하지 않는다). 반값(11.5·12.5…)은 쓰지 않는다.
 */
export const TYPO = {
  number: 24,
  title: 22,
  section: 16,
  body: 15,
  compact: 13,
  table: 12,
  meta: 11,
} as const;

/** 터치 타깃 최소 크기(pt). */
export const HIT = 44;

/** 반경 — 10 하나(컨트롤·카드·시트·필터), 세그먼트 탭 안쪽 7, 필은 pill. */
export const RADIUS = { base: 10, tabInner: 7, pill: 9999 } as const;
