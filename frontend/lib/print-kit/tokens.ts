/*
 * print-kit 토큰 → CSS 변수. 디자인 시스템 아티팩트의 tokens.json 을 그대로 읽는다(클라이언트 안전, 순수 함수).
 * 규칙은 P1 토큰 생성기(tokens.py build)와 같다:
 *   :root = 기본 테마(첫 테마, 회사소개서 = A 네이비)의 색 + 간격·반경·선·사진 비율 + 서체 역할(--font-display/body/figure)
 *   테마별 클래스 = 기본 테마와 값이 다른 색만 다시 선언
 * 색 값은 테마별 객체({navy, dark})이거나 한 값이며, "{토큰 이름}"은 같은 테마의 다른 토큰을 가리킨다.
 */

export interface TokenEntry {
  name: string;
  value: string | Record<string, string>;
  usage?: string;
}

export interface DesignTokens {
  color: { themes: Array<{ id: string; name: string }>; tokens: TokenEntry[] };
  type?: { families?: Record<string, string> };
  spacing?: { tokens: TokenEntry[] };
  radius?: { tokens: TokenEntry[] };
  stroke?: { tokens: TokenEntry[] };
  ratio?: { tokens: TokenEntry[] };
}

export interface TokensCssOptions {
  /** 테마 id → 선택자. 기본: `.{prefix}-concept--{id}` 대신 호출자가 정한다 */
  themeSelector: (themeId: string) => string;
  /** 기본(:root) 테마 id. 없으면 첫 테마 */
  baseTheme?: string;
  /** 다시 선언할 테마(기본: 기본 테마 외 전부) */
  themes?: string[];
}

function rawValue(tokens: TokenEntry[], name: string, theme: string, base: string): string {
  const t = tokens.find((x) => x.name === name);
  if (!t) throw new Error(`토큰 '${name}'이 없습니다.`);
  if (typeof t.value === "string") return t.value;
  return t.value[theme] ?? t.value[base];
}

/** 토큰 값 풀기 — "{ref}" 는 같은 테마에서 다시 찾는다(순환 검사). */
export function resolveColor(tokens: TokenEntry[], name: string, theme: string, base: string, seen: Set<string> = new Set()): string {
  const v = rawValue(tokens, name, theme, base);
  const m = /^\{([^}]+)\}$/.exec(v.trim());
  if (!m) return v;
  if (seen.has(name)) throw new Error(`토큰 참조가 순환합니다: ${name}`);
  return resolveColor(tokens, m[1], theme, base, new Set([...seen, name]));
}

export function tokensToCss(t: DesignTokens, opts: TokensCssOptions): string {
  const base = opts.baseTheme ?? t.color.themes[0]?.id ?? "default";
  const colors = t.color.tokens;
  const lines: string[] = [":root {"];
  for (const c of colors) lines.push(`  --${c.name}: ${resolveColor(colors, c.name, base, base)};`);
  for (const group of [t.spacing, t.radius, t.stroke, t.ratio]) {
    for (const x of group?.tokens ?? []) lines.push(`  --${x.name}: ${String(x.value)};`);
  }
  for (const [role, family] of Object.entries(t.type?.families ?? {})) lines.push(`  --font-${role}: ${family};`);
  lines.push("}");
  const themes = opts.themes ?? t.color.themes.map((x) => x.id).filter((id) => id !== base);
  for (const id of themes) {
    const diffs = colors
      .map((c) => [c.name, resolveColor(colors, c.name, id, base)] as const)
      .filter(([name, v]) => v !== resolveColor(colors, name, base, base));
    if (diffs.length) lines.push(`${opts.themeSelector(id)} { ${diffs.map(([n, v]) => `--${n}: ${v};`).join(" ")} }`);
  }
  return lines.join("\n") + "\n";
}
