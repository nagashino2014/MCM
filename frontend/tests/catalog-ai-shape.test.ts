// 회사소개서 'AI로 수정' 고도화(블루프린트 §7-5 A·B·G) 순수 모듈 시험 — 모양 연산(일러스트 id·색 모드·토큰·맞춤 화이트리스트),
// 쪽 톤 맞추기(색 토큰·대비 4.5:1 대체), 넘침 축약의 일러스트 제목 뒤 지표 칩. LLM 호출은 하지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chipItems, fittedItems, infoFitItems, overflowTargets } from "@/lib/catalog/ai/fit";
import {
  applyChanges,
  buildOutline,
  charLen,
  metricBriefs,
  shapeChoices,
  validatePatch,
  type AddedBlock,
  type InfoBlock,
  type ShapeChoice,
  type TextBlock,
} from "@/lib/catalog/ai/patch";
import { SECTION_WRITE_SYSTEM } from "@/lib/catalog/ai/prompts";
import { ruleEditOps, ruleShorten } from "@/lib/catalog/ai/template";
import { sanitizeIllustrationMeta, suffixItems, type IllustrationInfo } from "@/lib/catalog/illustration-types";
import { registerIllustrations } from "@/lib/catalog/render/infographic/illustration";
import { buildPagePlan } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import type { CatalogRenderData, RenderCtx } from "@/lib/catalog/render/types";
import { composePage } from "@/lib/catalog/studio/compose";
import { addElement, sanitizePageEdits, type PageEdits } from "@/lib/catalog/studio/edits";
import type { CNode } from "@/lib/catalog/studio/nodes";
import { makeFixture } from "./catalog-studio-fixture";

const COVER: CoverChoice = { cover: "leaf", photo: "k/assets/hq-cover-tall.webp" };
const ctx: RenderCtx = { url: (k) => `/x/${k}`, opts: { edition: "print", naming: "masked" }, docLabel: "회사소개서 2026.10", fontSet: "pretendard", concept: "navy" };

function page(edits?: PageEdits, data: CatalogRenderData = makeFixture()) {
  const item = buildPagePlan(ctx, data, COVER).find((p) => p.key === "area-4")!;
  const tree = composePage(item, edits ? { key: "area-4", order: null, hidden: false, edits } : null, { metrics: data.metrics }).tree;
  const outline = buildOutline(tree, item, { casesEditable: true });
  return { item, tree, outline, metrics: metricBriefs(data.metrics), data };
}

/** 항목 n 개짜리 일러스트 — 항목마다 제목 자리, numbered 에 든 항목만 숫자 자리 */
function illust(id: string, n: number, opts: { title?: string; numbered?: number[]; groups?: number } = {}): IllustrationInfo {
  const slots = Array.from({ length: n }, (_, i) => [
    { id: `t${i + 1}`, role: "title", item: i + 1, x: 0.05 + i * 0.18, y: 0.1, w: 0.16, h: 0.08, lines: 1, fs: 0.02, lh: 1.3, align: "center" },
    ...((opts.numbered ?? []).includes(i + 1) ? [{ id: `n${i + 1}`, role: "number", item: i + 1, x: 0.05 + i * 0.18, y: 0.5, w: 0.05, h: 0.1, lines: 1, fs: 0.03, lh: 1.3, align: "center" }] : []),
  ]).flat();
  const palette = Array.from({ length: opts.groups ?? 2 }, (_, g) => ({ v: `c${g + 1}`, hex: g === 0 ? "#9ed342" : "#41a7e0", use: 0.3, l: 0.55, group: g, shade: 0 }));
  const meta = sanitizeIllustrationMeta({ key: id, title: opts.title ?? `그림 ${id}`, type: "process", count: n, view: [1000, 400], slots, palette, fits: [{ item: "C09-process", page: "C09", fit: "상" }] });
  return { ...meta, assetId: id, status: "active", svgBytes: 100, updatedAt: "2026-10-29" };
}

