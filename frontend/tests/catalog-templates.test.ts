// 회사소개서 템플릿 TP0(기반) 순수 모듈 시험 — 테마 정리(기본값·옛 저장값 호환·템플릿 잠금), 템플릿 5종 정의, 쪽 변형 배관,
// 쪽 루트 클래스(kc-tpl--·kc-motif--·kc-concept--), 색 컨셉 B·C 임시값의 CSS 생성과 본문 대비. DB·converter 는 쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_DOCUMENT_THEME,
  MOTIFS,
  TEMPLATE_IDS,
  pickThemePatch,
  sanitizeAreas,
  sanitizeDocumentTheme,
  type DocumentTheme,
} from "@/lib/catalog/document-theme";
import { CATALOG_TEMPLATES, TEMPLATE_LIST, templateOf, templateVariant } from "@/lib/catalog/templates";
import { buildPagePlan } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { RenderCtx } from "@/lib/catalog/render/types";
import tokensJson from "@/lib/catalog/render/tokens.json";
import { resolveColor, tokensToCss, type DesignTokens } from "@/lib/print-kit/tokens";
import { composeDocument } from "@/lib/catalog/studio/compose";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
import { makeFixture } from "./catalog-studio-fixture";

const COVER: CoverChoice = { cover: "leaf", photo: "k/assets/hq-cover-tall.webp" };
const ctxOf = (theme: Partial<DocumentTheme> = {}): RenderCtx => ({
  url: (k) => `/x/${k}`,
  opts: { edition: "print", naming: "masked" },
  docLabel: "회사소개서 2026.10",
  fontSet: "pretendard",
  concept: theme.concept,
  template: theme.template,
  motif: theme.motif,
});
const TOKENS = tokensJson as unknown as DesignTokens;

function renderHtml(ctx: RenderCtx, theme: DocumentTheme) {
  const data = { ...makeFixture(), theme };
  const pages = composeDocument(ctx, data, COVER, []);
  return renderToStaticMarkup(renderTrees(pages.map((p) => p.tree), { url: ctx.url, data }));
}

// ── 테마 정리

test("sanitizeDocumentTheme — 저장값이 없거나 옛 모양이면 standard·drop 으로 읽는다(기존 문서 그대로)", () => {
  assert.deepEqual(sanitizeDocumentTheme(undefined), DEFAULT_DOCUMENT_THEME);
  assert.deepEqual(sanitizeDocumentTheme({}), DEFAULT_DOCUMENT_THEME);
  // P5 까지의 저장 모양(template·motif 없음)
  const old = sanitizeDocumentTheme({ fontSet: "noto", cover: "band", coverPhoto: "none", concept: "green" });
  assert.deepEqual(old, { template: "standard", fontSet: "noto", cover: "band", coverPhoto: "none", concept: "green", motif: "drop" });
  assert.equal("areas" in old, false, "선택 분야가 없으면 키를 만들지 않는다");
});

test("sanitizeDocumentTheme — 모르는 템플릿·모티프는 기본값, 선택 분야는 1~6 정수만 오름차순 중복 없이", () => {
  const t = sanitizeDocumentTheme({ template: "fancy", motif: "wave", areas: [6, "2", 2, 0, 7, 1.5, "x"] });
  assert.equal(t.template, "standard");
  assert.equal(t.motif, "drop");
  assert.deepEqual(t.areas, [2, 6]);
  assert.equal(sanitizeAreas([]), undefined);
  assert.equal(sanitizeAreas("1,2"), undefined);
  for (const id of TEMPLATE_IDS) assert.equal(sanitizeDocumentTheme({ template: id }).template, id);
  for (const m of MOTIFS) assert.equal(sanitizeDocumentTheme({ motif: m.id }).motif, m.id);
});

