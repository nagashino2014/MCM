// 회사소개서 스튜디오(P5) 핵심 시험 — 쪽 계획 → 노드 트리 변환 충실도, 편집층 적용·정리, 데이터 갱신 뒤 편집 유지, 인포그래픽 매칭.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPagePlan } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { CatalogRenderData, RenderCtx, RenderOptions } from "@/lib/catalog/render/types";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import { STUDIO_PRINT_CSS, composeDocument } from "@/lib/catalog/studio/compose";
import { resizeBox } from "@/lib/catalog/studio/design-system";
import { elementToTree } from "@/lib/catalog/studio/convert";
import { orderPlan, type StudioPageState } from "@/lib/catalog/studio/doc";
import {
  addElement,
  anchorMatches,
  anchorOf,
  anchorPins,
  applyEdits,
  dropOrphanEdits,
  duplicateNode,
  editsWithin,
  orphanEdits,
  resetNode,
  hideNode,
  listItemOp,
  pasteNodes,
  patchNodeStyle,
  sanitizePageEdits,
  setInfo,
  setNodeContent,
  setNodeType,
  snapshotNode,
  type PageEdits,
} from "@/lib/catalog/studio/edits";
import { BIND_GROUP_ORDER, DATA_BINDS, bindOptions, makeBindChip, resolveBind } from "@/lib/catalog/studio/binds";
import { CARET_ID, appendCaret, caretNode, collectChips, fromEditableDom, placeChip } from "@/lib/catalog/studio/inline";
import { findNode, textOf, type CNode } from "@/lib/catalog/studio/nodes";
import { capabilities, outermost, parentSelection, resolveSelection } from "@/lib/catalog/studio/select";
import { findOverlaps, intersectRect, isMovedNode, movedNodes, textBoxNodes, type OverlapBox } from "@/lib/catalog/studio/overlap";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
import { makeFixture } from "./catalog-studio-fixture";
import { SOFTWARE_PRODUCTS } from "@/lib/catalog/areas";
import { SOFTWARE_CONTENT } from "@/lib/catalog/render/master-content";

const COVER: CoverChoice = { cover: "leaf", photo: "k/assets/hq-cover-tall.webp" };
const ctxOf = (opts: RenderOptions = { edition: "print", naming: "masked" }): RenderCtx => ({ url: (k) => `/x/${k}`, opts, docLabel: "회사소개서 2026.10", fontSet: "pretendard", concept: "navy" });

/** HTML 을 속성 순서와 무관하게 비교하는 모양으로(태그·정렬한 속성·글자) */
interface HNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: HNode[];
}
function canon(html: string): unknown {
  const conv = (n: HNode): unknown =>
    n.type === "text"
      ? n.data
      : { t: n.name, a: Object.entries(n.attribs ?? {}).sort(([x], [y]) => x.localeCompare(y)), c: (n.children ?? []).map(conv) };
  return ((parseDocument(html) as unknown as HNode).children ?? []).map(conv);
}

function walk(n: CNode, fn: (n: CNode) => void) {
  fn(n);
  n.children?.forEach((c) => walk(c, fn));
}
function findBy(root: CNode, pred: (n: CNode) => boolean): CNode | null {
  let hit: CNode | null = null;
  walk(root, (n) => {
    if (!hit && pred(n)) hit = n;
  });
  return hit;
}
const hasClass = (cls: string) => (n: CNode) => (n.className ?? "").split(/\s+/).includes(cls);
const pageTree = (data: CatalogRenderData, key: string) => {
  const item = buildPagePlan(ctxOf(), data, COVER).find((p) => p.key === key)!;
  return elementToTree(item.element, key);
};

test("변환 충실도 — 편집 없는 노드 트리는 쪽 컴포넌트와 같은 HTML", () => {
  for (const opts of [
    { edition: "print", naming: "masked" },
    { edition: "draft", naming: "real" },
  ] as RenderOptions[]) {
    const data = makeFixture();
    const ctx = ctxOf(opts);
    const plan = buildPagePlan(ctx, data, COVER);
    assert.ok(plan.length > 20, `쪽 수 ${plan.length}`);
    for (const p of plan) {
      const direct = renderToStaticMarkup(createElement(Fragment, null, p.element));
      const viaTree = renderToStaticMarkup(renderTrees([elementToTree(p.element, p.key)], { url: ctx.url, data }));
      assert.deepEqual(canon(viaTree), canon(direct), `쪽 ${p.key} 이 다르게 그려짐`);
    }
  }
});

test("쪽 키·노드 id 는 데이터가 바뀌어도 그대로(목록 뒤 형제 포함)", () => {
  const a = buildPagePlan(ctxOf(), makeFixture(), COVER).map((p) => p.key);
  const b = buildPagePlan(ctxOf(), makeFixture({ extraContract: true }), COVER).map((p) => p.key);
  assert.deepEqual(b, a);
  const ta = pageTree(makeFixture(), "area-1");
  const tb = pageTree(makeFixture({ extraContract: true }), "area-1");
  const lead = (t: CNode) => findBy(t, (n) => hasClass("kc-lead")(n))!;
  assert.equal(lead(ta).id, lead(tb).id);
  const proc = (t: CNode) => findBy(t, (n) => n.widget === "infographic" && (n.props as { slot: string }).slot === "area-1.process")!;
  assert.equal(proc(ta).id, proc(tb).id);
  const cases = (t: CNode) => findBy(t, (n) => n.widget === "cases")!;
  assert.equal(cases(ta).id, cases(tb).id);
  assert.equal(cases(tb).children!.length, cases(ta).children!.length + 1, "대표 실적이 하나 늘어야 함");
  // 대표 실적 목록 뒤 형제(각주)도 같은 id
  const foot = (t: CNode) => findBy(t, hasClass("kc-footnote"))!;
  assert.equal(foot(ta).id, foot(tb).id);
});