const A5 = "cil_00000000000000a5";
const B5 = "cil_00000000000000b5";
const C3 = "cil_00000000000000c3";
const LIB = [illust(A5, 5, { title: "5단계 화살표" }), illust(B5, 5, { title: "5단계 원형", groups: 3 }), illust(C3, 3, { title: "3조각 순환" })];

function processBlock(o: ReturnType<typeof page>["outline"]): InfoBlock {
  return o.blocks.find((b): b is InfoBlock => b.kind === "info" && b.type === "process" && b.content.items.length === 5)!;
}

function choices(o: ReturnType<typeof page>["outline"], item: { type: string }): Record<string, ShapeChoice[]> {
  const out: Record<string, ShapeChoice[]> = {};
  for (const b of o.blocks) if (b.kind === "info") out[b.id] = shapeChoices(LIB, b, item.type);
  return out;
}

test("일러스트 후보 — 항목 수 같은 자산만, 무리 수·추천 이유·지금 쓰는 그림 표시", () => {
  const { outline, item } = page();
  const b = processBlock(outline);
  const list = shapeChoices(LIB, b, item.type);
  assert.deepEqual(list.map((c) => c.id).sort(), [A5, B5].sort(), "3항목 그림은 5단계 자리 후보가 아니다");
  assert.equal(list.find((c) => c.id === B5)!.groups, 3);
  assert.ok(list[0].reasons.some((r) => r.includes("항목 수 5")));
  const withCur = shapeChoices(LIB.slice(2), { ...b, illust: { asset: A5 } }, item.type);
  assert.equal(withCur.length, 0, "라이브러리에 없는 지금 그림은 후보에 넣지 않는다(정보를 모름)");
  const cur = shapeChoices(LIB, { ...b, illust: { asset: A5 } }, item.type);
  assert.ok(cur.find((c) => c.id === A5)?.current);
});

test("모양 연산 — 후보 일러스트·색 모드·분야 토큰·맞춤만 받고, 후보 밖 id·항목 수 다름·hex·좌표는 버린다", () => {
  const { outline, tree, metrics, item } = page();
  const b = processBlock(outline);
  const illusts = choices(outline, item);
  const run = (op: Record<string, unknown>) => validatePatch({ outline, tree, metrics, illusts, source: "ai", ops: [op] });

  const ok = run({ op: "shape", id: b.id, illust: { asset: B5, colors: { mode: "areas", map: { "0": "area-4", "2": "brand", "7": "area-1", i2: "#ff0000", i3: "accent-2", i9: "brand" } }, fit: "width" } });
  assert.equal(ok.changes.length, 1);
  const c = ok.changes[0];
  assert.equal(c.kind, "shape");
  assert.equal(c.illust, B5);
  assert.ok(c.recolor, "색 바뀜");
  assert.deepEqual(c.edit?.info?.illust, { asset: B5, colors: { mode: "areas", map: { "0": "area-4", "2": "brand", i3: "accent-2" } }, fit: "width" });
  assert.ok(c.flags.some((f) => f.kind === "color" && /3곳/.test(f.message)), "그림에 없는 무리(7)·hex·없는 항목(i9) 3곳은 뺐다고 알림");
  assert.ok(c.after.some((l) => l.includes("5단계 원형")) && c.after.some((l) => l.includes("분야 6색")) && c.after.some((l) => l.includes("자리 폭 전체")));
  assert.ok(c.before.some((l) => l.startsWith("모양: 기본 도식")));

  assert.equal(run({ op: "shape", id: b.id, illust: { asset: C3 } }).changes.length, 0, "후보 밖(항목 수 다른) 그림");
  assert.match(run({ op: "shape", id: b.id, illust: { asset: C3 } }).dropped[0], /후보에 없는 일러스트/);
  assert.match(run({ op: "shape", id: b.id, illust: { asset: "cil_ffffffffffffffff" } }).dropped[0], /후보에 없는/);
  const bad = run({ op: "shape", id: b.id, illust: { asset: A5, colors: { mode: "neon" } }, left: "12px", fill: "#123456" });
  assert.equal(bad.changes.length, 1);
  assert.ok(bad.changes[0].flags.some((f) => /모르는 색 모드/.test(f.message)));
  assert.ok(bad.dropped.some((d) => /left, fill/.test(d)), "받지 않는 키는 버리고 알린다");
  assert.equal(bad.changes[0].edit?.info?.illust?.colors, undefined, "모르는 모드면 색 설정 없음(기본 = 분야 색)");

  // 기본 도식 그대로 변형·색 모드만
  const v = run({ op: "shape", id: b.id, variant: "chevron-zzz", colorMode: "mono" });
  assert.equal(v.changes[0].edit?.info?.colorMode, "mono");
  assert.equal(v.changes[0].edit?.info?.type, "process", "변형·색 모드는 유형과 함께 저장(정리 때 유형 기준 검사)");
  assert.ok(v.changes[0].flags.some((f) => /없는 변형/.test(f.message)));
  assert.equal(run({ op: "shape", id: b.id, colorMode: "area" }).changes.length, 0, "이미 분야 색이면 바뀜 없음");
});