test("pickThemePatch — 색·서체·표지·모티프·선택 분야만 통과하고 template 은 빠진다(문서별 고정)", () => {
  const p = pickThemePatch({ template: "graphic", concept: "charcoal", motif: "ring", cover: "center", coverPhoto: "none", fontSet: "serif", areas: [3, 1] });
  assert.deepEqual(p, { cover: "center", coverPhoto: "none", fontSet: "serif", concept: "charcoal", motif: "ring", areas: [1, 3] });
  assert.equal("template" in p, false);
  // 잘못된 값은 빠지고(기본값으로 덮지 않음), areas 를 비우면 undefined 로 지운다
  assert.deepEqual(pickThemePatch({ concept: "pink", motif: 3, cover: "x", fontSet: "A B" }), {});
  assert.deepEqual(pickThemePatch({ areas: [] }), { areas: undefined });
  assert.deepEqual(pickThemePatch(undefined), {});
  // 저장 경로와 같은 합치기: 패치가 areas 를 지우면 결과에서 키가 사라진다
  const merged = sanitizeDocumentTheme({ ...sanitizeDocumentTheme({ template: "brief", areas: [1, 2] }), ...pickThemePatch({ areas: [] }) });
  assert.equal("areas" in merged, false);
  assert.equal(merged.template, "brief");
});

// ── 템플릿 정의

test("CATALOG_TEMPLATES — 5종, id 와 theme.template 이 맞고 테마가 정리 함수를 그대로 통과한다", () => {
  assert.deepEqual(Object.keys(CATALOG_TEMPLATES).sort(), [...TEMPLATE_IDS].sort());
  assert.equal(TEMPLATE_LIST.length, 5);
  for (const t of TEMPLATE_LIST) {
    assert.equal(t.theme.template, t.id, t.id);
    assert.deepEqual(sanitizeDocumentTheme(t.theme), t.theme, `${t.id} 테마 값이 올바르다`);
    assert.ok(t.label && t.desc);
    assert.equal(typeof t.variants, "object");
  }
  // 스탠다드 = 지금 모습(기본 테마와 같다)
  assert.deepEqual(CATALOG_TEMPLATES.standard.theme, DEFAULT_DOCUMENT_THEME);
  assert.equal(CATALOG_TEMPLATES.standard.plan, "full");
  // 계획서 §2 표의 테마 값
  const g = CATALOG_TEMPLATES.graphic.theme;
  assert.equal(g.concept, "green");
  assert.equal(g.motif, "ring");
  assert.equal(g.coverPhoto, "none");
  const f = CATALOG_TEMPLATES.formal.theme;
  assert.equal(f.concept, "charcoal");
  assert.equal(f.motif, "contour");
  assert.equal(f.fontSet, "serif");
  assert.equal(CATALOG_TEMPLATES.formal.plan, "formal");
  assert.equal(CATALOG_TEMPLATES.brief.plan, "brief");
  assert.equal(CATALOG_TEMPLATES.photo.fallback, "graphic");
  // 모르는 id → standard
  assert.equal(templateOf("nope").id, "standard");
  assert.equal(templateOf(undefined).id, "standard");
});

test("templateVariant — 쪽 유형 값 위에 쪽 키 값, 그 위에 저장 변형(PageEdits.variant)이 얹힌다", () => {
  const tpl = { ...CATALOG_TEMPLATES.photo, variants: { C09: { hero: "photo-wide" }, "area-1": { hero: "none" } } };
  assert.deepEqual(templateVariant(tpl, "area-1", "C09"), { hero: "none" });
  assert.deepEqual(templateVariant(tpl, "area-2", "C09"), { hero: "photo-wide" });
  assert.deepEqual(templateVariant(tpl, "c05", "C05"), {});
  const data = makeFixture();
  const plan = buildPagePlan(ctxOf(), data, COVER, { "area-2": { hero: "photo", photo: "a/x" } }, tpl);
  const props = (key: string) => (plan.find((p) => p.key === key)!.element.props as { variant: Record<string, string> }).variant;
  assert.deepEqual(props("area-1"), { hero: "none" });
  assert.deepEqual(props("area-2"), { hero: "photo", photo: "a/x" }, "저장 변형이 템플릿 기본값을 덮는다");
  // 템플릿을 주지 않으면 ctx.template → standard(변형 없음) — 쪽 목록은 같다
  const base = buildPagePlan(ctxOf(), data, COVER);
  assert.deepEqual(
    plan.map((p) => p.key),
    base.map((p) => p.key)
  );
  assert.deepEqual((base.find((p) => p.key === "area-1")!.element.props as { variant: Record<string, string> }).variant, {});
});