test("데이터 갱신 뒤에도 편집 유지 — 글·이동·유형·숨김·추가·고정 글 속 지표", () => {
  const before = makeFixture();
  const after = makeFixture({ extraContract: true });
  // area-1 쪽 편집
  const base0 = pageTree(before, "area-1");
  let edits: PageEdits = { v: 1 };
  let derived = applyEdits(base0, edits);
  const lead = findBy(derived, hasClass("kc-lead"))!;
  edits = setNodeContent(edits, derived, lead.id, [{ id: "uaaaaaaaa", tag: "#text", text: "사용자가 고친 리드 문장입니다." }]);
  derived = applyEdits(base0, edits);
  const kpis = findBy(derived, hasClass("kc-kpis"))!;
  edits = patchNodeStyle(edits, derived, kpis.id, { position: "relative", left: "64.17px", top: "8px" });
  const proc = findBy(derived, (n) => n.widget === "infographic")!;
  edits = setInfo(edits, proc.id, { type: "cycle" });
  derived = applyEdits(base0, edits);
  const services = findBy(derived, hasClass("kc-list"))!;
  edits = hideNode(edits, derived, services.id);
  edits = addElement(edits, {
    id: "ubbbbbbbb",
    tag: "div",
    className: "kc-x-text",
    style: { position: "absolute", left: "48px", top: "520px", width: "361px" },
    typeStep: "caption",
    children: [{ id: "ucccccccc", tag: "#text", text: "추가한 글상자" }],
  });
  // 저장·불러오기(정리) 왕복
  edits = sanitizePageEdits(JSON.parse(JSON.stringify(edits)));

  const base1 = pageTree(after, "area-1");
  const d1 = applyEdits(base1, edits);
  assert.equal(textOf(findBy(d1, hasClass("kc-lead"))!), "사용자가 고친 리드 문장입니다.");
  const k1 = findBy(d1, hasClass("kc-kpis"))!;
  assert.equal(k1.style?.left, "64.17px");
  assert.equal(k1.style?.position, "relative");
  assert.ok(findBy(d1, hasClass("kc-orbit")), "단계 흐름이 순환 도식으로 바뀌어 있어야 함");
  assert.equal(findBy(d1, hasClass("kc-list")), null, "주요 서비스 목록은 숨김");
  const box = findBy(d1, hasClass("kc-x-text"))!;
  assert.equal(textOf(box), "추가한 글상자");
  assert.equal(box.style?.fontSize, "8.5px", "캡션 단계 글자 크기");
  // 데이터 쪽은 새 값으로
  assert.match(textOf(findBy(d1, (n) => n.widget === "cases")!), /가상발전 신규 사업장/);

  // c04: 지표 칩이 든 문장을 고정해도 숫자는 최신 값
  const c4a = pageTree(before, "c04");
  const statement = findBy(c4a, hasClass("kc-statement"))!;
  const chip = statement.children!.find((c) => c.bind === "metric:permit.initial.completed")!;
  let e4: PageEdits = { v: 1 };
  e4 = setNodeContent(e4, applyEdits(c4a, e4), statement.id, [{ id: "udddddddd", tag: "#text", text: "고친 문장 — 최초허가 " }, chip]);
  e4 = sanitizePageEdits(JSON.parse(JSON.stringify(e4)));
  const html = renderToStaticMarkup(renderTrees([applyEdits(pageTree(after, "c04"), e4)], { url: (k) => k, data: after }));
  assert.match(html, /고친 문장 — 최초허가 <em data-metric="permit.initial.completed">41<!-- -->?건<\/em>|고친 문장 — 최초허가 <em data-metric="permit.initial.completed">41건<\/em>/);
});

test("목록 항목 추가·삭제·순서 — 처음 조작 때 목록을 고정하고 이어서 조작", () => {
  const base = pageTree(makeFixture(), "area-2");
  let edits: PageEdits = { v: 1 };
  let d = applyEdits(base, edits);
  const list = findBy(d, hasClass("kc-list"))!;
  const n0 = list.children!.length;
  edits = listItemOp(edits, d, list.children![0].id, "duplicate");
  d = applyEdits(base, edits);
  let l2 = findNode(d, list.id)!;
  assert.equal(l2.children!.length, n0 + 1);
  assert.ok(l2.pinned);
  edits = listItemOp(edits, d, l2.children![n0].id, "up");
  d = applyEdits(base, edits);
  edits = listItemOp(edits, d, findNode(d, list.id)!.children![0].id, "remove");
  d = applyEdits(base, edits);
  l2 = findNode(d, list.id)!;
  assert.equal(l2.children!.length, n0);
  // 고정한 항목 안의 글 고치기
  edits = setNodeContent(edits, d, l2.children![0].id, [{ id: "ueeeeeeee", tag: "#text", text: "새 서비스" }]);
  d = applyEdits(base, edits);
  assert.equal(textOf(findNode(d, list.id)!.children![0]), "새 서비스");
  // 타입 스케일 단계
  edits = setNodeType(edits, d, list.id, "lead");
  d = applyEdits(base, edits);
  assert.equal(findNode(d, list.id)!.style?.fontSize, "13px");
});

test("편집층 정리 — 스크립트·외부 주소·비토큰 색·모르는 키를 버린다", () => {
  const dirty = {
    v: 1,
    nodes: {
      nabc123: {
        content: [
          { id: "x1", tag: "script", children: [{ id: "x2", tag: "#text", text: "alert(1)" }] },
          { id: "uaaaaaaaa", tag: "span", attrs: { onclick: "alert(1)", href: "javascript:alert(1)", "data-ref": "c04" }, style: { color: "#ff0000", background: "url(http://x)", fontWeight: 700 }, children: [{ id: "u1", tag: "#text", text: "ok" }] },
          { id: "ubbbbbbbb", tag: "img", attrs: { src: "http://evil" } },
        ],
        style: { color: "red", left: "64px", position: "fixed", width: "calc(100% - 1px)", background: "var(--brand-tint)" },
        type: "nope",
        info: { type: "bogus" },
        image: { key: "../../etc/passwd" },
      },
      "bad id": { hidden: true },
    },
    added: [{ id: "ucccccccc", tag: "div", className: "kc-x-text", style: { position: "fixed", left: "10px", top: "10px", width: "100px" }, children: [{ id: "u9", tag: "iframe" }] }],
    variant: { hero: "photo", photo: "https://evil/x.png", ok: "a/cas_1" },
  };
  const clean = sanitizePageEdits(dirty);
  const ne = clean.nodes!.nabc123;
  assert.equal(ne.content!.length, 1, "script·img 는 빠짐");
  const span = ne.content![0];
  assert.deepEqual(span.attrs, { "data-ref": "c04" });
  assert.deepEqual(span.style, { fontWeight: 700 });
  assert.deepEqual(ne.style, { left: "64px", background: "var(--brand-tint)" });
  assert.equal(ne.type, undefined);
  assert.equal(ne.image, undefined);
  assert.equal(clean.nodes!["bad id"], undefined);
  assert.equal(clean.added!.length, 1);
  assert.equal(clean.added![0].style!.position, "absolute");
  assert.equal(textOf(clean.added![0]), "");
  assert.deepEqual(clean.variant, { hero: "photo", ok: "a/cas_1" });
});

