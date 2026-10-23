// 홍보·채용공고 편집기 회귀 시험 — 공용 핵심(lib/doc-tree) 추출(2026-10-22) 전후로 인라인 직렬화·역파싱·트리 조작 결과가 같은지.
// 기준 = 추출 전 원본(tests/legacy/*, git HEAD 1680a90a 사본). DOM 은 htmlparser2 트리를 DOM 모양으로 감싸 쓴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import type { DocNode } from "@/lib/recruit/types";
import * as now from "@/lib/recruit/inline";
import * as nowOps from "@/lib/recruit/tree-ops";
import * as legacy from "./legacy/recruit-inline-legacy";
import * as legacyOps from "./legacy/recruit-tree-ops-legacy";

(globalThis as unknown as { Node: { TEXT_NODE: number; ELEMENT_NODE: number } }).Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

interface HNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: HNode[];
}

function textContent(n: HNode): string {
  if (n.type === "text") return n.data ?? "";
  return (n.children ?? []).map(textContent).join("");
}

/** htmlparser2 노드 → DOM 모양(nodeType·tagName·childNodes·getAttribute·textContent) */
function adapt(n: HNode): unknown {
  if (n.type === "text") return { nodeType: 3, textContent: n.data ?? "", childNodes: [] };
  if (n.type === "tag" || n.type === "script" || n.type === "style") {
    return {
      nodeType: 1,
      tagName: (n.name ?? "").toUpperCase(),
      textContent: textContent(n),
      childNodes: (n.children ?? []).map(adapt),
      getAttribute: (k: string) => n.attribs?.[k] ?? null,
    };
  }
  return { nodeType: 8, textContent: "", childNodes: [] };
}

function container(html: string): Element {
  const doc = parseDocument(`<div>${html}</div>`) as unknown as HNode;
  return adapt(doc.children![0]) as Element;
}

/** id 는 무작위라 빼고 비교 */
function noIds(nodes: unknown): unknown {
  return JSON.parse(JSON.stringify(nodes, (k, v) => (k === "id" ? undefined : v)));
}

const SAMPLES = [
  "평범한 글",
  "<b>굵게</b> 그리고 <i>기울임</i>, <u>밑줄</u> <s>취소</s>",
  '<span style="color: #5d87ff">액센트</span> <font color="#5d87ff">폰트</font> <font color="#123456">다른</font>',
  '<span style="display:inline-block;width:5px;height:5px;background:var(--accent);border-radius:50%"></span>글머리',
  'a<br>b<div>c</div><p>d</p><li>e</li><small>작게</small><sup>위</sup>',
  '<a href="https://example.com" style="color:rgb(93, 135, 255)">링크</a><a href="https://x.y"></a>',
  '<img src="data:image/png;base64,AAAA" style="width:20px"><img src="http://x/y.png">',
  '<span>서식 없음</span><span style="unknown-prop: 1; font-weight: 700">굵기</span><strong></strong>',
  "",
];

test("역파싱(DOM → 노드)이 추출 전과 같다", () => {
  for (const html of SAMPLES) {
    const a = legacy.domToInlineNodes(container(html), "#5d87ff");
    const b = now.domToInlineNodes(container(html), "#5d87ff");
    assert.deepEqual(noIds(b), noIds(a), html);
  }
});

const TREES: DocNode[][] = [
  [{ id: "1", tag: "#text", text: "a < b & \"c\"" }],
  [
    { id: "1", tag: "strong", style: { color: "var(--accent)" }, children: [{ id: "2", tag: "#text", text: "굵게" }] },
    { id: "3", tag: "br" },
    { id: "4", tag: "a", href: "https://x.y/?a=1&b=2", children: [{ id: "5", tag: "#text", text: "링크" }] },
    { id: "6", tag: "img", src: "data:image/png;base64,AAAA", style: { width: "20px" } },
    { id: "7", tag: "span", style: { width: "5px", background: "var(--accent)" } },
  ],
];

test("직렬화(노드 → 편집 HTML)가 추출 전과 같다", () => {
  for (const t of TREES) assert.equal(now.renderInlineHtml(t), legacy.renderInlineHtml(t));
});

test("문단 블록 판정이 추출 전과 같다", () => {
  const blocks: DocNode[] = [
    { id: "p", tag: "p", children: TREES[1] },
    { id: "d", tag: "div", children: [{ id: "x", tag: "div", children: [] }] },
    { id: "e", tag: "div" },
  ];
  for (const b of blocks) assert.equal(now.isInlineBlock(b), legacy.isInlineBlock(b));
});

test("트리 조작이 추출 전과 같다(구조 비교)", () => {
  const tree: DocNode = {
    id: "root",
    tag: "div",
    children: [
      { id: "g1", tag: "div", repeatGroup: "g", children: [{ id: "t1", tag: "#text", text: "STEP 1" }] },
      { id: "s1", tag: "span", repeatGroup: "g", separator: true, children: [{ id: "ts", tag: "#text", text: "→" }] },
      { id: "g2", tag: "div", repeatGroup: "g", children: [{ id: "t2", tag: "#text", text: "STEP 2" }] },
      { id: "p", tag: "p", style: { display: "flex", gap: "8px" }, children: [{ id: "tp", tag: "#text", text: "본문" }] },
    ],
  };
  const pairs: Array<[(t: DocNode) => DocNode, (t: DocNode) => DocNode]> = [
    [(t) => nowOps.addRepeatItem(t, "g2"), (t) => legacyOps.addRepeatItem(t, "g2")],
    [(t) => nowOps.removeRepeatItem(t, "g1"), (t) => legacyOps.removeRepeatItem(t, "g1")],
    [(t) => nowOps.moveRepeatItem(t, "g1", 1), (t) => legacyOps.moveRepeatItem(t, "g1", 1)],
    [(t) => nowOps.duplicateNode(t, "p"), (t) => legacyOps.duplicateNode(t, "p")],
    [(t) => nowOps.removeNode(t, "p"), (t) => legacyOps.removeNode(t, "p")],
    [(t) => nowOps.moveNode(t, "p", -1), (t) => legacyOps.moveNode(t, "p", -1)],
    [(t) => nowOps.toggleBulletNode(t, "p"), (t) => legacyOps.toggleBulletNode(t, "p")],
    [(t) => nowOps.nudgeNode(t, "p", 4, -2), (t) => legacyOps.nudgeNode(t, "p", 4, -2)],
    [(t) => nowOps.resizeNode(t, "p", { width: 120 }), (t) => legacyOps.resizeNode(t, "p", { width: 120 })],
    [(t) => nowOps.updateNodeText(t, "tp", "새 글"), (t) => legacyOps.updateNodeText(t, "tp", "새 글")],
    [(t) => nowOps.moveNodeTo(t, "p", "g1", 0), (t) => legacyOps.moveNodeTo(t, "p", "g1", 0)],
  ];
  for (const [a, b] of pairs) assert.deepEqual(noIds(a(tree)), noIds(b(tree)));
  assert.equal(nowOps.findNode(tree, "t2")?.text, "STEP 2");
  assert.equal(nowOps.findParent(tree, "t2")?.id, "g2");
});
