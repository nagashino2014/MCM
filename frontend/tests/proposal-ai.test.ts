import { test } from "node:test";
import assert from "node:assert/strict";
import { createProposalTemplate } from "@/lib/proposal/templates";
import { applyOps, carriedNumbers, editablePaths, validateOps, type CheckContext, type CheckedOp } from "@/lib/proposal/ai/ops";
import { createProposalAi, ruleOps, type CallJson } from "@/lib/proposal/ai/service";
import { textFields } from "@/lib/proposal/find";
import { ProposalError, validateProposalDocument } from "@/lib/proposal/validate";
import type { ProposalDocument } from "@/lib/proposal/types";

// P1 AI 수정(docs/proposal-ai-editing-plan.md §3) — op 범위·허용 칸·읽기 전용·검사 표시·채택 시 원문 대조·규칙 대체.
const doc = () => createProposalTemplate("permit-general");
const page = (d: ProposalDocument, id: string) => d.sections.find((s) => s.id === id)!;
const ctxOf = (d: ProposalDocument, extra: string[] = [], action: CheckContext["action"] = "polish"): CheckContext => ({
  carried: carriedNumbers([...textFields(d).map((f) => f.value), ...extra]), linkNames: new Set(["client", "projectName", "siteName", "duration", "companyName"]), client: d.client, action,
});
const run = (d: ProposalDocument, sid: string, ops: unknown[], scope: "block" | "page" = "page", blockId?: string, extra: string[] = []) =>
  validateOps({ doc: d, scope: { scope, section: page(d, sid), blockId }, ops, ctx: ctxOf(d, extra) });

test("범위 밖·허용 경로 밖·읽기 전용 칸의 op 는 버린다", () => {
  const d = doc();
  const r = run(d, "G06", [
    { op: "set", block: "G01-b3", path: "items.0.text", value: "다른 쪽" },       // 다른 쪽
    { op: "set", block: "G06-b2", path: "items.1.value", value: "120" },          // 큰 숫자 값
    { op: "set", block: "G06-b2", path: "id", value: "x" },                       // 글 칸 아님
    { op: "set", block: "G06-b3", path: "items.0.text", value: "" },              // 비우기
    { op: "remove", block: "G06-b4" },                                             // 도식 지우기
    { op: "replace", block: "G06-b2", with: { kind: "text", text: "숫자 없앰" } },   // 큰 숫자 통째 바꾸기
  ]);
  assert.equal(r.ops.length, 0);
  assert.equal(r.dropped.length, 6);
});

test("[작성 필요] 칸·성명 표·적용 예시 쪽은 고치지 않는다", () => {
  const d = doc();
  const g30 = page(d, "G30");
  assert.deepEqual(editablePaths(g30, g30.blocks.find((b) => b.id === "G30-b2")!), [], "성명 표");
  const g29 = page(d, "G29");
  const org = g29.blocks.find((b) => JSON.stringify(b).includes("[작성 필요]"))!;
  const pendingPath = textFields({ ...d, sections: [g29] }).find((f) => f.bid === org.id && f.value.includes("[작성 필요]"))!.path;
  assert.ok(!editablePaths(g29, org).includes(pendingPath), "작성 필요 칸");
  assert.equal(run(d, "G29", [{ op: "set", block: org.id, path: pendingPath, value: "김책임 외 2명" }]).ops.length, 0);
  assert.equal(run(d, "G22", [{ op: "set", block: "G22-b3", path: "items.0.text", value: "고친 글" }]).ops.length, 0, "예시 쪽");
});

test("블록 범위에서는 그 블록만, 쪽 넣기·지우기·쪽 제목은 쪽 범위에서만", () => {
  const d = doc();
  const r = run(d, "G01", [
    { op: "set", block: "G01-b3", path: "items.0.text", value: "통합허가 취득과 이행 체계 필요" },
    { op: "set", block: "G01-b7", path: "items.0.text", value: "다른 블록" },
    { op: "insert", section: "G01", after: "G01-b3", block: { kind: "text", text: "새 글" } },
    { op: "page", section: "G01", title: "새 제목" },
  ], "block", "G01-b3");
  assert.deepEqual(r.ops.map((o) => o.op), ["set"]);
  assert.equal(r.dropped.length, 3);
});

test("숫자 검사 — 원문·원장·지시문 숫자와 단계·조항 번호는 통과, 새 연도·건수는 검토 표시", () => {
  const d = doc();
  const set = (value: string, extra: string[] = []) => run(d, "G01", [{ op: "set", block: "G01-b3", path: "items.0.text", value }], "page", undefined, extra).ops[0];
  assert.equal(set("3단계로 나눠 제8조에 따라 G12 기준을 적용").flags.filter((f) => f.kind === "number").length, 0);
  assert.equal(set("최초허가 101개소 수행", ["101"]).flags.filter((f) => f.kind === "number").length, 0, "원장 값");
  const flagged = set("2019년부터 450건 수행");
  assert.ok(flagged.flags.some((f) => f.kind === "number" && f.severity === "review"));
  assert.ok(set("업계 최고의 수행 체계").flags.some((f) => f.kind === "superlative"));
  assert.ok(set("{{없는값}} 사업장 기준").flags.some((f) => f.kind === "link" && f.severity === "review"));
});