test("쪽 순서·숨김 — 새로 생긴 쪽은 쪽 계획의 자리에, 숨긴 쪽은 출력에서 빠짐", () => {
  const plan = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  const pages: StudioPageState[] = [
    { key: "c", order: 0, hidden: false, edits: { v: 1 } },
    { key: "a", order: 1, hidden: false, edits: { v: 1 } },
    { key: "d", order: 2, hidden: false, edits: { v: 1 } },
  ];
  assert.deepEqual(
    orderPlan(plan, pages).map((p) => p.key),
    ["c", "a", "b", "d"]
  );
  const data = makeFixture();
  const composed = composeDocument(ctxOf(), data, COVER, [{ key: "c02", order: null, hidden: true, edits: { v: 1 } }]);
  assert.ok(!composed.some((p) => p.item.key === "c02"));
  assert.ok(composed.some((p) => p.item.key === "c04"));
});

test("인포그래픽 매칭 — 목록은 수치형을 막고, 순환어는 순환을 앞에, 자리 높이를 본다", () => {
  const steps = {
    title: "허가 이후 사후관리",
    items: ["허가조건 이행", "자가측정·기록", "정기검사 대응", "변경허가·신고", "허가 재검토"].map((label, i) => ({ id: `s${i}`, label })),
  };
  const tall = matchInfographic(steps, { box: { w: 420, h: 260 }, current: "process" });
  assert.ok(tall.blocked.some((b) => b.type === "bar"));
  assert.ok(tall.blocked.some((b) => b.type === "matrix"));
  assert.equal(tall.candidates[0].type, "cycle");
  const low = matchInfographic(steps, { box: { w: 490, h: 90 }, current: "process" });
  assert.equal(low.candidates[0].type, "process");
  const nums = { items: [{ id: "a", label: "수도권", value: 10, region: "capital" }, { id: "b", label: "중부권", value: 5, region: "central" }, { id: "c", label: "호남권", value: 3, region: "honam" }] };
  const m = matchInfographic(nums, { box: { w: 233, h: 200 }, current: "bar" });
  assert.ok(m.candidates.some((c) => c.type === "map"));
  assert.ok(m.candidates.some((c) => c.type === "share"));
  assert.ok(m.blocked.some((b) => b.type === "process"));
});

/** htmlparser2 노드 → DOM 모양(역파싱 입력) */
function domOf(html: string): unknown {
  const text = (n: HNode): string => (n.type === "text" ? n.data ?? "" : (n.children ?? []).map(text).join(""));
  const adapt = (n: HNode): unknown =>
    n.type === "text"
      ? { nodeType: 3, textContent: n.data ?? "", childNodes: [] }
      : { nodeType: 1, tagName: (n.name ?? "").toUpperCase(), textContent: text(n), childNodes: (n.children ?? []).map(adapt), getAttribute: (k: string) => n.attribs?.[k] ?? null };
  return adapt(((parseDocument(`<div>${html}</div>`) as unknown as HNode).children ?? [])[0]);
}

test("지표 넣기 — 커서 자리 칩, 저장 왕복, 데이터 갱신 뒤 새 값, 편집 전 상태로 되돌리기", () => {
  const before = makeFixture();
  const after = makeFixture({ extraContract: true });
  const base0 = pageTree(before, "area-1");
  let edits: PageEdits = { v: 1 };
  const derived = applyEdits(base0, edits);
  const lead = findBy(derived, hasClass("kc-lead"))!;

  // 편집 DOM 의 커서 자리 표식 → 표식 노드(굵게 안쪽 포함)
  const chips = collectChips(lead.children ?? []);
  chips.set(CARET_ID, caretNode());
  const parsed = fromEditableDom(domOf(`앞 글 <b>굵게<span data-chip="${CARET_ID}"></span></b> 뒤 글`) as never, chips);
  assert.equal(parsed[1].tag, "b");
  assert.equal(parsed[1].children?.[1]?.id, CARET_ID, "표식은 굵게 안 커서 자리");

  const chip = makeBindChip("metric:permit.initial.completed", before, { digits: 0 })!;
  assert.equal(textOf(chip), "40건", "지금 값 + 단위");
  assert.equal(chip.attrs?.["data-metric"], "permit.initial.completed");
  const placed = placeChip(parsed, chip);
  assert.equal(placed[1].children?.[1]?.bind, "metric:permit.initial.completed", "표식 자리에 칩");
  assert.equal(JSON.stringify(placed).includes(`"${CARET_ID}"`), false, "표식은 남지 않음");

  const saved = edits;
  edits = setNodeContent(edits, derived, lead.id, placed);
  // 데이터 칩(설립 연월)·단위 없는 칩도 끝에 넣는다
  const d2 = applyEdits(base0, edits);
  const lead2 = findBy(d2, hasClass("kc-lead"))!;
  const founded = makeBindChip("data:company.founded", before)!;
  edits = setNodeContent(edits, d2, lead2.id, placeChip(appendCaret(lead2.children ?? []), founded));
  edits = sanitizePageEdits(JSON.parse(JSON.stringify(edits)));

  const after2 = { ...after, company: { ...after.company, foundedYear: "2011", foundedMonth: "4" } };
  const html = renderToStaticMarkup(renderTrees([applyEdits(pageTree(after2, "area-1"), edits)], { url: (k) => k, data: after2 }));
  assert.match(html, /<span data-metric="permit.initial.completed">41(<!-- -->)?건<\/span>/, "계약 1건 추가 뒤 41건");
  assert.match(html, /<span data-bind="company.founded">2011년 4월<\/span>/, "설립 연월도 새 값");
  const out = applyEdits(pageTree(after2, "area-1"), edits);
  const kept = findBy(out, (n) => n.bind === "metric:permit.initial.completed" && n.origin !== "base")!;
  assert.equal(kept.bindDigits, 0, "자릿수 옵션 유지");

  // 되돌리기 = 넣기 전 편집층 → 칩 없음
  const undone = applyEdits(pageTree(after, "area-1"), saved);
  assert.equal(findBy(findBy(undone, hasClass("kc-lead"))!, (n) => n.bind === "metric:permit.initial.completed"), null);
});

