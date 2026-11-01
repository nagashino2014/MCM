import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalPages } from "@/components/sales/proposal/ProposalPages";
import { createProposalTemplate, PROPOSAL_TEMPLATES } from "@/lib/proposal/templates";
import { bulletAction, insertTableRow, moveTableColumn } from "@/lib/proposal/edit";
import { fieldLabel, findMatches, pendingItems, replaceMatches, setField, textFields } from "@/lib/proposal/find";
import { sectionHash } from "@/lib/proposal/hash";
import { outlineLabel } from "@/lib/proposal/text";
import { ProposalError, validateProposalDocument } from "@/lib/proposal/validate";
import type { ProposalBlock, ProposalDocument } from "@/lib/proposal/types";

// P0 편집 기초(docs/proposal-ai-editing-plan.md §4 P0) — 글 칸 목록·찾기·바꾸기·작성 필요 목록·표·개조식 연산·쪽 원고 지문.
const roundTrip = (doc: ProposalDocument) => validateProposalDocument(JSON.parse(JSON.stringify(doc)));
const fieldKey = (sid: string, bid: string, path: string) => `${sid}|${bid}|${path}`;
const ids = (doc: ProposalDocument) => doc.sections.flatMap((s) => [s.id, s.pageId ?? "", ...s.blocks.map((b) => b.id)]);
function withBlock(b: ProposalBlock): ProposalDocument {
  const doc = createProposalTemplate("permit-general");
  return { ...doc, sections: [{ ...doc.sections[0], blocks: [b] }, ...doc.sections.slice(1)] };
}