test("모양 채택 → setInfo 로 편집층에 일러스트가 얹히고, 되돌리기(null)·항목 수 바뀜은 기본 도식으로", () => {
  const p = page();
  const b = processBlock(p.outline);
  const illusts = choices(p.outline, p.item);
  const { changes } = validatePatch({ outline: p.outline, tree: p.tree, metrics: p.metrics, illusts, source: "ai", ops: [{ op: "shape", id: b.id, illust: { asset: A5 } }] });
  const edits = sanitizePageEdits(applyChanges({ v: 1 }, changes, p.tree));
  assert.deepEqual(edits.nodes?.[b.id]?.info?.illust, { asset: A5 });
  // 다시 그린 쪽의 인포그래픽 자리가 그 일러스트를 쓴다
  const q = page(edits);
  const b2 = processBlock(q.outline);
  assert.equal(b2.illust?.asset, A5);
  const props = (function find(n: CNode): InfoSlotProps | null {
    if (n.id === b.id && n.props) return n.props as unknown as InfoSlotProps;
    for (const ch of n.children ?? []) {
      const r = find(ch);
      if (r) return r;
    }
    return null;
  })(q.tree);
  assert.equal(props?.spec.illust?.asset, A5);

  // 색만 바꾸면 같은 그림을 이어 쓴다(asset 생략)
  const recolor = validatePatch({ outline: q.outline, tree: q.tree, metrics: q.metrics, illusts: choices(q.outline, q.item), source: "ai", ops: [{ op: "shape", id: b.id, illust: { colors: { mode: "brand" } } }] });
  assert.deepEqual(recolor.changes[0].edit?.info?.illust, { asset: A5, colors: { mode: "brand" } });
  assert.ok(recolor.changes[0].recolor);

  // 되돌리기
  const back = validatePatch({ outline: q.outline, tree: q.tree, metrics: q.metrics, illusts: choices(q.outline, q.item), source: "ai", ops: [{ op: "shape", id: b.id, illust: null }] });
  const e3 = sanitizePageEdits(applyChanges(edits, back.changes, q.tree));
  assert.equal(processBlock(page(e3).outline).illust, undefined);

  // 같은 자리 내용 바꿈(항목 3개로) + 모양 — 내용 바꿈이 먼저 적용되고, 5단계 그림은 안 맞아 버린다
  const items3 = b.content.items.slice(0, 3).map((it) => ({ label: it.label }));
  const both = validatePatch({ outline: q.outline, tree: q.tree, metrics: q.metrics, illusts: choices(q.outline, q.item), source: "ai", ops: [{ op: "shape", id: b.id, illust: { asset: B5 } }, { op: "info", id: b.id, items: items3 }] });
  assert.equal(both.changes.length, 1);
  assert.equal(both.changes[0].kind, "info");
  assert.equal(both.changes[0].edit?.info?.illust, null, "항목 수가 바뀌면 일러스트를 뗀다");
  assert.ok(both.changes[0].flags.some((f) => /기본 도식으로 그립니다/.test(f.message)));
  assert.ok(both.dropped.some((d) => /항목 5개 그림인데 내용은 3개/.test(d)));
});

