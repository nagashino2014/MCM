import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCompleteRuleKeys,
  checkCompletion,
  completeRulesSummary,
  completionErrorMessage,
  describeMissingRule,
  hasAnyCompleteRule,
  normalizeCompleteRules,
  sameCompleteRules,
} from "../lib/todo/completion";

test("규칙 정규화 — 알 수 없는 키·거짓 값은 버리고 객체가 아니면 빈 규칙", () => {
  assert.deepEqual(normalizeCompleteRules(null), {});
  assert.deepEqual(normalizeCompleteRules("x"), {});
  assert.deepEqual(normalizeCompleteRules([true]), {});
  assert.deepEqual(normalizeCompleteRules({ subtasks: true, note: false, review: "true", bogus: true }), { subtasks: true, review: true });
  assert.deepEqual(normalizeCompleteRules({ note: 1 }), { note: true });
  assert.ok(!hasAnyCompleteRule({}));
  assert.ok(hasAnyCompleteRule({ note: true }));
  assert.deepEqual(activeCompleteRuleKeys({ review: true, subtasks: true }), ["subtasks", "review"]);
});

test("규칙 없음 — 사실과 무관하게 즉시 완료 가능", () => {
  const r = checkCompletion({}, { status: "todo", openSubtasks: 5, completionNote: null, reviewedAt: null });
  assert.ok(r.ok);
  assert.deepEqual(r.missing, []);
  assert.equal(r.openSubtasks, 5);
  assert.equal(completionErrorMessage(r), "");
});

test("하위 작업 규칙 — 미완 하위 작업이 있으면 거절, 0건이면 통과", () => {
  const facts = { status: "doing", completionNote: null, reviewedAt: null };
  const bad = checkCompletion({ subtasks: true }, { ...facts, openSubtasks: 2 });
  assert.ok(!bad.ok);
  assert.deepEqual(bad.missing, ["subtasks"]);
  assert.equal(describeMissingRule("subtasks", bad.openSubtasks), "하위 작업 2건 미완료 — 모두 완료해야 합니다");
  assert.ok(checkCompletion({ subtasks: true }, { ...facts, openSubtasks: 0 }).ok);
  // 음수·NaN 은 0 으로
  assert.ok(checkCompletion({ subtasks: true }, { ...facts, openSubtasks: Number.NaN }).ok);
});

test("메모 규칙 — 공백만 있는 메모는 거절, 기존 메모가 있으면 통과", () => {
  const facts = { status: "todo", openSubtasks: 0, reviewedAt: null };
  assert.deepEqual(checkCompletion({ note: true }, { ...facts, completionNote: "   " }).missing, ["note"]);
  assert.ok(checkCompletion({ note: true }, { ...facts, completionNote: "현장 확인 끝" }).ok);
});

test("검토 규칙 — reviewed_at 이 있거나 현재 상태가 review 면 통과", () => {
  const facts = { openSubtasks: 0, completionNote: null };
  assert.deepEqual(checkCompletion({ review: true }, { ...facts, status: "doing", reviewedAt: null }).missing, ["review"]);
  assert.ok(checkCompletion({ review: true }, { ...facts, status: "review", reviewedAt: null }).ok);
  assert.ok(checkCompletion({ review: true }, { ...facts, status: "doing", reviewedAt: "2026-10-14T01:00:00.000Z" }).ok);
});

test("복합 규칙 — 미충족은 고정 순서(subtasks → note → review), 오류 문구는 첫 항목 기준", () => {
  const r = checkCompletion({ subtasks: true, note: true, review: true }, { status: "todo", openSubtasks: 1, completionNote: "", reviewedAt: null });
  assert.deepEqual(r.missing, ["subtasks", "note", "review"]);
  assert.equal(completionErrorMessage(r), "완료 조건을 충족하지 않았습니다. 하위 작업 1건 미완료 — 모두 완료해야 합니다.");
  assert.equal(completeRulesSummary({ subtasks: true, note: true }), "하위 작업·메모");
  assert.equal(completeRulesSummary({}), null);
  assert.ok(sameCompleteRules({ note: true, subtasks: true }, { subtasks: true, note: true }));
  assert.ok(!sameCompleteRules({ note: true }, {}));
});