test("바꾸기는 원래 id 를 지키고, 넣기는 새 id, 글머리 기호는 단계로 옮긴다", () => {
  const d = doc();
  const r = run(d, "G01", [
    { op: "replace", block: "G01-b7", with: { kind: "cards", items: [{ title: "현황", body: "확정" }, { title: "협의", body: "대응" }] } },
    { op: "insert", section: "G01", after: "G01-b3", block: { kind: "bullets", items: [{ level: 1, text: "○ 첫 줄" }, { level: 2, text: "- 둘째 줄", mark: "note" }] } },
    { op: "items", block: "G01-b3", items: [{ level: 1, text: "· 줄 하나" }] },
  ]);
  assert.deepEqual(r.ops.map((o) => o.op), ["replace", "insert", "replace"]);
  assert.equal(r.ops[0].next!.id, "G01-b7");
  assert.equal(r.ops[0].next!.kind, "cards");
  assert.notEqual(r.ops[1].next!.id, "G01-b3");
  assert.deepEqual((r.ops[1].next as { items: unknown[] }).items, [{ level: 1, text: "첫 줄" }, { level: 2, text: "둘째 줄", mark: "note" }]);
  assert.deepEqual((r.ops[2].next as { items: unknown[] }).items, [{ level: 1, text: "줄 하나" }]);
});

test("한 블록에 칸 고치기와 통째 바꾸기를 섞으면 뒤의 것을 버린다", () => {
  const d = doc();
  const r = run(d, "G01", [
    { op: "set", block: "G01-b3", path: "items.0.text", value: "고친 첫 줄" },
    { op: "items", block: "G01-b3", items: [{ level: 1, text: "통째" }] },
  ]);
  assert.deepEqual(r.ops.map((o) => o.op), ["set"]);
});

test("채택 — 고른 op 만 적용, 그사이 바뀐 칸은 적용하지 않는다(원문 대조)", () => {
  const d = doc();
  const { ops } = run(d, "G01", [
    { op: "set", block: "G01-b3", path: "items.0.text", value: "고친 첫 줄" },
    { op: "set", block: "G01-b7", path: "items.0.text", value: "고친 일곱째" },
    { op: "insert", section: "G01", after: "G01-b3", block: { kind: "callout", variant: "note", title: "참고", text: "덧붙임" } },
    { op: "remove", block: "G01-b5" },
  ]);
  assert.equal(ops.length, 4);
  // 사용자가 기다리는 동안 G01-b7 을 직접 고쳤다
  const edited: ProposalDocument = JSON.parse(JSON.stringify(d));
  (page(edited, "G01").blocks.find((b) => b.id === "G01-b7") as { items: Array<{ text: string }> }).items[0].text = "사용자가 고침";
  const { doc: next, applied, stale } = applyOps(edited, ops);
  assert.deepEqual(stale.map((o) => o.block), ["G01-b7"]);
  assert.equal(applied.length, 3);
  const g01 = page(next, "G01");
  assert.equal((g01.blocks[2] as { items: Array<{ text: string }> }).items[0].text, "고친 첫 줄");
  assert.equal(g01.blocks[3].kind, "callout", "넣기는 G01-b3 바로 뒤");
  assert.ok(!g01.blocks.some((b) => b.id === "G01-b5"));
  assert.equal((g01.blocks.find((b) => b.id === "G01-b7") as { items: Array<{ text: string }> }).items[0].text, "사용자가 고침");
  validateProposalDocument(JSON.parse(JSON.stringify(next)));
});

test("규칙 대체 — 줄이기는 칸마다 짧게, 개조식으로는 모양 바꾸기", () => {
  const d = doc();
  const short = ruleOps(d, { sectionId: "G01", scope: "page", action: "shorten" }) as Array<{ value: string; path: string; block: string }>;
  assert.ok(short.length > 0);
  for (const o of short) assert.ok(o.value.length < String(JSON.stringify(page(d, "G01"))).length);
  const withText: ProposalDocument = { ...d, sections: d.sections.map((s) => (s.id === "G01" ? { ...s, blocks: [...s.blocks, { kind: "text", id: "t_x", text: "첫 문장입니다.\n둘째 문장입니다." }] } : s)) };
  const bl = ruleOps(withText, { sectionId: "G01", scope: "block", blockId: "t_x", action: "bullets" }) as Array<{ op: string; with: { kind: string } }>;
  assert.equal(bl[0].op, "replace");
  assert.equal(bl[0].with.kind, "bullets");
});