test("톤 맞추기(style) — 글자·바탕 색은 토큰만, 대비 4.5:1 미만은 흰/짙은 글자로 대체, 추가한 글상자도", () => {
  const { outline, tree, metrics } = page();
  const lead = outline.blocks.find((b): b is TextBlock => b.kind === "text" && b.role === "lead")!;
  const run = (op: Record<string, unknown>, o = outline, t = tree) => validatePatch({ outline: o, tree: t, metrics, area: 4, source: "ai", ops: [op] });

  const ok = run({ op: "style", id: lead.id, color: "area-4" });
  assert.equal(ok.changes.length, 1);
  assert.equal(ok.changes[0].kind, "style");
  assert.deepEqual(ok.changes[0].style, { color: "var(--area-4)" });
  assert.ok(ok.changes[0].recolor);

  const tint = run({ op: "style", id: lead.id, color: "area-4-tint" });
  assert.match(tint.dropped[0] ?? "", /토큰만/, "옅은 면 색은 글자 팔레트에 없다");
  const hex = run({ op: "style", id: lead.id, color: "#ff0000" });
  assert.equal(hex.changes.length, 0);
  assert.match(hex.dropped[0], /디자인 토큰만/);

  const dark = run({ op: "style", id: lead.id, background: "brand" });
  assert.deepEqual(dark.changes[0].style, { color: "var(--on-brand)", background: "var(--brand)" }, "남색 바탕의 짙은 글자 → 흰 글자");
  assert.ok(dark.changes[0].flags.some((f) => f.kind === "contrast" && /흰 글자/.test(f.message)));
  const pale = run({ op: "style", id: lead.id, color: "on-brand" });
  assert.deepEqual(pale.changes[0].style, { color: "var(--ink)" }, "흰 바탕의 흰 글자 → 짙은 글자");

  const extra = run({ op: "style", id: lead.id, color: "brand", fontSize: "30px" });
  assert.ok(extra.dropped.some((d) => /fontSize/.test(d)));

  const info = processBlock(outline);
  assert.match(run({ op: "style", id: info.id, color: "brand" }).dropped[0], /맞지 않는 연산/, "인포그래픽은 shape 로");

  // 채택 → 편집층 스타일(patchNodeStyle) → 다시 그린 쪽에 반영
  const edits = sanitizePageEdits(applyChanges({ v: 1 }, dark.changes, tree));
  assert.deepEqual(edits.nodes?.[lead.id]?.style, { color: "var(--on-brand)", background: "var(--brand)" });
  const again = page(edits).outline.blocks.find((b): b is TextBlock => b.id === lead.id)!;
  assert.equal(again.color, "on-brand");
  assert.equal(again.background, "brand");

  // 같은 자리 글 바꿈 + 색 바꿈은 따로 고를 수 있다
  const pair = validatePatch({ outline, tree, metrics, area: 4, source: "ai", ops: [{ op: "style", id: lead.id, color: "brand" }, { op: "text", id: lead.id, text: "ESG 경영보고서와 공급망 실사를 수행합니다." }] });
  assert.deepEqual(pair.changes.map((c) => c.kind), ["text", "style"]);
  assert.notEqual(pair.changes[0].id, pair.changes[1].id);
  const e2 = sanitizePageEdits(applyChanges({ v: 1 }, pair.changes, tree));
  assert.ok(e2.nodes?.[lead.id]?.content && e2.nodes[lead.id].style?.color === "var(--brand)");

  // 추가한 글상자 — 개요에 색 자리로 나오고 색이 추가 요소에 들어간다
  const withBox = addElement({ v: 1 }, { id: "u_box1", tag: "div", className: "kc-x-text", style: { position: "absolute", left: "48px", top: "500px", width: "200px" }, children: [{ id: "u_t1", tag: "#text", text: "현장 문의" }] });
  const q = page(withBox);
  const box = q.outline.blocks.find((b): b is AddedBlock => b.kind === "added")!;
  assert.ok(box && box.element === "text" && box.text === "현장 문의");
  const boxed = validatePatch({ outline: q.outline, tree: q.tree, metrics, area: 4, source: "ai", ops: [{ op: "style", id: box.id, color: "area-4" }, { op: "text", id: box.id, text: "바꿈" }] });
  assert.equal(boxed.changes.length, 1, "추가한 글상자의 글은 AI 가 고치지 않는다");
  const e3 = sanitizePageEdits(applyChanges(withBox, boxed.changes, q.tree));
  assert.equal(e3.added?.[0].style?.color, "var(--area-4)");
});