test("미리보기의 모든 더블클릭 편집 경로가 글 칸 목록에 있다(4개 양식)", () => {
  for (const t of PROPOSAL_TEMPLATES) {
    const doc = createProposalTemplate(t.id);
    const fields = new Set(textFields(doc).map((f) => fieldKey(f.sid, f.bid, f.path)));
    const html = renderToStaticMarkup(ProposalPages({ document: doc }));
    const edits = [...html.matchAll(/data-edit="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    assert.ok(edits.length > 100, `${t.id}: 편집 경로가 너무 적습니다(${edits.length}).`);
    const missing = edits.filter((e) => !fields.has(e));
    assert.deepEqual(missing, [], `${t.id}: 글 칸 목록에 없는 편집 경로`);
  }
});

test("글 칸 목록은 id·종류·그림 데이터 같은 비글 값을 담지 않는다", () => {
  for (const t of PROPOSAL_TEMPLATES) {
    for (const f of textFields(createProposalTemplate(t.id))) {
      assert.doesNotMatch(f.path, /(^|\.)(id|pageId|kind|style|variant|type|icon|tone|mark|color|dataUrl|sourceHash)$/, `${t.id}: ${f.path}`);
      // 일정표 구분(tasks.N.group)은 글 칸이고, 도식 항목 group 은 열거값이다.
      assert.doesNotMatch(f.path, /^spec\.items\.\d+\.group$/, `${t.id}: ${f.path}`);
    }
  }
});

test("모두 바꾸기 — 일치 수만큼 바뀌고 id 는 그대로, 저장 검증을 통과한다", () => {
  const doc = createProposalTemplate("permit-power");
  const before = findMatches(doc, "통합");
  assert.ok(before.length > 20);
  const { doc: next, replaced, skipped } = replaceMatches(doc, "통합", "통합·");
  assert.equal(replaced + skipped, before.length);
  assert.equal(findMatches(next, "통합·").length, replaced);
  assert.deepEqual(ids(next), ids(doc));
  roundTrip(next);
});

test("고른 일치만 바꾼다 — 나머지는 그대로", () => {
  const doc = createProposalTemplate("permit-general");
  const all = findMatches(doc, "허가");
  const pick = new Set([all[0].key, all[3].key]);
  const { doc: next, replaced } = replaceMatches(doc, "허가", "인가", { only: pick });
  assert.equal(replaced, 2);
  assert.equal(findMatches(next, "허가").length, all.length - 2);
});

test("연결 표기·굵게 표식을 가로지르는 일치는 건너뛴다", () => {
  const doc = withBlock({ kind: "text", id: "t_1", text: "{{siteName}} 현황과 **핵심** 과제" });
  const inside = findMatches(doc, "siteName").filter((m) => m.bid === "t_1");
  assert.equal(inside.length, 1);
  assert.ok(inside[0].skip);
  const whole = findMatches(doc, "{{siteName}}").filter((m) => m.bid === "t_1");
  assert.equal(whole[0].skip, undefined);
  const bold = findMatches(doc, "*핵").filter((m) => m.bid === "t_1");
  assert.ok(bold[0].skip);
  const r = replaceMatches(doc, "siteName", "x");
  assert.ok(r.skipped >= 1);
  assert.equal((r.doc.sections[0].blocks[0] as { text: string }).text, "{{siteName}} 현황과 **핵심** 과제");
  const plain = replaceMatches(doc, "핵심", "주요");
  assert.equal((plain.doc.sections[0].blocks[0] as { text: string }).text, "{{siteName}} 현황과 **주요** 과제");
});

test("대소문자 구분 선택", () => {
  const doc = withBlock({ kind: "text", id: "t_1", text: "BAT 와 bat 비교" });
  assert.equal(findMatches(doc, "bat").filter((m) => m.bid === "t_1").length, 2);
  assert.equal(findMatches(doc, "bat", { caseSensitive: true }).filter((m) => m.bid === "t_1").length, 1);
});

test("작성 필요 목록 — 새 문서 기준 일반 12·발전 10·정기검사 6·ESG 7곳", () => {
  const expected: Record<string, number> = { "permit-general": 12, "permit-power": 10, "permit-inspection": 6, sustainability: 7 };
  for (const t of PROPOSAL_TEMPLATES) {
    const items = pendingItems(createProposalTemplate(t.id));
    const todo = items.filter((x) => x.kind === "todo").reduce((a, x) => a + x.count, 0);
    assert.equal(todo, expected[t.id], t.id);
    assert.equal(items.filter((x) => x.kind === "link").length, 0, `${t.id}: 기본 변수가 채워져 있어 연결 표기 누락은 없다`);
  }
});

test("작성 필요 목록 — 비운 변수·잘못된 연결 표기·표지 칸", () => {
  const base = createProposalTemplate("permit-general");
  const doc = { ...withBlock({ kind: "text", id: "t_1", text: "{{ siteName }} 과 {{없는값}} 확인" }), variables: { ...base.variables!, siteName: "" }, client: "[작성 필요]" };
  const items = pendingItems(doc);
  const mine = items.find((x) => x.bid === "t_1");
  assert.equal(mine?.kind, "link");
  assert.deepEqual(mine?.names, ["siteName", "{{없는값}}"]);
  assert.ok(items.some((x) => x.bid === "_doc" && x.path === "client" && x.kind === "todo"));
  assert.ok(items.filter((x) => x.kind === "link").length > 1, "원고의 {{siteName}} 도 함께 걸린다");
});

test("표지 칸 값 넣기와 칸 이름", () => {
  const doc = createProposalTemplate("sustainability");
  const next = setField(doc, { sid: "", bid: "_doc", path: "variables.siteName" }, "본사");
  assert.equal(next.variables?.siteName, "본사");
  assert.equal(next.variables?.duration, doc.variables?.duration);
  assert.equal(fieldLabel(doc, { sid: "", bid: "_doc", path: "client" }), "표지 · 발주처");
  const table = doc.sections.flatMap((s) => s.blocks.map((b) => ({ s, b }))).find((x) => x.b.kind === "table")!;
  assert.match(fieldLabel(doc, { sid: table.s.id, bid: table.b.id, path: "rows.1.2" }), /· 표 · 2행 3열$/);
});

test("표 — 중간 행 넣기·열 옮기기(머리글·칸·폭이 함께)", () => {
  const b: Extract<ProposalBlock, { kind: "table" }> = { kind: "table", id: "x", title: "", style: "grid", columns: ["가", "나", "다"], rows: [["1", "2", "3"], ["4", "5", "6"]], widths: [20, 30, 50] };
  const ins = insertTableRow(b, 1);
  assert.deepEqual(ins.rows, [["1", "2", "3"], ["", "", ""], ["4", "5", "6"]]);
  const moved = moveTableColumn(b, 0, 1);
  assert.deepEqual(moved.columns, ["나", "가", "다"]);
  assert.deepEqual(moved.rows, [["2", "1", "3"], ["5", "4", "6"]]);
  assert.deepEqual(moved.widths, [30, 20, 50]);
  assert.equal(moveTableColumn(b, 2, 1), b, "끝 열은 오른쪽으로 옮기지 않는다");
});

test("개조식 단축키 — 새 줄·단계·빈 줄 지우기", () => {
  const items = [{ level: 1 as const, text: "가" }, { level: 2 as const, text: "나", mark: "note" as const }];
  const ins = bulletAction(items, 1, "나나", "insert");
  assert.deepEqual(ins.items, [{ level: 1, text: "가" }, { level: 2, text: "나나", mark: "note" }, { level: 2, text: "", mark: "note" }]);
  assert.equal(ins.focus, 2);
  assert.equal(bulletAction(items, 0, "가", "indent").items[0].level, 2);
  assert.equal(bulletAction(items, 0, "가", "outdent").items[0].level, 1);
  assert.equal(bulletAction([{ level: 3, text: "" }], 0, "", "indent").items[0].level, 3);
  const rm = bulletAction(items, 1, "", "remove");
  assert.deepEqual(rm.items, [{ level: 1, text: "가" }]);
  assert.equal(rm.focus, 0);
  assert.equal(bulletAction([{ level: 1, text: "" }], 0, "", "remove").items.length, 1, "마지막 한 줄은 지우지 않는다");
});

test("쪽 원고 지문 — 새 문서 모든 쪽에 있고 저장 검증 뒤에도 같은 값", () => {
  for (const t of PROPOSAL_TEMPLATES) {
    const doc = createProposalTemplate(t.id);
    const saved = roundTrip(doc);
    for (const [i, s] of saved.sections.entries()) {
      assert.match(s.sourceHash ?? "", /^[0-9a-f]{16}$/);
      assert.equal(s.sourceHash, doc.sections[i].sourceHash);
      assert.equal(sectionHash(s), s.sourceHash, `${t.id} ${s.pageId}: 고치지 않은 쪽은 지문이 같다`);
    }
  }
});

test("쪽 목록 이름 — 25자 안의 명사구로 줄이고, 넘치면 낱말 경계에서 자른다", () => {
  for (const t of PROPOSAL_TEMPLATES) for (const s of createProposalTemplate(t.id).sections) if (s.title) assert.ok(outlineLabel(s.title).length <= 25, `${s.pageId}: ${outlineLabel(s.title)}`);
  assert.equal(outlineLabel("자료에서 허가와 운영까지 여섯 작업을 연결합니다"), "자료에서 허가와 운영까지 여섯 작업 연결");
  assert.equal(outlineLabel("자료의 유무와 사용할 수 있는 상태를 함께 확인합니다"), "자료의 유무와 사용할 수 있는 상태 확인");
  assert.equal(outlineLabel("서로 다른 공장을 하나의 현황으로 합치지 않습니다"), "서로 다른 공장을 하나의 현황으로 합치지 않음");
  assert.equal(outlineLabel("설비목록을 모든 장의 공통 기준으로 만듭니다"), "설비목록을 모든 장의 공통 기준으로 만듦");
  assert.equal(outlineLabel("세부 수행계획 — 현황 분석에서 계획서 작성까지"), "세부 수행계획");
  assert.equal(outlineLabel("수행 조직과 역할별 책임"), "수행 조직과 역할별 책임");
  const cut = outlineLabel("통합허가 대행업 등록 이후 발전·산업 전 업종을 수행해 왔습니다");
  assert.ok(cut.endsWith("…") && cut.length <= 25 && !/\s…$/.test(cut));
});

test("쪽 원고 지문 — 글을 고치면 달라지고, 잘못된 형식은 저장되지 않는다", () => {
  const doc = createProposalTemplate("permit-general");
  const s = doc.sections[3];
  const edited = { ...s, title: s.title + " 수정" };
  assert.notEqual(sectionHash(edited), s.sourceHash);
  assert.equal(sectionHash({ ...s, id: "p_other", pageId: "X01" }), s.sourceHash, "쪽 id 만 다르면 같은 지문");
  assert.throws(() => roundTrip({ ...doc, sections: [{ ...s, sourceHash: "zz" }] }), ProposalError);
});