const fakeAi = (reply: unknown, seen: { user?: string; feature?: string } = {}) => createProposalAi({
  callJson: (async (feature, _system, user) => { seen.user = user; seen.feature = feature; if (reply instanceof Error) throw reply; return reply; }) as CallJson,
  loadLedger: async () => [{ id: "permit.initial.completed", label: "최초허가 완료 사업장", value: 101, unit: "개소", asOf: "2026-05-15" }],
});

test("서비스 — 지시와 자료를 나눠 보내고, 원장 값 숫자는 검토 표시가 붙지 않는다", async () => {
  const seen: { user?: string; feature?: string } = {};
  const ai = fakeAi({ summary: "다듬음", ops: [{ op: "set", block: "G01-b3", path: "items.0.text", value: "최초허가 101개소 경험으로 이행 체계 마련" }], notes: ["확인"] }, seen);
  const r = await ai.propose({ doc: doc(), sectionId: "G01", scope: "block", blockId: "G01-b3", action: "polish", instruction: "", userId: "u1" });
  assert.equal(seen.feature, "proposal.rewrite");
  assert.match(seen.user ?? "", /<instruction>[\s\S]*<\/instruction>[\s\S]*<data>/);
  assert.equal(r.source, "ai");
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].flags.filter((f) => f.kind === "number").length, 0);
});

test("서비스 — AI 를 못 쓰면 줄이기는 규칙 제안, 다듬기는 사유만", async () => {
  const off = fakeAi(new Error("llm_not_configured"));
  const short = await off.propose({ doc: doc(), sectionId: "G01", scope: "page", action: "shorten", instruction: "", userId: null });
  assert.equal(short.source, "rule");
  assert.equal(short.fallback, "AI 키가 설정되지 않았습니다");
  assert.ok(short.ops.length > 0);
  const polish = await off.propose({ doc: doc(), sectionId: "G01", scope: "page", action: "polish", instruction: "", userId: null });
  assert.equal(polish.ops.length, 0);
});

test("서비스 — 예시 쪽·성명 표는 AI 를 부르지 않고 알린다", async () => {
  const seen: { user?: string } = {};
  const ai = fakeAi({ ops: [] }, seen);
  await assert.rejects(ai.propose({ doc: doc(), sectionId: "G22", scope: "page", action: "polish", instruction: "", userId: null }), (e: unknown) => e instanceof ProposalError && e.status === 400);
  await assert.rejects(ai.propose({ doc: doc(), sectionId: "G30", scope: "block", blockId: "G30-b2", action: "polish", instruction: "", userId: null }), ProposalError);
  assert.equal(seen.user, undefined);
});

test("넘침 줄이기 — 길이 초과·새 숫자·작성 필요 삭제는 규칙 축약으로", async () => {
  const ai = fakeAi({ items: [{ key: "a", text: "짧음" }, { key: "b", text: "새 숫자 2030년 추가된 아주 긴 글입니다 아주 긴 글" }, { key: "c", text: "칸 지움" }] });
  const r = await ai.fit([{ key: "a", text: "조금 더 긴 원래 글입니다", maxChars: 6 }, { key: "b", text: "원래 글은 이렇습니다 꽤 깁니다", maxChars: 8 }, { key: "c", text: "[작성 필요] 칸이 있는 글입니다", maxChars: 10 }], { userId: null, subject: "t" });
  assert.equal(r.items[0].text, "짧음");
  assert.ok(!r.items[1].text.includes("2030"));
  assert.ok(r.items[2].text.includes("[작성 필요]"));
});

test("넘침 줄이기 — 굵게 표식·연결 표기를 깨는 결과는 받지 않는다", async () => {
  const ai = fakeAi({ items: [{ key: "a", text: "운영 인계까지 *" }, { key: "b", text: "사업장 기준 정리" }] });
  const r = await ai.fit([{ key: "a", text: "현황 확정에서 운영 인계까지 **한 흐름**으로 수행", maxChars: 14 }, { key: "b", text: "{{siteName}} 사업장 기준으로 다시 정리해야 함", maxChars: 12 }], { userId: null, subject: "t" });
  assert.equal((r.items[0].text.match(/\*\*/g)?.length ?? 0) % 2, 0);
  assert.ok(r.items[1].text.includes("{{siteName}}"));
});

test("발주처 메모는 저장 검증 뒤에도 남고, 글 칸 목록(찾기·작성 필요)에는 들어가지 않는다", () => {
  const d = doc();
  const withNotes = { ...d, variables: { ...d.variables!, clientNotes: "제철 공정, 소결로 2기" } };
  const saved = validateProposalDocument(JSON.parse(JSON.stringify(withNotes)));
  assert.equal(saved.variables?.clientNotes, "제철 공정, 소결로 2기");
  assert.ok(!textFields(saved).some((f) => f.value.includes("소결로")));
  const ops: CheckedOp[] = [];
  assert.equal(applyOps(saved, ops).doc, saved);
});