test("규칙 대체안 — '분야 색으로 통일'·'일러스트로' 지시를 모양 연산으로", () => {
  const p = page();
  const b = processBlock(p.outline);
  const illusts = choices(p.outline, p.item);
  const mono = { ...p.outline, blocks: p.outline.blocks.map((x) => (x.id === b.id ? { ...b, colorMode: "mono" as const } : x)) };
  const tone = ruleEditOps(mono, "이 쪽 색을 분야 색으로 통일해", p.metrics, { illusts });
  assert.ok(tone.ops.some((o) => o.op === "shape" && o.id === b.id && o.colorMode === "area"));
  const pic = ruleEditOps(p.outline, "절차 도식을 일러스트로 바꿔", p.metrics, { illusts });
  const op = pic.ops.find((o) => o.op === "shape");
  assert.ok(op && op.op === "shape" && op.illust && [A5, B5].includes(op.illust.asset as string));
  const r = validatePatch({ outline: p.outline, tree: p.tree, metrics: p.metrics, illusts, source: "rule", ops: pic.ops });
  assert.equal(r.changes[0]?.kind, "shape");
  const none = ruleEditOps(p.outline, "일러스트로", p.metrics, { illusts: {} });
  assert.ok(none.missed.some((m) => /일러스트가 라이브러리에 없습니다/.test(m)));
});