test("지표 넣기 목록 — 지원 데이터 항목·묶음 순서·정리 규칙", () => {
  const data = makeFixture();
  const opts = bindOptions(data);
  const groups = [...new Set(opts.map((o) => o.group))];
  assert.deepEqual(groups, BIND_GROUP_ORDER.filter((g) => groups.includes(g)), "묶음 순서대로");
  assert.equal(opts.filter((o) => o.kind === "metric").length, Object.keys(data.metrics).length, "지표 사전 전부");
  for (const b of DATA_BINDS) assert.ok(opts.some((o) => o.bind === `data:${b.key}`), `데이터 항목 ${b.key}`);
  assert.equal(resolveBind("data:company.name", data), data.company.name);
  assert.equal(resolveBind("data:offices.0.phone", data), null, "목록에 없는 경로는 풀지 않음");
  assert.equal(makeBindChip("data:company.secret", data), null);
  assert.equal(makeBindChip("metric:nope.none", data), null);
  // 끝에 넣을 때 한 칸 띄움
  const tail = appendCaret([{ id: "uaaaaaaaa", tag: "#text", text: "기준" }]);
  assert.equal(tail[1].text, " ");
  // 저장 정리: 모르는 데이터 경로·자릿수 범위 밖은 버린다
  const clean = sanitizePageEdits({
    v: 1,
    nodes: { nabc: { content: [{ id: "ubbbbbbbb", tag: "span", bind: "data:company.secret", bindDigits: 9, children: [{ id: "ucccccccc", tag: "#text", text: "x" }] }] } },
  });
  const node = clean.nodes?.nabc?.content?.[0];
  assert.equal(node?.bind, undefined);
  assert.equal(node?.bindDigits, undefined);
});

test("스튜디오 — 복제: 추가 요소는 그대로·기본 글은 글상자·기본 사진은 이미지 상자로, 원본 오른쪽 아래 16px", () => {
  const base = pageTree(makeFixture(), "area-1");
  let edits: PageEdits = { v: 1 };
  let derived = applyEdits(base, edits);
  // 기본 글(리드) → 글상자, 글자 크기는 가장 가까운 단계
  const lead = findBy(derived, hasClass("kc-lead"))!;
  const leadSel = resolveSelection(derived, lead.id)!;
  assert.equal(capabilities(leadSel, 3).duplicate, true);
  assert.equal(capabilities(leadSel, 2).duplicate, false, "자유 배치(L3) 쪽에서만");
  const r1 = duplicateNode(edits, derived, lead.id, { x: 48, y: 200, w: 500, h: 40, fontPx: 13 })!;
  assert.ok(r1, "글 복제");
  edits = r1.edits;
  const copy = edits.added!.find((a) => a.id === r1.id)!;
  assert.equal(copy.className, "kc-x-text");
  assert.equal(copy.style?.left, "64px");
  assert.equal(copy.style?.top, "216px");
  assert.equal(copy.style?.width, "500px");
  assert.equal(textOf(copy), textOf(lead));
  // 추가 요소 복제 → 같은 모양, 자리만 16px 비킴, id 새로
  derived = applyEdits(base, edits);
  const r2 = duplicateNode(edits, derived, r1.id, { x: 64, y: 216, w: 500, h: 40 })!;
  edits = r2.edits;
  const copy2 = edits.added!.find((a) => a.id === r2.id)!;
  assert.notEqual(r2.id, r1.id);
  assert.equal(copy2.style?.left, "80px");
  assert.equal(copy2.style?.top, "232px");
  assert.equal(copy2.typeStep, copy.typeStep);
  // 데이터 영역·도식은 복제하지 않음
  const info = findBy(derived, (n) => n.widget === "infographic")!;
  assert.equal(capabilities(resolveSelection(derived, info.id)!, 3).duplicate, false);
  // 저장 왕복에도 사본이 남는다
  const round = sanitizePageEdits(JSON.parse(JSON.stringify(edits)));
  assert.equal(round.added?.length, 2);
  // 40개 한도
  const full: PageEdits = { v: 1, added: Array.from({ length: 40 }, (_, i) => ({ ...copy, id: `u${String(i).padStart(8, "0")}` })) };
  assert.equal(duplicateNode(full, applyEdits(base, full), "u00000000", { x: 0, y: 0, w: 10, h: 10 }), null);
});