// ── 쪽 루트 클래스

test("Sheet — 저장값 없는 마스터는 kc-tpl--standard·kc-motif--drop 으로 그려지고, ctx 에 템플릿을 안 줘도 같은 HTML 이다", () => {
  const theme = sanitizeDocumentTheme({});
  const html = renderHtml(ctxOf(theme), theme);
  assert.match(html, /kc-page pk-sheet[^"]*kc-tpl--standard[^"]*kc-concept--navy[^"]*kc-motif--drop/);
  assert.equal(html.includes("kc-motif--ring"), false);
  // template·motif 를 모르는 호출자(ctx 미지정) 와 지문이 같다 — 기존 미리보기·발행과 호환
  const legacy = renderHtml({ ...ctxOf(), concept: "navy" }, theme);
  assert.equal(legacy, html);
  // 지도의 모티프 클래스는 쪽 루트로 옮겼다(하드코딩 제거)
  assert.equal(/kc-map[^"]*kc-motif--drop/.test(html), false);
});

test("Sheet — graphic 템플릿 문서는 kc-tpl--graphic·kc-concept--green·kc-motif--ring 으로 그려진다", () => {
  const theme = CATALOG_TEMPLATES.graphic.theme;
  const html = renderHtml(ctxOf(theme), theme);
  assert.match(html, /kc-tpl--graphic/);
  assert.match(html, /kc-concept--green/);
  assert.match(html, /kc-motif--ring/);
  assert.equal(html.includes("kc-motif--drop"), false);
  assert.equal(html.includes("kc-concept--navy"), false);
  const formal = renderHtml(ctxOf(CATALOG_TEMPLATES.formal.theme), CATALOG_TEMPLATES.formal.theme);
  assert.match(formal, /kc-tpl--formal[^"]*kc-concept--charcoal[^"]*kc-fontset--pretendard[^"]*kc-motif--contour/);
});

// ── 색 컨셉 B·C 임시값

const lum = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `hex 색이어야 한다: ${hex}`);
  const c = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const color = (name: string, theme: string) => resolveColor(TOKENS.color.tokens, name, theme, "navy");

test("tokens.json — green·charcoal 테마가 CSS 로 생성되고(.kc-concept--*), 임시값이 계획서 §2 성격을 따른다", () => {
  const css = tokensToCss(TOKENS, { themeSelector: (id) => `.kc-concept--${id}` });
  assert.match(css, /\.kc-concept--green \{[^}]*--field: #72af2d;/);
  assert.match(css, /\.kc-concept--green \{[^}]*--on-field: #102543;/, "그린 바탕 위 글자는 네이비");
  assert.match(css, /\.kc-concept--charcoal \{[^}]*--field: #2b2f36;/);
  assert.match(css, /\.kc-concept--charcoal \{[^}]*--brand: #2b2f36;/);
  assert.equal(color("accent", "charcoal"), "#72af2d", "차콜 테마의 강조는 CI 그린");
  assert.equal(color("accent", "green"), "#102543", "그린 테마의 강조는 네이비(그린 위 그린을 피함)");
  assert.ok(TOKENS.color.tokens.filter((t) => typeof t.value === "object" && t.value.green).every((t) => /임시값/.test(t.usage ?? "")), "임시값 표시");
});

test("tokens.json — green·charcoal 본문·면 위 글자 대비 4.5:1 이상(WCAG AA)", () => {
  for (const theme of ["green", "charcoal"]) {
    const pairs: Array<[string, string]> = [
      ["ink", "paper"],
      ["ink-muted", "paper"],
      ["ink", "canvas"],
      ["brand", "paper"],
      ["accent-ink", "paper"],
      ["on-field", "field"],
      ["on-brand", "brand"],
      ["link", "paper"],
    ];
    for (const [fg, bg] of pairs) {
      const r = contrast(color(fg, theme), color(bg, theme));
      assert.ok(r >= 4.5, `${theme}: ${fg} on ${bg} = ${r.toFixed(2)}:1`);
    }
  }
});
