// 회사소개서 일러스트 라이브러리(313) 순수 모듈 시험 — SVG 정리(화이트리스트·외부 참조·id 접두사), 색 변수 만들기·바꿔 칠하기,
// 글자 자리 ↔ 내용 짝짓기, 항목 수가 맞는 후보만, 일러스트 모양 그리기(글자 HTML·지표 칩·SVG 등록). 실제 스톡 파일은 쓰지 않는다(저작물).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { paletteizeSvg, sanitizeIllustrationSvg } from "@/lib/catalog/illustration-svg";
import {
  applySlotText,
  illustCandidates,
  illustColorVars,
  illustSlotTexts,
  illustTints,
  placeholderContent,
  sanitizeIllustColors,
  sanitizeIllustrationMeta,
  slotOverflows,
  slotTextColor,
  textWidthEm,
  type IllustrationInfo,
} from "@/lib/catalog/illustration-types";
import { IllustrationFigure, registerIllustrations } from "@/lib/catalog/render/infographic/illustration";
import { renderInfographic } from "@/lib/catalog/render/infographic/render";
import { sanitizeInfoSpec, type InfoContent, type InfoSpec } from "@/lib/catalog/render/infographic/types";
import { buildPagePlan } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { CatalogRenderData, RenderCtx } from "@/lib/catalog/render/types";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { elementToTree } from "@/lib/catalog/studio/convert";
import { addElement, applyEdits, patchNodeStyle, sanitizePageEdits, setInfo, type PageEdits } from "@/lib/catalog/studio/edits";
import { textOf, type CNode } from "@/lib/catalog/studio/nodes";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
import { capabilities, resolveSelection } from "@/lib/catalog/studio/select";
import { makeFixture } from "./catalog-studio-fixture";

const SVG = `<?xml version="1.0"?><!-- 주석 --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 300 100" width="300" height="100" onload="alert(1)">
<defs><linearGradient id="g1"><stop offset="0" style="stop-color:var(--il-c2,#41a7e0)"/></linearGradient><clipPath id="d1"><rect width="10" height="10"/></clipPath></defs>
<script>alert(1)</script><foreignObject><div>x</div></foreignObject><style>*{}</style>
<g clip-path="url(#d1)"><path d="M0 0h100v40H0z" style="fill:var(--il-c1,#9ed342)" onclick="x()"/><use xlink:href="#d1"/><use href="https://evil.example/x.svg#a"/></g>
<rect x="0" y="50" width="10" height="10" fill="url(https://evil.example/p)"/><image href="https://evil.example/a.png"/><image href="data:image/png;base64,iVBORw0KGgo="/>
<a href="javascript:alert(1)"><path d="M1 1"/></a><circle cx="5" cy="5" r="2" style="fill:var(--evil);stroke:#000"/></svg>`;