test("스튜디오 — 복사·붙여넣기: 글은 지금 모양으로 찍고, 쪽을 옮겨도 붙으며 40개 한도를 지킨다", () => {
  const base = pageTree(makeFixture(), "area-1");
  const derived = applyEdits(base, { v: 1 });
  const lead = findBy(derived, hasClass("kc-lead"))!;
  const clip = snapshotNode({ v: 1 }, derived, lead.id, { x: 48, y: 200, w: 500, h: 40, fontPx: 13, textStyle: { fontSize: "13px", lineHeight: "1.5", fontWeight: "700", color: "var(--brand)" } })!;
  // 글 안 요소의 모양도 찍는다(부모 클래스에 기대던 안쪽 글) — 저장 왕복에도 남는다
  const inner: CNode = { id: "nouter", tag: "p", children: [{ id: "ninnert", tag: "#text", text: "제목" }, { id: "ninnerb", tag: "br" }, { id: "ninners", tag: "span", className: "kc-sub", children: [{ id: "ninnert2", tag: "#text", text: "부제" }] }] };
  const innerRoot: CNode = { id: "nroot", tag: "section", children: [inner] };
  const innerCopy = snapshotNode({ v: 1 }, innerRoot, "nouter", { x: 0, y: 0, w: 100, h: 20, fontPx: 20, childStyles: [{ fontSize: "9px", display: "block" }] })!;
  const innerRound = sanitizePageEdits({ v: 1, added: [innerCopy] }).added![0];
  const sub = innerRound.children!.find((c) => c.tag === "span")!;
  assert.equal(sub.style?.fontSize, "9px");
  assert.equal(sub.style?.display, "block");
  // 다른 쪽(빈 편집층)에 두 번 붙인다 — 붙일 때마다 비켜 놓이고 id 가 다르다
  const once = pasteNodes({ v: 1 }, [clip], 16);
  const twice = pasteNodes(once.edits, [clip], 32);
  assert.equal(once.ids.length, 1);
  const [a, b] = twice.edits.added!;
  assert.notEqual(a.id, b.id);
  assert.equal(a.style?.left, "64px");
  assert.equal(b.style?.top, "232px");
  assert.equal(textOf(a), textOf(lead));
  // 저장 왕복·그리기에서 글자 크기·색이 살아남고, 타입 단계보다 직접 지정이 우선한다
  const round = sanitizePageEdits(JSON.parse(JSON.stringify(twice.edits)));
  assert.equal(round.added?.[0].style?.fontSize, "13px");
  assert.equal(round.added?.[0].style?.color, "var(--brand)");
  const drawn = findNode(applyEdits(base, round), a.id)!;
  assert.equal(drawn.style?.fontSize, "13px");
  assert.equal(drawn.style?.lineHeight, "1.5");
  // 한도
  const full: PageEdits = { v: 1, added: Array.from({ length: 39 }, (_, i) => ({ ...a, id: `u${String(i).padStart(8, "0")}` })) };
  const r = pasteNodes(full, [clip, clip], 16);
  assert.equal(r.ids.length, 1, "40개까지만");
  assert.equal(r.edits.added?.length, 40);
});

test("스튜디오 — 목록 항목도 글자 크기를 바꿀 수 있다(표지 분야 목록·주요 서비스)", () => {
  const base = pageTree(makeFixture(), "area-1");
  const derived = applyEdits(base, { v: 1 });
  const list = findBy(derived, hasClass("kc-list"))!;
  const li = (list.children ?? []).find((c) => c.tag === "li")!;
  const sel = resolveSelection(derived, li.id)!;
  assert.equal(sel.kind, "item");
  assert.equal(capabilities(sel, 3).typeStep, true);
  assert.equal(capabilities(sel, 2).typeStep, false, "자유 배치 쪽에서만");
  const edits = patchNodeStyle({ v: 1 }, derived, li.id, { fontSize: "12px", lineHeight: "1.5" });
  assert.equal(findNode(applyEdits(base, edits), li.id)?.style?.fontSize, "12px");
});

test("스튜디오 — 글자 크기 직접 지정: 저장되고, 단계를 고르면 직접 지정을 지운다", () => {
  const base = pageTree(makeFixture(), "area-1");
  let derived = applyEdits(base, { v: 1 });
  const lead = findBy(derived, hasClass("kc-lead"))!;
  let edits = patchNodeStyle({ v: 1 }, derived, lead.id, { fontSize: "18px", lineHeight: "1.6" });
  assert.equal(findNode(applyEdits(base, edits), lead.id)?.style?.fontSize, "18px");
  assert.equal(sanitizePageEdits(JSON.parse(JSON.stringify(edits))).nodes?.[lead.id]?.style?.fontSize, "18px");
  // 범위 밖·단위 없는 값은 버린다
  assert.equal(patchNodeStyle({ v: 1 }, derived, lead.id, { fontSize: "999px" }).nodes?.[lead.id]?.style?.fontSize, undefined);
  assert.equal(patchNodeStyle({ v: 1 }, derived, lead.id, { fontSize: "url(x)" }).nodes?.[lead.id]?.style?.fontSize, undefined);
  derived = applyEdits(base, edits);
  edits = setNodeType(edits, derived, lead.id, "caption");
  assert.equal(edits.nodes?.[lead.id]?.style, undefined);
  assert.equal(edits.nodes?.[lead.id]?.type, "caption");
  // 추가한 글상자도 같다
  const box: CNode = { id: "ubbbbbbbb", tag: "div", className: "kc-x-text", style: { position: "absolute", left: "48px", top: "300px", width: "200px" }, typeStep: "body", children: [{ id: "ucccccccc", tag: "#text", text: "글" }] };
  let e2 = addElement({ v: 1 }, box);
  e2 = patchNodeStyle(e2, applyEdits(base, e2), box.id, { fontSize: "21px" });
  assert.equal(findNode(applyEdits(base, e2), box.id)?.style?.fontSize, "21px");
  e2 = setNodeType(e2, applyEdits(base, e2), box.id, "caption");
  assert.notEqual(findNode(applyEdits(base, e2), box.id)?.style?.fontSize, "21px");
});

test("스튜디오 — 크기 손잡이: 모서리는 비율 유지·맞은편 고정, 그 밖은 그리드 맞춤", () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  // 오른쪽 아래를 끌면 비율 유지, 왼쪽 위 고정
  const se = resizeBox(r, "se", 100, 10, true);
  assert.deepEqual(se, { x: 100, y: 100, w: 300, h: 150 });
  // 왼쪽 위를 끌면 오른쪽 아래가 고정
  const nw = resizeBox(r, "nw", -100, 0, true);
  assert.equal(nw.w / nw.h, 2);
  assert.equal(nw.x + nw.w, 300);
  assert.equal(nw.y + nw.h, 200);
  // 줄이기 — 최소 크기 아래로 가지 않고 비율 유지
  const small = resizeBox(r, "se", -500, -500, true);
  assert.equal(small.h, 8);
  assert.equal(small.w, 16);
  // 변 손잡이·비율 풀기는 그리드 맞춤
  const e = resizeBox(r, "e", 40, 90, true);
  assert.equal(e.h, 100, "오른쪽 변은 높이를 바꾸지 않는다");
  assert.equal(resizeBox(r, "s", 90, 41, false).h, 140, "4pt 기준선");
  assert.equal(resizeBox(r, "s", 90, 41, false).w, 200);
  const w = resizeBox(r, "w", -40, 0, false);
  assert.equal(w.x + w.w, 300);
});

