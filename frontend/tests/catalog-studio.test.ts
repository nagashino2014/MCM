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
import { composeDocument } from "@/lib/catalog/studio/compose";
import { elementToTree } from "@/lib/catalog/studio/convert";
import { orderPlan, type StudioPageState } from "@/lib/catalog/studio/doc";
import {
  addElement,
  applyEdits,
  duplicateNode,
  hideNode,
  listItemOp,
  patchNodeStyle,
  sanitizePageEdits,
  setInfo,
  setNodeContent,
  setNodeType,
  type PageEdits,
} from "@/lib/catalog/studio/edits";
import { BIND_GROUP_ORDER, DATA_BINDS, bindOptions, makeBindChip, resolveBind } from "@/lib/catalog/studio/binds";
import { CARET_ID, appendCaret, caretNode, collectChips, fromEditableDom, placeChip } from "@/lib/catalog/studio/inline";
import { findNode, textOf, type CNode } from "@/lib/catalog/studio/nodes";
import { capabilities, outermost, resolveSelection } from "@/lib/catalog/studio/select";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
import { makeFixture } from "./catalog-studio-fixture";

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