test("SVG 정리 — 스크립트·외부 참조·처리기 제거, id 접두사, 루트는 viewBox 만", () => {
  const out = sanitizeIllustrationSvg(SVG, "ilabc-");
  assert.deepEqual(out.viewBox, [0, 0, 300, 100]);
  for (const bad of ["script", "foreignObject", "<style", "onload", "onclick", "evil.example", "javascript:", "--evil", "width=\"300\""]) assert.ok(!out.svg.includes(bad), bad);
  assert.ok(out.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">'));
  assert.ok(out.svg.includes('id="ilabc-d1"') && out.svg.includes('clip-path="url(#ilabc-d1)"') && out.svg.includes('href="#ilabc-d1"'));
  assert.ok(out.svg.includes("fill:var(--il-c1,#9ed342)"), "색 변수 유지");
  assert.ok(out.svg.includes("data:image/png;base64"), "data 이미지는 유지");
  assert.ok(out.dropped.includes("script") && out.dropped.includes("a"));
  assert.throws(() => sanitizeIllustrationSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>', "ilx-"), /엔터티/);
  assert.throws(() => sanitizeIllustrationSvg("<html></html>", "ilx-"), /SVG/);
  assert.throws(() => sanitizeIllustrationSvg('<svg viewBox="0 0 1 1"><g></svg>', "ilx-"), /짝/);
});

test("색 변수 만들기 — 매처를 거치지 않은 SVG 도 바꿔 칠할 수 있게", () => {
  const raw = sanitizeIllustrationSvg('<svg viewBox="0 0 10 10"><path fill="#2f6fd6" d="M0 0"/><path fill="#2f6fd6" stroke="#333333" d="M0 0"/><rect fill="#e94e3c" style="opacity:.5" width="1" height="1"/></svg>', "ilq-").svg;
  const p = paletteizeSvg(raw);
  assert.equal(p.palette.length, 3);
  assert.equal(p.palette[0].hex, "#2f6fd6");
  assert.equal(p.palette[0].group, 0);
  assert.ok(p.palette.find((x) => x.hex === "#333333")?.neutral);
  assert.ok(!/fill="#/.test(p.svg) && p.svg.includes("var(--il-c1,#2f6fd6)"));
  assert.ok(/style="opacity:.5;fill:var\(--il-c\d,#e94e3c\)"|style="fill:var\(--il-c\d,#e94e3c\);opacity:.5"/.test(p.svg), "style 하나로 합침");
  // 다시 정리해도 통과(변수 화이트리스트)
  assert.ok(sanitizeIllustrationSvg(p.svg, "ilr-").svg.includes("var(--il-c1,#2f6fd6)"));
});

const META = {
  key: "as-1/ab01/r1",
  title: "5단계 화살",
  type: "process",
  count: 3,
  quality: 5,
  view: [300, 100],
  slots: [
    { id: "s1", role: "title", item: 1, x: 0.05, y: 0.1, w: 0.25, h: 0.08, lines: 1, fs: 0.02, lh: 1.3, align: "center", color: "#373d5b" },
    { id: "s2", role: "number", item: 1, x: 0.1, y: 0.5, w: 0.05, h: 0.1, lines: 1, fs: 0.03, lh: 1.3, align: "center", color: "#ffffff" },
    { id: "s3", role: "desc", item: 1, x: 0.05, y: 0.7, w: 0.25, h: 0.15, lines: 3, fs: 0.012, lh: 1.4, align: "left", color: "#9ed342" },
    { id: "s4", role: "title", item: 2, x: 0.38, y: 0.1, w: 0.25, h: 0.08, lines: 1, fs: 0.02, lh: 1.3, align: "center" },
    { id: "s5", role: "number", item: 2, x: 0.43, y: 0.5, w: 0.05, h: 0.1, lines: 1, fs: 0.03, lh: 1.3, align: "center" },
    { id: "s6", role: "title", item: 3, x: 0.7, y: 0.1, w: 0.25, h: 0.08, lines: 1, fs: 0.02, lh: 1.3, align: "center" },
    { id: "s7", role: "number", item: 3, x: 0.75, y: 0.5, w: 0.05, h: 0.1, lines: 1, fs: 0.03, lh: 1.3, align: "center" },
    { id: "s8", role: "bogus", item: 99, x: 5, y: 0, w: 0.1, h: 0.1 },
  ],
  palette: [
    { v: "c1", hex: "#9ed342", use: 0.5, l: 0.54, group: 0, shade: 0 },
    { v: "c2", hex: "#41a7e0", use: 0.3, l: 0.57, group: 1, shade: 0.3 },
    { v: "c3", hex: "#373d5b", use: 0.2, l: 0.29, neutral: true },
    { v: "c4", hex: "#41a7e1", alias: "#41a7e0" },
  ],
  license: { provider: "Adobe Stock", stockId: "1998385985", license: "Standard", url: "javascript:alert(1)" },
  fits: [{ item: "C09-process", page: "C09", title: "수행 절차", score: 1, fit: "상" }],
};

function info(): IllustrationInfo {
  return { ...sanitizeIllustrationMeta(META), assetId: "cil_0123456789abcdef", status: "active", svgBytes: 100, updatedAt: "2026-10-26" };
}

test("정보 정리 — 자리·팔레트·라이선스", () => {
  const i = info();
  assert.equal(i.slots.length, 7, "틀린 자리(범위 밖)는 버림");
  assert.equal(i.palette.length, 3, "별칭 색은 팔레트에서 뺌");
  assert.equal(i.license.url, "", "https 아닌 주소는 버림");
  assert.equal(i.count, 3);
});

const CONTENT: InfoContent = {
  items: [
    { id: "a", label: "사전 진단", desc: "현황 조사와 쟁점 정리", value: 12, unit: "건", metric: "contracts.total" },
    { id: "b", label: "계획서 작성", value: 3 },
    { id: "c", label: "허가 신청", value: 5 },
  ],
};

test("글자 자리 ↔ 내용 — 항목 순번으로 짝짓고, 숫자 자리는 지표 바인딩", () => {
  const t = illustSlotTexts(info(), CONTENT);
  assert.equal(t.find((x) => x.slot.id === "s1")?.text, "사전 진단");
  assert.equal(t.find((x) => x.slot.id === "s3")?.text, "현황 조사와 쟁점 정리");
  const n1 = t.find((x) => x.slot.id === "s2")!;
  assert.equal(n1.text, "12건");
  assert.equal(n1.metric, "contracts.total");
  assert.equal(t.find((x) => x.slot.id === "s5")?.text, "3");
});

test("후보 — 항목 수가 같은 일러스트만, 같은 유형·쪽 추천이 앞", () => {
  const a = info();
  const b = { ...info(), assetId: "cil_bbbbbbbbbbbbbbbb", type: "cycle" as const, title: "순환" };
  const c = { ...info(), assetId: "cil_cccccccccccccccc", count: 4 };
  const d = { ...info(), assetId: "cil_dddddddddddddddd", status: "archived" as const };
  const out = illustCandidates([b, c, a, d], CONTENT, { type: "process", pageType: "C09" });
  assert.deepEqual(
    out.map((x) => x.info.assetId),
    ["cil_0123456789abcdef", "cil_bbbbbbbbbbbbbbbb"],
    "4항목·보관 제외"
  );
  assert.ok(out[0].reasons.some((r) => r.includes("같은 유형")) && out[0].reasons.some((r) => r.includes("C09 추천")));
  // 수치형 유형(큰 숫자 등)인데 숫자 자리가 모자라면 제외, 목록형이면 후보(숫자는 제목 뒤 지표 칩)
  const noNum = { ...info(), assetId: "cil_eeeeeeeeeeeeeeee", slots: info().slots.filter((s) => s.role !== "number") };
  assert.equal(illustCandidates([noNum], CONTENT, { type: "stats" }).length, 0);
  assert.equal(illustCandidates([noNum], CONTENT, { type: "process" }).length, 1);
  const t1 = illustSlotTexts(noNum, CONTENT).find((t) => t.slot.id === "s1")!;
  assert.deepEqual(t1.suffix, { metric: "contracts.total", num: "12", unit: "건" });
  assert.equal(placeholderContent(a).items.length, 3);
});

test("색 — 모드별 토큰, 무리 안 밝기 차는 color-mix, 직접 고른 무리 색", () => {
  const i = info();
  const area = illustColorVars(i.palette, { mode: "area" });
  assert.equal(area["--il-c1"], "var(--area-mid)");
  assert.match(area["--il-c2"], /^color-mix\(in srgb, var\(--area\) \d+%, white\)$/);
  assert.equal(area["--il-c3"], "var(--ink-muted)");
  const areas = illustColorVars(i.palette, { mode: "areas" });
  assert.equal(areas["--il-c1"], "var(--area-1)");
  assert.deepEqual(illustColorVars(i.palette, { mode: "original" }), {}, "원래 색 = 변수 없음(대체값 그대로)");
  const own = illustColorVars(i.palette, sanitizeIllustColors({ mode: "original", map: { "0": "area-4-mid", "1": "evil;}", x: "brand" } }));
  assert.deepEqual(own, { "--il-c1": "var(--area-4-mid)" });
  assert.equal(slotTextColor(i.slots[0], i.palette, { mode: "area" }), "var(--ink)");
  assert.equal(slotTextColor(i.slots[1], i.palette, { mode: "area" }), "var(--on-area)", "흰 글자");
  assert.equal(slotTextColor(i.slots[2], i.palette, { mode: "areas" }), "var(--area-1)", "유채색 글자는 무리의 글자용 키 색");
});

test("일러스트 모양 그리기 — SVG 등록·글자 HTML·지표 칩·색 변수, 등록 전에는 자리 표시", () => {
  const spec: InfoSpec = sanitizeInfoSpec({ type: "process", content: CONTENT, illust: { asset: "cil_0123456789abcdef", colors: { mode: "areas" } } }, { type: "process", content: { items: [] } });
  assert.equal(spec.illust?.asset, "cil_0123456789abcdef");
  assert.equal(sanitizeInfoSpec({ type: "process", content: CONTENT, illust: { asset: "../x" } }, spec).illust, undefined);
  const missing = renderToStaticMarkup(<>{renderInfographic(spec, { w: 600, h: 200 }, { "data-slot": "x" })}</>);
  assert.ok(missing.includes("kc-ill--missing"));
  registerIllustrations([{ info: info(), svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M0 0" style="fill:var(--il-c1,#9ed342)"/></svg>' }]);
  const html = renderToStaticMarkup(<IllustrationFigure spec={spec} box={{ w: 600, h: 150 }} root={{ "data-widget": "infographic" }} />);
  assert.ok(html.includes('data-illust="cil_0123456789abcdef"') && html.includes('data-illust-art="cil_0123456789abcdef"'));
  assert.ok(html.includes("<svg") && html.includes("사전 진단") && html.includes("현황 조사와 쟁점 정리"));
  assert.ok(html.includes('<span data-metric="contracts.total">12</span>건'), "숫자만 칩, 단위는 밖");
  assert.ok(html.includes("--il-c1:var(--area-1)"));
  assert.ok(html.includes("width:min(100%, 450px)"), "자리 높이(150)에 맞춰 폭을 줄임");
  assert.equal((html.match(/kc-ill__slot /g) ?? []).length, 7);
});

// ───────── 스튜디오 편집층과 함께 ─────────

const COVER: CoverChoice = { cover: "leaf", photo: "k/assets/hq-cover-tall.webp" };
const CTX: RenderCtx = { url: (k) => `/x/${k}`, opts: { edition: "print", naming: "masked" }, docLabel: "회사소개서 2026.10", fontSet: "pretendard", concept: "navy" };
const tree = (data: CatalogRenderData, key: string) => elementToTree(buildPagePlan(CTX, data, COVER).find((p) => p.key === key)!.element, key);
function findBy(n: CNode, pred: (n: CNode) => boolean): CNode | null {
  if (pred(n)) return n;
  for (const c of n.children ?? []) {
    const hit = findBy(c, pred);
    if (hit) return hit;
  }
  return null;
}

/** n 항목짜리 가상 일러스트(제목·숫자 자리) 등록 */
function fakeIllust(id: string, n: number): IllustrationInfo {
  const slots = Array.from({ length: n }, (_, i) => [
    { id: `t${i + 1}`, role: "title", item: i + 1, x: i / n, y: 0.1, w: 1 / n, h: 0.1, lines: 1, fs: 0.02, lh: 1.3, align: "center" },
    { id: `n${i + 1}`, role: "number", item: i + 1, x: i / n, y: 0.5, w: 1 / n, h: 0.1, lines: 1, fs: 0.03, lh: 1.3, align: "center" },
  ]).flat();
  const i = { ...sanitizeIllustrationMeta({ ...META, key: id, count: n, slots }), assetId: id, status: "active" as const, svgBytes: 10, updatedAt: "x" };
  registerIllustrations([{ info: i, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" style="fill:var(--il-c1,#9ed342)"/></svg>` }]);
  return i;
}

test("스튜디오 — 인포그래픽 자리를 일러스트로: 데이터 갱신 뒤에도 유지, 숫자 자리는 최신 지표, 기본 도식으로 되돌리기", () => {
  const before = makeFixture();
  const after = makeFixture({ extraContract: true });
  const base0 = tree(before, "area-1");
  const proc = findBy(applyEdits(base0, { v: 1 }), (n) => n.widget === "infographic")!;
  const spec = (proc.props as unknown as InfoSlotProps).spec;
  const n = spec.content.items.length;
  fakeIllust("cil_aaaaaaaaaaaaaaaa", n);
  const content = { ...spec.content, items: spec.content.items.map((it, i) => (i === 0 ? { ...it, metric: "permit.initial.completed" } : it)) };
  let edits: PageEdits = setInfo({ v: 1 }, proc.id, { illust: { asset: "cil_aaaaaaaaaaaaaaaa", colors: { mode: "areas" } }, content });
  // 캔버스에서 2번 항목 제목을 고침
  const fixed = applySlotText(content, "title", 2, "고친 둘째 단계")!;
  edits = setInfo(edits, proc.id, { illust: { asset: "cil_aaaaaaaaaaaaaaaa", colors: { mode: "areas" } }, content: fixed });
  edits = sanitizePageEdits(JSON.parse(JSON.stringify(edits)));
  const d1 = applyEdits(tree(after, "area-1"), edits, { metrics: after.metrics });
  const fig = findBy(d1, (x) => (x.className ?? "").includes("kc-ill"))!;
  assert.equal(fig.id, proc.id, "같은 자리 id");
  const art = findBy(fig, (x) => x.attrs?.["data-illust-art"] === "cil_aaaaaaaaaaaaaaaa")!;
  assert.ok(art && !art.children?.length, "노드에는 SVG 본문을 넣지 않음");
  const html = renderToStaticMarkup(renderTrees([d1], { url: (k) => k, data: after }));
  assert.ok(html.includes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">'), "그릴 때 SVG 를 채움");
  assert.ok(html.includes("고친 둘째 단계"));
  assert.match(html, /<span data-metric="permit\.initial\.completed">41<\/span>/, "숫자 자리는 갱신된 지표(40→41)");
  assert.ok(html.includes("--il-c1:var(--area-1)"));
  // 기본 도식으로
  const back = setInfo(edits, proc.id, { ...edits.nodes![proc.id].info!, illust: null });
  const d2 = applyEdits(tree(after, "area-1"), sanitizePageEdits(JSON.parse(JSON.stringify(back))));
  assert.equal(findBy(d2, (x) => (x.className ?? "").includes("kc-ill")), null);
  assert.ok(textOf(d2).includes("고친 둘째 단계"), "고친 내용은 기본 도식에도 남음");
});

test("스튜디오 — 일러스트 넣기: 쪽 위 요소(위젯)로 고르고·옮기고·글 고치기, 높이는 그림 비율", () => {
  fakeIllust("cil_bbbbbbbbbbbbbbbb", 3);
  const base = tree(makeFixture(), "c05");
  const node: CNode = {
    id: "uillust01",
    tag: "div",
    className: "kc-x-illust",
    widget: "infographic",
    style: { position: "absolute", left: "48px", top: "120px", width: "481px", height: "99px" },
    props: { slot: "x", spec: { type: "process", content: placeholderContent(info()), illust: { asset: "cil_bbbbbbbbbbbbbbbb", colors: { mode: "brand" } } }, box: { w: 842, h: 0 }, area: 1 },
  };
  let edits = sanitizePageEdits(JSON.parse(JSON.stringify(addElement({ v: 1 }, node))));
  assert.equal(edits.added?.[0].style?.height, undefined, "높이는 저장하지 않음");
  assert.equal(edits.added?.[0].children, undefined, "그림·글자 자리는 저장하지 않음");
  let d = applyEdits(base, edits);
  const added = d.children!.find((c) => c.id === "uillust01")!;
  assert.ok((added.className ?? "").includes("kc-x-illust") && added.widget === "infographic" && added.origin === "add");
  const slotNode = findBy(added, (x) => x.attrs?.["data-ill-slot"] === "t2")!;
  const sel = resolveSelection(d, slotNode.id)!;
  assert.equal(sel.id, "uillust01");
  assert.equal(sel.kind, "infographic");
  const caps = capabilities(sel, 3);
  assert.ok(caps.move && caps.resize && caps.infographic && !caps.typeStep && !caps.color);
  // 글 고치기 → 저장한 spec 이 바뀜
  const spec = (added.props as unknown as InfoSlotProps).spec;
  edits = setInfo(edits, "uillust01", { content: applySlotText(spec.content, "title", 2, "둘째")! });
  // 옮기기(높이는 무시)
  d = applyEdits(base, edits);
  edits = patchNodeStyle(edits, d, "uillust01", { left: "96.33px", height: "40px" });
  d = applyEdits(base, sanitizePageEdits(JSON.parse(JSON.stringify(edits))));
  const moved = d.children!.find((c) => c.id === "uillust01")!;
  assert.equal(moved.style?.left, "96.33px");
  assert.equal(moved.style?.height, undefined);
  assert.ok(textOf(moved).includes("둘째"));
  // 기본 도식으로 바꾸는 것은 막는다(넣은 일러스트는 일러스트로만)
  assert.equal(setInfo(edits, "uillust01", { illust: null }), edits);
});

test("글자 자리 글 → 내용 칸(역할별), 지표에 묶은 숫자는 그대로", () => {
  const c: InfoContent = { title: "제목", center: { label: "중심" }, items: [{ id: "a", label: "가", metric: "x.y" }, { id: "b", label: "나" }] };
  assert.equal(applySlotText(c, "heading", 0, "새 제목")?.title, "새 제목");
  assert.deepEqual(applySlotText(c, "center", 0, "종합\n환경 컨설팅")?.center, { label: "종합", desc: "환경 컨설팅" });
  assert.equal(applySlotText(c, "desc", 2, "설명\n\n둘째 줄")?.items[1].desc, "설명\n둘째 줄", "설명은 줄바꿈을 지킨다");
  assert.equal(applySlotText(c, "number", 1, "99"), null, "지표 칩 숫자는 고치지 않음");
  assert.equal(applySlotText(c, "number", 2, "12건")?.items[1].valueText, "12건");
  assert.equal(applySlotText(c, "title", 1, "가"), null, "바뀐 것 없음");
  assert.equal(applySlotText(c, "title", 9, "x"), null);
});

test("글자 넘침 추정 — 글자별 폭(한글·영문·공백)과 자리 줄 수", () => {
  const title = info().slots.find((s) => s.id === "s1")!; // 폭 25%, 1줄
  assert.equal(slotOverflows(title, "사전 진단", 300), false);
  assert.equal(slotOverflows(title, "통합환경관리계획서 작성 및 사전 협의 대응", 300), true);
  const desc = info().slots.find((s) => s.id === "s3")!; // 3줄 + 1
  assert.equal(slotOverflows(desc, "현황 조사와 쟁점 정리", 300), false);
  assert.ok(textWidthEm("ABC abc") < textWidthEm("가나다 라마바"));
});

test("항목별 색 — 같은 계열로 그린 노드도 분야 6색이면 n번 항목 = n번 분야 키 색(표지 분야 원과 같은 색)", () => {
  const svg = '<svg viewBox="0 0 10 10"><circle style="fill:var(--il-i10,var(--il-c2,#41a7e0))"/><circle style="fill:var(--il-i2p1,var(--il-c2,#41a7e0))"/><circle style="fill:var(--il-i60,var(--il-c2,#41a7e0))"/></svg>';
  const tints = illustTints(svg);
  assert.deepEqual(tints, [{ n: 1, shades: ["0"] }, { n: 2, shades: ["p1"] }, { n: 6, shades: ["0"] }]);
  const i = info();
  const v = illustColorVars(i.palette, { mode: "areas" }, tints);
  assert.equal(v["--il-i10"], "var(--area-1)");
  assert.match(v["--il-i2p1"], /^color-mix\(in srgb, var\(--area-2\) \d+%, white\)$/);
  assert.equal(v["--il-i60"], "var(--area-6)");
  // 다른 모드는 항목 색을 두지 않고 무리 색을 따른다 — 항목에 직접 고른 색만
  const own = illustColorVars(i.palette, sanitizeIllustColors({ mode: "brand", map: { i2: "area-4" } }), tints);
  assert.equal(own["--il-i10"], undefined);
  assert.equal(own["--il-i2p1"]?.includes("var(--area-4)"), true);
  // 유채색 제목 글자는 그 항목의 키 색
  const t = { ...i.slots[2], item: 2 };
  assert.equal(slotTextColor(t, i.palette, { mode: "areas" }, undefined, tints), "var(--area-2)");
});

test("SVG 정리 — 항목별 색 변수(--il-i)는 남기고 다른 변수는 버린다", () => {
  const out = sanitizeIllustrationSvg('<svg viewBox="0 0 1 1"><circle style="fill:var(--il-i3p1,var(--il-c2,#41a7e0))"/><rect style="fill:var(--il-x9,#000)"/></svg>', "ilt-").svg;
  assert.ok(out.includes("fill:var(--il-i3p1,var(--il-c2,#41a7e0))"));
  assert.ok(!out.includes("--il-x9"));
});