test("스튜디오 — 사진과 틀은 한 요소: 어디를 눌러도 사진을 고르고 위치·크기는 틀에 적용", () => {
  const img: CNode = { id: "nimg", tag: "img", attrs: { src: "/catalog-kit/assets/hq-cover-tall.webp", alt: "사옥" } };
  const frame: CNode = { id: "nframe", tag: "div", className: "kc-front__window", children: [img] };
  const plain: CNode = { id: "nplain", tag: "div", className: "kc-x", children: [{ id: "nimg2", tag: "img", attrs: { src: "/a.png" } }] };
  const root: CNode = { id: "nroot", tag: "section", className: "pk-sheet", children: [frame, plain] };
  const onImg = resolveSelection(root, "nimg")!;
  assert.equal(onImg.kind, "image");
  assert.equal(onImg.frame?.id, "nframe");
  assert.equal(capabilities(onImg, 3).image, true);
  assert.equal(capabilities(onImg, 3).resize, true);
  const onFrame = resolveSelection(root, "nframe")!;
  assert.equal(onFrame.id, "nimg", "틀을 눌러도 사진");
  assert.equal(parentSelection(root, onImg), null, "상위 요소로 틀만 따로 고르지 않는다");
  // 틀이 아닌 상자의 사진은 따로
  assert.equal(resolveSelection(root, "nimg2")!.frame, undefined);
  // 원래 사진도 복사된다 — 주소에서 이미지 키를 되찾고 틀 모서리를 잇는다
  const copy = snapshotNode({ v: 1 }, root, "nimg", { x: 430, y: 40, w: 368, h: 515, radius: "0px 184px 184px", focus: { fx: 50, fy: 22 } })!;
  assert.equal(copy.asset?.key, "k/assets/hq-cover-tall.webp");
  assert.equal(copy.asset?.fy, 22);
  const round = sanitizePageEdits({ v: 1, added: [copy] }).added![0];
  assert.equal(round.style?.borderRadius, "0px 184px 184px");
  assert.equal(round.asset?.key, "k/assets/hq-cover-tall.webp");
});

test("스튜디오 — 추가한 이미지 상자에 바탕색이 없다(배경 없는 PNG 가 회색으로 보이지 않게)", () => {
  const rule = /\.kc-x-image \{[^}]*\}/.exec(STUDIO_PRINT_CSS)?.[0] ?? "";
  assert.ok(rule, "규칙이 있다");
  assert.doesNotMatch(rule, /background/);
});

test("스튜디오 — 여러 개 고르기: 다른 고른 요소 안에 든 것은 빼고 함께 숨기기", () => {
  const base = pageTree(makeFixture(), "area-1");
  const derived = applyEdits(base, { v: 1 });
  const lead = findBy(derived, hasClass("kc-lead"))!;
  const list = findBy(derived, hasClass("kc-list"))!;
  const li = (list.children ?? []).find((c) => c.tag === "li")!;
  assert.deepEqual(outermost(derived, [list.id, li.id, lead.id]), [list.id, lead.id]);
  const edits = [lead.id, list.id].reduce((acc, id) => hideNode(acc, derived, id), { v: 1 } as PageEdits);
  const d1 = applyEdits(base, edits);
  assert.equal(findBy(d1, hasClass("kc-lead")), null);
  assert.equal(findBy(d1, hasClass("kc-list")), null);
});

test("스튜디오 — 요소 겹침 판정: 실측 상자 교차·얇게 닿음·조상/자손·같은 쌍 한 번·넓이 순", () => {
  const box = (id: string, path: string[], ...rects: Array<[number, number, number, number]>): OverlapBox => ({ id, path: [...path, id], rects: rects.map(([x, y, w, h]) => ({ x, y, w, h })) });
  assert.deepEqual(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 6, w: 10, h: 10 }), { x: 5, y: 6, w: 5, h: 4 });
  assert.equal(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), null, "맞닿은 가장자리");
  const moved = box("m", ["root"], [48, 100, 200, 20], [48, 124, 120, 20]);
  const hits = findOverlaps(
    [moved],
    [
      box("a", ["root"], [100, 130, 300, 20]), // 둘째 줄과 68×14
      box("b", ["root"], [48, 119, 400, 30]), // 두 줄 모두와(넓게)
      box("c", ["root"], [48, 144.5, 300, 20]), // 0.5pt 만 닿음 → 겹침 아님
      box("d", ["root", "m"], [48, 100, 50, 10]), // 옮긴 상자 안 → 뺀다
      box("m", ["root"], [48, 100, 200, 20]), // 자기 자신
    ]
  );
  assert.deepEqual(hits.map((h) => h.otherId), ["b", "a"], "넓이 큰 순, c·d·자기 자신 제외");
  assert.deepEqual(hits[1].rect, { x: 100, y: 130, w: 68, h: 14 });
  // 옮긴 요소 둘이 서로 겹치면 한 번만
  const two = findOverlaps([box("x", ["r"], [0, 0, 50, 50]), box("y", ["r"], [40, 40, 50, 50])], [box("x", ["r"], [0, 0, 50, 50]), box("y", ["r"], [40, 40, 50, 50])]);
  assert.equal(two.length, 1);
  // 조상이 옮긴 요소면 그 안의 글 상자는 상대가 아니다
  assert.equal(findOverlaps([box("p", ["r"], [0, 0, 300, 100])], [box("t", ["r", "p"], [10, 10, 100, 20])]).length, 0);
});

