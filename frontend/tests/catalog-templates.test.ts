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
import { CATALOG_TEMPLATES, PAGE_VARIANT_FIELDS, TEMPLATE_LIST, fallbackNote, resolveVariant, templateOf, templateVariant } from "@/lib/catalog/templates";
import { fitsPage } from "@/lib/catalog/illustration-types";
import { buildPagePlan } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { RenderCtx } from "@/lib/catalog/render/types";
import tokensJson from "@/lib/catalog/render/tokens.json";
import { resolveColor, tokensToCss, type DesignTokens } from "@/lib/print-kit/tokens";
import { composeDocument } from "@/lib/catalog/studio/compose";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
import { makeFixture } from "./catalog-studio-fixture";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  assert.equal(TEMPLATE_LIST.length, 6);
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
  assert.equal(f.fontSet, "pretendard", "격조형도 기본 서체 프리텐다드(사용자 지시 10-29)");
  const r = CATALOG_TEMPLATES.research;
  assert.equal(r.theme.concept, "steel");
  assert.equal(r.theme.cover, "research");
  assert.equal(r.plan, "research");
  assert.deepEqual(r.variants.C13, { card: "list" });
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

// ── 색 컨셉 B·C 값(TP1 시안 1안 — docs/catalog-templates-plan.md §4-3 T-2)

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