test("넘침 축약(G) — 일러스트 제목 뒤 지표 칩은 칩 폭까지 세고 {{metric}} 표식으로 넘겨 지우지 못하게", () => {
  const metrics = metricBriefs(makeFixture().metrics);
  const metricId = Object.keys(metrics).find((k) => metrics[k].value != null && metrics[k].value! >= 100)!;
  const content = {
    items: [
      { id: "a", label: "현장 조사와 자료 수집", metric: metricId, value: metrics[metricId].value!, unit: "건" },
      { id: "b", label: "계획서 작성", metric: metricId, value: metrics[metricId].value!, unit: "건" },
      { id: "c", label: "허가 신청" },
    ],
  };
  const ill = illust("cil_0000000000000ab3", 3, { numbered: [2] });
  registerIllustrations([{ info: ill, svg: "<svg/>" }]);
  assert.deepEqual([...suffixItems(ill, content)], [0], "숫자 자리가 있는 2번·지표 없는 3번은 칩 없음");
  assert.deepEqual([...chipItems(ill.assetId, content)], [0]);
  assert.equal(chipItems("cil_ffffffffffffffff", content).size, 0, "불러오지 않은 그림은 칩을 모른다");

  const items = infoFitItems("x", content, "process", ill.assetId, metrics, { label: 0.85, desc: 0.8 });
  const first = items.find((i) => i.key === "x@0.label")!;
  assert.equal(first.text, `현장 조사와 자료 수집 {{metric:${metricId}}}`);
  const valueLen = charLen(`{{metric:${metricId}}}`, metrics);
  const chip = valueLen + 1;
  const full = charLen("현장 조사와 자료 수집", metrics) + chip;
  assert.equal(first.maxChars - valueLen, Math.min(12, Math.max(4, Math.floor(full * 0.85) - chip)), "라벨 몫 = 전체(칩 포함)×비율 − 칩");
  const plain = infoFitItems("x", content, "process", undefined, metrics, { label: 0.85, desc: 0.8 }).find((i) => i.key === "x@0.label")!;
  assert.ok(first.maxChars - valueLen <= plain.maxChars, "칩이 있으면 라벨 몫이 같거나 더 작다");

  // 응답 → 라벨(표식은 떼고), 표식을 지운 응답도 라벨만 남는다(칩은 지표로 다시 그려짐)
  const got = new Map([["x@0.label", `현장 조사 {{metric:${metricId}}}`], ["x@1.label", "계획서"]]);
  const out = fittedItems("x", content, ill.assetId, got);
  assert.equal(out[0].label, "현장 조사");
  assert.equal(out[0].metric, metricId, "지표 바인딩 유지");
  assert.equal(out[1].label, "계획서");
  assert.equal(fittedItems("x", content, ill.assetId, new Map([["x@0.label", `{{metric:${metricId}}}`]]))[0].label, "현장 조사와 자료 수집", "라벨이 비면 원래 라벨");

  // 규칙 줄이기도 칩 표식을 남긴다
  const s = ruleShorten(`현장 조사와 자료 수집 및 분석 {{metric:${metricId}}}`, 6 + valueLen, metrics);
  assert.ok(s.includes(`{{metric:${metricId}}}`), s);

  // 넘친 글(제목 + 칩 값) → 그 바꿈을 대상으로
  const shape = { id: "s1", kind: "shape" as const, label: "인포그래픽", before: [], after: ["모양: 일러스트 '그림'"], flags: [], source: "ai" as const, content, illust: ill.assetId };
  const other = { id: "t1", kind: "text" as const, label: "리드", before: [], after: ["다른 글입니다 다른 글입니다"], flags: [], source: "ai" as const };
  const style = { id: "t1~style", kind: "style" as const, label: "리드", before: [], after: [], flags: [], source: "ai" as const, style: { color: "var(--brand)" } };
  const v = metrics[metricId].value!.toLocaleString("en-US");
  assert.deepEqual(overflowTargets([shape, other, style], [`현장 조사와 자료 수집 ${v}건`], metrics).map((c) => c.id), ["s1"]);
  assert.deepEqual(overflowTargets([shape, other, style], ["찾을 수 없는 글자"], metrics).map((c) => c.id), ["s1", "t1"], "색 바꿈은 줄일 대상이 아니다");
});

test("프롬프트 — 모양·색은 토큰·모양 id 로만, 좌표·hex 금지", () => {
  assert.match(SECTION_WRITE_SYSTEM, /토큰 이름·모양 id 로만/);
  assert.match(SECTION_WRITE_SYSTEM, /hex/);
  assert.match(SECTION_WRITE_SYSTEM, /"op": "shape"/);
  assert.match(SECTION_WRITE_SYSTEM, /"op": "style"/);
  assert.match(SECTION_WRITE_SYSTEM, /색·톤만 말하면[^\n]*일러스트를 새로 넣거나 바꾸지 않습니다/, "톤 지시로 그림을 바꾸지 않게");
  assert.doesNotMatch(SECTION_WRITE_SYSTEM, /배치·색·좌표·글자 크기·쪽 구성은 바꾸지 않습니다/);
});