test("스튜디오 — 요소 겹침 대상: 옮긴 요소(위치 편집·추가한 요소)와 글 상자(글 블록·데이터 영역·추가 글상자)", () => {
  const base = pageTree(makeFixture(), "area-1");
  let edits: PageEdits = { v: 1 };
  let derived = applyEdits(base, edits);
  assert.equal(movedNodes(derived).length, 0, "편집 없는 쪽은 옮긴 요소 없음");
  const lead = findBy(derived, hasClass("kc-lead"))!;
  const boxes0 = textBoxNodes(derived);
  assert.ok(boxes0.some((o) => o.node.id === lead.id && o.measure === "lines"), "글 블록은 줄 상자로 잰다");
  const info = findBy(derived, (n) => n.widget === "infographic")!;
  assert.ok(boxes0.some((o) => o.node.id === info.id && o.measure === "box"), "인포그래픽은 통째 상자");
  assert.ok(!boxes0.some((o) => o.path.some((p) => p.id === info.id) && o.node.id !== info.id), "데이터 영역 안으로 내려가지 않는다");
  // 옮기기(흐름 안 상대 이동) → 옮긴 요소
  edits = patchNodeStyle(edits, derived, lead.id, { position: "relative", left: "0px", top: "40px" });
  // 색만 바꾼 요소는 옮긴 요소가 아니다
  const kpis = findBy(derived, hasClass("kc-kpis"));
  if (kpis) edits = patchNodeStyle(edits, derived, kpis.id, { color: "var(--ink)" });
  edits = addElement(edits, { id: "ueeeeeeee", tag: "div", className: "kc-x-text", style: { position: "absolute", left: "48px", top: "300px", width: "200px" }, typeStep: "caption", children: [{ id: "uffffffff", tag: "#text", text: "추가한 글상자" }] });
  edits = addElement(edits, { id: "ugggggggg", tag: "div", className: "kc-x-shape", style: { position: "absolute", left: "48px", top: "300px", width: "100px", height: "40px" } });
  derived = applyEdits(base, edits);
  const moved = movedNodes(derived).map((o) => o.node.id);
  assert.deepEqual(moved.sort(), [lead.id, "ueeeeeeee", "ugggggggg"].sort());
  assert.equal(isMovedNode(findBy(derived, (n) => n.id === lead.id)!), true);
  if (kpis) assert.equal(isMovedNode(findBy(derived, (n) => n.id === kpis.id)!), false);
  const boxes = textBoxNodes(derived).map((o) => o.node.id);
  assert.ok(boxes.includes("ueeeeeeee"), "추가한 글상자는 글 상자");
  assert.ok(!boxes.includes("ugggggggg"), "도형은 글 상자가 아니다");
  assert.ok(!boxes.includes("uffffffff"), "추가 요소 안으로 내려가지 않는다");
});

// ── 쪽 고유 도식(InfoSource) 편집 결함(2026-11-08 C04 KPI 카드 중복) ──
const figuresOf = (t: CNode) => findBy(t, (n) => n.widget === "infographic" && (n.props as { slot: string }).slot === "c04.figures")!;
const kpiCards = (t: CNode) => figuresOf(t).children!.filter(hasClass("kc-kpi"));
const c04Tree = (variant?: Record<string, string>) => {
  const item = buildPagePlan(ctxOf(), makeFixture(), COVER, variant ? { c04: variant } : undefined).find((p) => p.key === "c04")!;
  return elementToTree(item.element, "c04");
};

test("쪽 고유 도식 — 내용만 고치면 원래 화면(C04 카드 4×2)을 두고, 유형·일러스트를 바꿔야 다시 그린다", () => {
  const base = c04Tree();
  const fig = figuresOf(base);
  assert.equal((fig.props as { source?: boolean }).source, true, "InfoSource 자리 표시");
  assert.equal(kpiCards(base).length, 8);
  const spec = (fig.props as unknown as { spec: { content: { items: Array<{ label: string }> } } }).spec;
  const content = { ...spec.content, items: spec.content.items.map((it, i) => (i === 0 ? { ...it, label: "고친 첫 항목" } : it)) };
  let edits = setInfo({ v: 1 }, fig.id, { content } as never);
  let d = figuresOf(applyEdits(base, edits));
  assert.ok(hasClass("kc-kpis")(d), "원래 카드 묶음 그대로");
  assert.equal(kpiCards(applyEdits(base, edits)).length, 8);
  assert.equal((d.props as { held?: boolean }).held, true, "다시 그릴 때 쓰도록 보관 중");
  assert.ok(!(d.props as { drawn?: boolean }).drawn);
  // 색만 바꿔도 원래 화면
  edits = setInfo(edits, fig.id, { content, colorMode: "mono" } as never);
  assert.ok(hasClass("kc-kpis")(figuresOf(applyEdits(base, edits))));
  // 유형을 고르면 spec(보관한 내용 포함)으로 다시 그린다
  edits = setInfo(edits, fig.id, { content, colorMode: "mono", type: "stats", variant: "row" } as never);
  d = figuresOf(applyEdits(base, edits));
  assert.equal((d.props as { drawn?: boolean }).drawn, true);
  assert.equal((d.props as { source?: boolean }).source, true, "다시 그려도 쪽 고유 도식 표시는 남는다");
  assert.ok(!hasClass("kc-kpis")(d), "범용 도식으로 다시 그림");
  assert.ok(textOf(d).includes("고친 첫 항목"));
  // 범용 자리(InfoSlot)는 내용만 고쳐도 그대로 다시 그린다(기존 동작)
  const area = pageTree(makeFixture(), "area-1");
  const proc = findBy(area, (n) => n.widget === "infographic" && (n.props as { slot: string }).slot === "area-1.process")!;
  assert.ok(!(proc.props as { source?: boolean }).source);
  const pspec = (proc.props as unknown as { spec: { content: { items: Array<{ label: string }> } } }).spec;
  const pe = setInfo({ v: 1 }, proc.id, { content: { ...pspec.content, items: pspec.content.items.map((it, i) => (i === 0 ? { ...it, label: "바꾼 단계" } : it)) } } as never);
  assert.ok(textOf(findNode(applyEdits(area, pe), proc.id)!).includes("바꾼 단계"));
  // [내용 원래대로] — 내용만 있던 덮어쓰기는 통째로 지워진다
  const cleared = setInfo(setInfo({ v: 1 }, fig.id, { content } as never), fig.id, {} as never);
  assert.equal(cleared.nodes, undefined);
});