test("tokens.json — green·charcoal 테마가 CSS 로 생성되고(.kc-concept--*), 값이 계획서 §2 성격을 따르며 TP0 임시값 표시가 남아 있지 않다", () => {
  const css = tokensToCss(TOKENS, { themeSelector: (id) => `.kc-concept--${id}` });
  assert.match(css, /\.kc-concept--green \{[^}]*--field: #72af2d;/);
  assert.match(css, /\.kc-concept--green \{[^}]*--on-field: #102543;/, "그린 바탕 위 글자는 네이비");
  assert.match(css, /\.kc-concept--charcoal \{[^}]*--field: #2b2f36;/);
  assert.match(css, /\.kc-concept--charcoal \{[^}]*--brand: #2b2f36;/);
  assert.equal(color("accent", "charcoal"), "#72af2d", "차콜 테마의 강조는 CI 그린");
  assert.equal(color("accent", "green"), "#102543", "그린 테마의 강조는 네이비(그린 위 그린을 피함)");
  assert.match(css, /\.kc-concept--green \{[^}]*--brand: #2d6a1a;/, "그린 테마 주색은 짙은 녹색(흰 바탕 6.6:1)");
  assert.match(css, /\.kc-concept--green \{[^}]*--rule-strong: #1f3a12;/);
  assert.ok(TOKENS.color.tokens.every((t) => !/임시값/.test(t.usage ?? "")), "TP0 임시값 표시가 남아 있지 않다");
  assert.ok(!/임시값/.test((tokensJson as { meta?: { note?: string } }).meta?.note ?? ""), "meta.note 에 임시값 표기가 없다");
  // 아티팩트 tokens.json 과 같은 파일 — 변환기(tokensToCss)가 모르는 테마 값이 섞이면 생성이 깨지므로 테마 id 는 4개뿐
  assert.deepEqual(TOKENS.color.themes.map((t) => t.id), ["navy", "green", "charcoal", "steel", "dark"]);
  assert.match(css, /\.kc-concept--steel \{[^}]*--field: #104e86;/, "스틸 블루 머리 띠·면");
});

test("tokens.json — green·charcoal 본문·면 위 글자 대비 4.5:1 이상(WCAG AA)", () => {
  for (const theme of ["green", "charcoal", "steel"]) {
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

// ── 지면 키트 CSS(TP1 재export): 변형 클래스가 있고, TP1 블록의 모든 선택자가 템플릿·모티프·컨셉·변형 클래스로 범위가 잡혀 기존 standard 문서를 건드리지 않는다

const KIT_CSS = readFileSync(join(process.cwd(), "public/catalog-kit/kesi-catalog.css"), "utf8");

test("kesi-catalog.css — 계획서 §3-3 쪽 변형 클래스와 모티프 ring·contour 상징 자리 클래스가 있다", () => {
  const classes = [
    ".kc-front--photo", ".kc-front--graphic", ".kc-front__band-field",
    ".kc-divider--photo-full", ".kc-divider--color-pattern", ".kc-divider--plain",
    ".kc-kpis--band", ".kc-kpi--band", ".kc-kpis--cards8", ".kc-kpi--card",
    ".kc-timeline--horizontal", ".kc-timeline--columns4",
    ".kc-bizhero--photo-wide", ".kc-bizhero--none",
    ".kc-strengths--icon-large",
    ".kc-people--portrait-large", ".kc-person--portrait-large", ".kc-people--list", ".kc-person--list",
    ".kc-creds--table", ".kc-cred--table",
    ".kc-sheet--brief", ".kc-tpl--brief", ".kc-tpl--formal", ".kc-brief",
    ".kc-front__ring", ".kc-divider__ring", ".kc-backc__ring", ".kc-front__contour", ".kc-divider__contour", ".kc-backc__contour",
    ".kc-ring--concentric", ".kc-contour-field", ".kc-pattern",
    ".kc-front--research", ".kc-front__wash", ".kc-front__photo-half", ".kc-front__rule", ".kc-front__orbit", ".kc-tpl--research", ".kc-backc--thanks", ".kc-topic", ".kc-phases",
  ];
  for (const c of classes) assert.ok(KIT_CSS.includes(c), `${c} 가 kesi-catalog.css 에 있어야 한다`);
  // 헤더는 재export 스크립트가 쓴다(손수정 금지 안내 유지)
  assert.match(KIT_CSS.split("\n")[0],/디자인 시스템 아티팩트 project\/components\/bundle\.css\(version [^,]+, \d{4}-\d{2}-\d{2}\) 사본/);
  assert.equal(/@import\s+url\(/.test(KIT_CSS), false, "PDF 변환기가 외부 네트워크를 막으므로 @import 가 없어야 한다");
});

test("kesi-catalog.css — TP1 블록의 선택자는 모두 템플릿·모티프(ring·contour)·컨셉(green·charcoal)·변형 클래스를 포함한다(standard 렌더 불변)", () => {
  const mark = KIT_CSS.indexOf("템플릿 4종 TP1(");
  assert.ok(mark > 0, "TP1 블록 머리말");
  const block = KIT_CSS.slice(KIT_CSS.lastIndexOf("/*", mark)).replace(/\/\*[\s\S]*?\*\//g, "");
  const guard =
    /kc-tpl--(photo|graphic|formal|brief|research)|kc-motif--(ring|contour)|kc-concept--(green|charcoal|steel)|kc-front--research|kc-front__(wash|photo-half|rule|sub|eyebrow--en|orbit)|kc-backc--thanks|kc-topic|kc-phases|kc-sheet--brief|kc-front--(photo|graphic)|kc-front__(ring|ring-node|contour|full|plate|band-field|caption)|kc-divider--(photo-full|color-pattern|plain)|kc-divider__(ring|ring-node|contour|photo|full)|kc-backc__(ring|contour)|kc-kpis--(band|cards8)|kc-kpi--(band|card)|kc-kpis__bg|kc-timeline--(horizontal|columns4)|kc-bizhero--(photo-wide|none)|kc-strengths--icon-large|kc-people--(portrait-large|list)|kc-person--(portrait-large|list)|kc-creds--table|kc-cred--table|kc-brief|kc-ring--concentric|kc-contour-field|kc-pattern/;
  const rules = [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  assert.ok(rules.length > 100, `규칙 수 ${rules.length}`);
  const bad = rules.flatMap((m) => m[1].split(",").map((s) => s.trim()).filter((s) => s && !guard.test(s)));
  assert.deepEqual(bad, []);
});

test("CoverPage — research 템플릿 문서는 G 연구소형 표지(kc-front--research: 하늘빛 면·밑줄·부설연구소 부제·사진 반면)를 그린다", () => {
  const theme = CATALOG_TEMPLATES.research.theme;
  const data = { ...makeFixture(), theme };
  const pages = composeDocument(ctxOf(theme), data, { cover: "research", photo: "k/assets/hq-cover-tall.webp" }, []);
  const html = renderToStaticMarkup(renderTrees(pages.map((p) => p.tree), { url: ctxOf(theme).url, data }));
  assert.match(html, /kc-front kc-front--research/);
  assert.match(html, /kc-front__wash/);
  assert.match(html, /kc-front__photo-half/);
  assert.match(html, /kc-front__rule/);
  assert.match(html, /탄소중립 미래연구소/);
  assert.match(html, /kc-tpl--research[^"]*kc-concept--steel/);
});


// ── TP2 쪽 변형·쪽 계획·사진 폴백(계획서 §3-2·§3-3) ──

const keysOf = (theme: DocumentTheme, data = makeFixture(), opts: Partial<RenderCtx["opts"]> = {}) =>
  buildPagePlan({ ...ctxOf(theme), opts: { ...ctxOf(theme).opts, ...opts } }, { ...data, theme }, COVER).map((p) => p.key);
const htmlOf = (theme: DocumentTheme, pages: Parameters<typeof composeDocument>[3] = [], cover: CoverChoice = COVER, data = makeFixture()) => {
  const ctx = ctxOf(theme);
  const d = { ...data, theme };
  return renderToStaticMarkup(renderTrees(composeDocument(ctx, d, cover, pages).map((p) => p.tree), { url: ctx.url, data: d }));
};
const STANDARD_KEYS = [
  "c01", "c02", "c03", "c04", "c05", "c06-1", "c07-02", "c08", "area-1", "area-2", "area-3", "area-4", "area-5", "c09-software", "c09-platform",
  "c07-03", "c10", "c11", "c12", "c13-1", "c14", "c15-staff", "c15-advisors", "c16", "c17", "c18", "a01", "a02-1", "c19",
];
const VARIANT_CLASS_RE = /kc-(front--(photo|graphic)\b|kpis--(band|cards8)|timeline--(horizontal|columns4)|divider--(photo-full|color-pattern|plain)|bizhero--(photo-wide|none)|strengths--icon-large|people--(portrait-large|list)|creds--table|sheet--brief)/;

test("buildPagePlan — 템플릿별 쪽 키 목록(standard·photo·graphic·research = 지금 목차, formal = 신뢰 근거 앞으로, brief = 요약 쪽 계획)", () => {
  assert.deepEqual(keysOf(CATALOG_TEMPLATES.standard.theme), STANDARD_KEYS, "standard(마스터) 쪽 목록 불변");
  for (const id of ["photo", "graphic", "research"] as const) assert.deepEqual(keysOf(CATALOG_TEMPLATES[id].theme), STANDARD_KEYS, id);
  assert.deepEqual(keysOf(CATALOG_TEMPLATES.formal.theme), [
    "c01", "c02", "c03", "c04", "c05", "c06-1", "c16", "c17", "a01", "c07-02", "c08", "area-1", "area-2", "area-3", "area-4", "area-5", "c09-software", "c09-platform",
    "c07-03", "c10", "c11", "c12", "c13-1", "c14", "c15-staff", "c15-advisors", "c18", "a02-1", "c19",
  ]);
  // 요약본은 부록을 빼지만 격조형의 수행실적 총괄(a01)은 본편이라 남는다
  const formalSummary = keysOf(CATALOG_TEMPLATES.formal.theme, makeFixture(), { scope: "summary" });
  assert.ok(formalSummary.includes("a01") && !formalSummary.includes("a02-1"));
  // brief: 선택 분야가 없으면 앞 3분야, 목차·부록 없음
  assert.deepEqual(keysOf(CATALOG_TEMPLATES.brief.theme), ["c01", "c04", "c08", "brief-1", "brief-2", "brief-3", "c10", "c16", "c18", "c19"]);
  assert.deepEqual(keysOf({ ...CATALOG_TEMPLATES.brief.theme, areas: [4, 6] }), ["c01", "c04", "c08", "brief-4", "brief-6", "c10", "c16", "c18", "c19"]);
  const brief = buildPagePlan(ctxOf(CATALOG_TEMPLATES.brief.theme), { ...makeFixture(), theme: CATALOG_TEMPLATES.brief.theme }, COVER);
  assert.ok(brief.filter((p) => p.type === "C20").every((p) => p.maxLevel === 3 && p.section === "02"), "C20 은 편집 L1~L3");
});

test("standard 마스터 렌더 — 쪽 변형 클래스·폴백 안내가 하나도 없다(TP2 분기는 템플릿 문서에만)", () => {
  const html = htmlOf(CATALOG_TEMPLATES.standard.theme);
  assert.equal(VARIANT_CLASS_RE.test(html), false, html.match(VARIANT_CLASS_RE)?.[0]);
  assert.equal(html.includes("data-fallback-note"), false);
  // 목차 번호는 원래 번호 그대로
  assert.match(html, /kc-toc__num">05<\/span><span class="kc-toc__name">신뢰 근거/);
});

test("graphic 템플릿 — F 그래픽 표지(링 궤도·분야 노드)·숫자 카드 8·가로 연혁·색 면 간지·인포그래픽 확대·역량 아이콘 큰 변형", () => {
  const theme = CATALOG_TEMPLATES.graphic.theme;
  const html = htmlOf(theme, [], { cover: "graphic", photo: null });
  for (const re of [
    /kc-front kc-front--graphic/,
    /kc-front__orbit/,
    /kc-ring kc-front__orbit-ring/,
    /kc-ring kc-ring--concentric kc-front__orbit-inner/,
    /kc-front__orbit-node kc-area-6/,
    /kc-kpis kc-kpis--cards8/,
    /kc-timeline kc-timeline--horizontal/,
    /kc-timeline__axis/,
    /kc-divider kc-divider--color-pattern/,
    /kc-pattern/,
    /kc-bizhero kc-bizhero--none/,
    /kc-strengths kc-strengths--icon-large/,
  ])
    assert.match(html, re);
  assert.equal(html.includes("data-fallback-note"), false, "사진이 필요 없는 변형뿐이라 폴백 없음");
});

test("formal 템플릿 — 단색 간지·연혁 4단·임원 목록형·인증 목록형, 섹션 번호가 쪽 계획 순서로(신뢰 근거 02)", () => {
  const theme = CATALOG_TEMPLATES.formal.theme;
  const html = htmlOf(theme, [], { cover: "strips", photo: null });
  for (const re of [/kc-divider kc-divider--plain/, /kc-timeline kc-timeline--columns4/, /kc-people kc-people--list/, /kc-person kc-person--list/, /kc-creds kc-creds--table/, /kc-cred kc-cred--table/])
    assert.match(html, re);
  // 목차: 01 회사 소개 → 02 신뢰 근거 → 03 사업 분야 …
  const toc = [...html.matchAll(/kc-toc__num">([^<]+)<\/span><span class="kc-toc__name">([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(toc.slice(0, 7), ["01 회사 소개", "02 신뢰 근거", "03 사업 분야", "04 핵심 역량", "05 조직과 사람", "06 오시는 길", "부록 수행실적·인력"]);
  // 쪽 머리·북마크·간지 번호
  assert.match(html, /kc-head__num">02<\/span><span class="kc-head__name">신뢰 근거/);
  assert.match(html, /kc-head__num">05<\/span><span class="kc-head__name">조직과 사람/);
  assert.match(html, /<h1 class="pk-outline">02 신뢰 근거<\/h1>/);
  assert.match(html, /kc-divider__num">03<\/p><p class="kc-divider__title">사업 분야/);
  // 수행실적 총괄은 본편(부록 A 표기 없음), 부록 섹션 앵커는 부록 B 첫 쪽
  assert.match(html, /data-anchors="a01"/);
  assert.match(html, /<h2 class="pk-outline">수행실적 총괄<\/h2>/);
  assert.match(html, /data-anchors="sec-app a02-1"/);
});

test("brief 템플릿 — C20 분야 1장 요약(.kc-brief: 서비스·강점·KPI·대표 실적 3건·문의), 섹션 첫 쪽이 앵커를 맡고 번호가 01~05", () => {
  const theme = { ...CATALOG_TEMPLATES.brief.theme, areas: [1] };
  const html = htmlOf(theme, [], { cover: "band", photo: null });
  for (const re of [/kc-sheet--brief/, /kc-brief__services/, /kc-brief__strengths/, /kc-brief__kpis/, /kc-brief__cases/, /kc-brief__contact/, /분야 요약 01/])
    assert.match(html, re);
  assert.match(html, /data-anchors="sec-01 c04"/);
  assert.match(html, /data-anchors="sec-02 c08"/);
  assert.match(html, /data-anchors="area-1 brief-1"/);
  assert.match(html, /data-anchors="sec-03 c10"/);
  assert.match(html, /kc-head__num">04<\/span><span class="kc-head__name">신뢰 근거/);
  assert.match(html, /kc-head__num">05<\/span><span class="kc-head__name">오시는 길/);
  assert.equal(html.includes("kc-toc"), false, "목차 쪽 없음");
  // 대표 실적은 3건까지(가상 데이터 2건), 숫자는 지표 칩
  const cases = html.split('class="kc-brief__cases"')[1]?.split("</ul>")[0] ?? "";
  assert.equal((cases.match(/kc-cases__year/g) ?? []).length, 2);
  assert.match(html.split('class="kc-brief__kpis"')[1] ?? "", /data-metric="permit.initial.completed"/);
});

test("photo 템플릿 — 사진이 있으면 E 전면 사진 표지·숫자 사진 띠·전면 사진 간지·전폭 히어로·3:4 큰 인물 사진", () => {
  const theme = CATALOG_TEMPLATES.photo.theme;
  const data = makeFixture();
  data.leaders = data.leaders.map((l) => ({ ...l, photo: "a/leader" }));
  const pages = ["c04", "c07-02", "c07-03", "area-1"].map((key) => ({ key, order: null, hidden: false, edits: { v: 1 as const, variant: { photo: "a/pic" } } }));
  const html = htmlOf(theme, pages, { cover: "photo", photo: "/x/k/assets/hq-cover-tall.webp" }, data);
  for (const re of [
    /kc-front kc-front--photo/,
    /kc-front__plate/,
    /kesi-en-horizontal-white/,
    /kc-kpis kc-kpis--band/,
    /kc-kpis__bg/,
    /kc-divider kc-divider--photo-full/,
    /kc-bizhero kc-bizhero--photo-wide/,
    /kc-people kc-people--portrait-large/,
    /kc-person kc-person--portrait-large/,
  ])
    assert.match(html, re);
  // 사진을 고른 쪽엔 폴백 안내가 없다(area-2~5 는 사진이 없어 폴백)
  const plan = buildPagePlan(ctxOf(theme), { ...data, theme }, { cover: "photo", photo: "x" }, Object.fromEntries(pages.map((p) => [p.key, p.edits.variant])));
  assert.equal(plan.find((p) => p.key === "area-1")!.note, undefined);
  assert.match(plan.find((p) => p.key === "area-2")!.note ?? "", /사진 없음/);
  // 큰 사진 카드는 한 쪽에 3명
  const many = { ...data, leaders: Array.from({ length: 7 }, (_, i) => ({ ...data.leaders[0], key: `l${i}`, photo: "a/p" })) };
  assert.deepEqual(buildPagePlan(ctxOf(theme), { ...many, theme }, COVER).filter((p) => p.type === "C13").map((p) => p.key), ["c13-1", "c13-2", "c13-3"]);
});

test("사진 폴백 — photo 템플릿에 사진이 없으면 graphic 변형으로 그리고 쪽 검사·확인할 내용에 '사진 없음' 안내를 남긴다", () => {
  const theme = CATALOG_TEMPLATES.photo.theme;
  const data = makeFixture(); // 임원 사진 없음
  const plan = buildPagePlan(ctxOf(theme), { ...data, theme }, { cover: "photo", photo: null });
  const at = (key: string) => plan.find((p) => p.key === key)!;
  assert.deepEqual(at("c04").variant, { layout: "cards8" });
  assert.match(at("c04").note ?? "", /^사진 없음 — 사진 배경 띠 대신 아이콘\+큰 숫자 카드 8 변형으로 그림$/);
  assert.deepEqual(at("c07-02").variant, { style: "color-pattern" });
  assert.deepEqual(at("area-3").variant, { hero: "none" });
  assert.equal(at("c13-1").variant, undefined, "graphic 에 임원 변형이 없어 기본(정방)으로");
  assert.match(at("c13-1").note ?? "", /3:4 큰 사진 대신 정방 사진\(기본\)/);
  assert.match(at("c01").note ?? "", /F 그래픽 표지/);
  const html = htmlOf(theme, [], { cover: "photo", photo: null }, data);
  assert.match(html, /kc-front kc-front--graphic/);
  assert.match(html, /kc-kpis kc-kpis--cards8/);
  assert.equal(html.includes("kc-kpis--band"), false);
  assert.equal(html.includes("kc-divider--photo-full"), false);
  assert.ok((html.match(/data-fallback-note="사진 없음/g) ?? []).length >= 8, "표지·숫자·간지 2·분야 5·임원 쪽 루트에 안내");
});

test("resolveVariant — 저장 변형이 템플릿 값을 덮고, 사진을 고르면 폴백하지 않으며, 기존 hero: photo 는 조용히 숫자 변형", () => {
  const photo = CATALOG_TEMPLATES.photo;
  assert.deepEqual(resolveVariant(photo, "c04", "C04", undefined), { variant: { layout: "cards8" }, fallbacks: [{ field: "layout", from: "band", to: "cards8" }] });
  assert.deepEqual(resolveVariant(photo, "c04", "C04", { photo: "a/x" }).fallbacks, []);
  assert.deepEqual(resolveVariant(photo, "c04", "C04", { layout: "grid" }), { variant: { layout: "grid" }, fallbacks: [] });
  // fallback 템플릿에 대응 변형이 없으면 기본값(키 삭제)
  assert.deepEqual(resolveVariant(CATALOG_TEMPLATES.standard, "c07-02", "C07", { style: "photo-full" }), { variant: {}, fallbacks: [{ field: "style", from: "photo-full", to: "leaf" }] });
  assert.deepEqual(resolveVariant(CATALOG_TEMPLATES.standard, "area-1", "C09", { hero: "photo" }).fallbacks, []);
  assert.equal(fallbackNote("C04", []), undefined);
  // 쪽 변형 축의 값은 모두 저장 규칙(edits VARIANT_VAL)을 통과하는 모양
  for (const fields of Object.values(PAGE_VARIANT_FIELDS)) for (const f of fields) for (const [v] of f.values) assert.match(v, /^[a-z0-9-]{1,30}$/);
  // 템플릿 기본 변형은 모두 정의된 축·값
  for (const t of TEMPLATE_LIST)
    for (const [k, pv] of Object.entries(t.variants)) {
      if (!/^C\d\d$/.test(k)) continue;
      for (const [field, value] of Object.entries(pv)) {
        const f = PAGE_VARIANT_FIELDS[k]?.find((x) => x.field === field);
        assert.ok(f && f.values.some(([id]) => id === value), `${t.id} ${k}.${field}=${value}`);
      }
    }
});

test("COVER_DESIGNS — E 전면 사진·F 그래픽이 선택지에 있고 템플릿 기본 표지와 맞다", () => {
  assert.equal(CATALOG_TEMPLATES.photo.theme.cover, "photo");
  assert.equal(CATALOG_TEMPLATES.graphic.theme.cover, "graphic");
  assert.equal(sanitizeDocumentTheme({ cover: "graphic" }).cover, "graphic");
  assert.equal(sanitizeDocumentTheme({ cover: "photo" }).cover, "photo");
});

test("fitsPage — C20 분야 요약은 C20 적합도가 없으면 분야 상세(C09) 적합도를 쓴다", () => {
  const info = { fits: [{ item: "C09-process", page: "C09" }] } as unknown as Parameters<typeof fitsPage>[0];
  assert.equal(fitsPage(info, "C20")?.item, "C09-process");
  assert.equal(fitsPage(info, "C10"), null);
  const own = { fits: [{ item: "C09-process", page: "C09" }, { item: "C20-x", page: "C20" }] } as unknown as Parameters<typeof fitsPage>[0];
  assert.equal(fitsPage(own, "C20")?.item, "C20-x");
});
