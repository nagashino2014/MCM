/**
 * 테마 파생 컬러 — 핸드오프 패키지(채용공고 템플릿.dc.html)의 로직 클래스를 이식.
 * accentColor(hex) 하나에서 --accent / --accent-deep / --accent-soft 가 파생된다.
 */
import type { DocTheme } from "./types";

export function toHsl(hex: string): [number, number, number] {
  let raw = hex.slice(1);
  if (raw.length === 3) raw = raw.split("").map((c) => c + c).join("");
  const n = parseInt(raw.slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export function darkenAccent(hex: string): string {
  const [h, s, l] = toHsl(hex);
  return `hsl(${h} ${s}% ${Math.max(l - 12, 8)}%)`;
}

export function softenAccent(hex: string): string {
  const [h, s] = toHsl(hex);
  return `hsl(${h} ${Math.min(s, 40)}% 94%)`;
}

/**
 * 문서 루트에 주입할 CSS 변수 세트.
 * 파싱된 :root 기본값(cssVars) 위에 accentColor 파생·compact 를 덮어쓴다.
 */
export function buildDocCssVars(theme: DocTheme): Record<string, string> {
  const vars: Record<string, string> = { ...(theme.cssVars ?? {}) };
  const accent = theme.accentColor;
  if (accent && /^#[0-9a-fA-F]{3,8}$/.test(accent)) {
    vars["--accent"] = accent;
    vars["--accent-deep"] = darkenAccent(accent);
    vars["--accent-soft"] = softenAccent(accent);
  }
  if (typeof theme.compact === "boolean" && vars["--secpad"]) {
    vars["--secpad"] = theme.compact ? "34px" : "52px";
  }
  return vars;
}