test("위젯 되돌리기 — 고를 수 없는 위젯 안 노드의 옛 고정 글도 함께 지운다", () => {
  const base = c04Tree();
  const fig = figuresOf(base);
  const label = findBy(kpiCards(base)[1], hasClass("kc-kpi__label"))!;
  // 옛 버전에서 생긴 카드 글 고정값 + 도식 내용 덮어쓰기
  const legacy: PageEdits = sanitizePageEdits({
    v: 1,
    nodes: { [label.id]: { content: [{ id: "uaaaaaaaa", tag: "#text", text: "화학사고 예방·영업허가 등" }] }, [fig.id]: { info: { colorMode: "mono" } } },
  });
  const derived = applyEdits(base, legacy);
  assert.equal(resolveSelection(derived, label.id)!.id, fig.id, "위젯 안은 위젯 통째로 고른다");
  assert.deepEqual(editsWithin(base, legacy, fig.id), [label.id]);
  // [이 요소 편집 모두 되돌리기]
  assert.equal(resetNode(legacy, fig.id, "all", base).nodes, undefined);
  // [원래 유형·내용으로]
  assert.equal(setInfo(legacy, fig.id, null, base).nodes, undefined);
  // 위젯 자신에 편집이 없어도 안쪽 편집만 지울 수 있다
  const innerOnly: PageEdits = { v: 1, nodes: { [label.id]: legacy.nodes![label.id] } };
  assert.equal(resetNode(innerOnly, fig.id, "all", base).nodes, undefined);
  // 일부만 되돌리기·기본 트리 없이 부르면 안쪽은 그대로(다른 호출부 호환)
  assert.ok(resetNode(legacy, fig.id, ["style"], base).nodes?.[label.id]);
  assert.ok(resetNode(legacy, fig.id, "all").nodes?.[label.id]);
  // 위젯이 아닌 노드는 안쪽을 건드리지 않는다
  assert.deepEqual(editsWithin(base, legacy, kpiCards(base)[1].id), []);
});

test("자리 해시 id 밀림 — 실행 중 조건부 자식은 자리를 지키고, 코드가 바뀌어 밀린 고정 글은 지문이 달라 붙지 않는다", () => {
  // 띠 배경(조건부 첫 자식)이 있어도 없어도 카드 id 는 같다(null 이 자리를 지킴)
  const grid = c04Tree();
  const band = c04Tree({ layout: "band", photo: "k/assets/hq-cover-tall.webp" });
  assert.ok(findBy(band, hasClass("kc-kpis__bg")), "띠 배경이 있어야 함");
  assert.deepEqual(kpiCards(band).map((n) => n.id), kpiCards(grid).map((n) => n.id));

  const cards = kpiCards(grid);
  const labelOf = (i: number) => findBy(cards[i], hasClass("kc-kpi__label"))!;
  // 새 고정 글에는 편집 경로(useStudio)가 자리 지문을 단다
  let edits: PageEdits = { v: 1 };
  edits = anchorPins(setNodeContent(edits, applyEdits(grid, edits), labelOf(0).id, [{ id: "ubbbbbbbb", tag: "#text", text: "통합허가 최초허가(고침)" }]), edits, grid);
  assert.equal(edits.nodes![labelOf(0).id].anchor, anchorOf(labelOf(0)));
  edits = sanitizePageEdits(JSON.parse(JSON.stringify(edits)));
  assert.ok(edits.nodes![labelOf(0).id].anchor, "저장 왕복 뒤에도 지문 유지");
  assert.ok(textOf(findNode(applyEdits(grid, edits), labelOf(0).id)!).includes("(고침)"));
  // 글이 그대로면 지문을 다시 달지 않는다(옛 고정 글을 지금 자리로 굳히지 않음)
  const legacyPin: PageEdits = { v: 1, nodes: { [labelOf(2).id]: { content: [{ id: "ucccccccc", tag: "#text", text: "x" }] } } };
  assert.equal(anchorPins(legacyPin, legacyPin, grid), legacyPin);

  // 2026-10-29 실제 사례 재현: 쪽 코드가 카드 앞에 자식을 넣어 id 가 한 칸 밀림 — 2번째 카드('변경허가')에서 만든 고정 글이 1번째 카드 id 에 붙어 있다
  const shifted: PageEdits = sanitizePageEdits({
    v: 1,
    nodes: { [labelOf(0).id]: { content: [{ id: "udddddddd", tag: "#text", text: "변경허가·변경신고" }], anchor: anchorOf(labelOf(1)) } },
  });
  const d = applyEdits(grid, shifted);
  assert.ok(textOf(findNode(d, labelOf(0).id)!).includes("최초허가"), "1번째 카드는 원래 글 그대로");
  assert.ok(!findNode(d, labelOf(0).id)!.pinned);
  assert.deepEqual(orphanEdits(grid, shifted), [labelOf(0).id], "붙을 곳을 잃은 편집으로 보인다");
  assert.equal(dropOrphanEdits(shifted, grid).nodes, undefined);
  // 지문이 없는 옛 고정 글은 예전처럼 붙는다(호환)
  const old: PageEdits = { v: 1, nodes: { [labelOf(0).id]: { content: shifted.nodes![labelOf(0).id].content } } };
  assert.ok(findNode(applyEdits(grid, old), labelOf(0).id)!.pinned);
  assert.deepEqual(orphanEdits(grid, old), []);
  // 숫자·일부 데이터 글이 바뀐 것은 같은 자리로 본다
  const note = findBy(cards[0], hasClass("kc-kpi__note"))!;
  const anchor = anchorOf(note);
  assert.ok(/#/.test(anchor), anchor);
  const renum: CNode = JSON.parse(JSON.stringify(note).replace(/\d/g, "7"));
  assert.ok(anchorMatches(renum, anchor));
  assert.ok(!anchorMatches(labelOf(1), anchorOf(labelOf(0))));
});

test("응용소프트웨어 — 지표(제품 수)의 이름 목록과 15쪽 제품 카드가 같다", () => {
  assert.deepEqual([...SOFTWARE_PRODUCTS], SOFTWARE_CONTENT.products.map((p) => p.name));
  assert.equal(SOFTWARE_PRODUCTS.length, 5);
});
