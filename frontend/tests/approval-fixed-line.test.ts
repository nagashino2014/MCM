import assert from "node:assert/strict";
import test from "node:test";
import {
  describeFixedLine,
  insertDrafterExtras,
  isLineEnforced,
  parseExtraPosition,
  pickDrafterRules,
  type FixedLineStep,
  parseEnforceWhen,
  parseTemplateSteps,
  resolveLineSteps,
  sameLineAssignees,
  type FixedLineFacts,
  type LinePerson,
  type LineTemplate,
} from "../lib/approval/fixed-line-rules";

// 양식별 고정 결재선(335) — docs/approval-fixed-line-plan-2026-11-03.md §3-2·§4(스테이징 실데이터 해석표).

const P = (userId: string, name: string): LinePerson => ({ userId, name, position: null });
const CEO = P("u-ceo", "이유억");
const JDJ = P("u-jdj", "정득종");
const SSK = P("u-ssk", "신총식");
const LJY = P("u-ljy", "이재영");
const LDH = P("u-ldh", "이도희");
const HDG = P("u-hdg", "한도경");
const JOH = P("u-joh", "조옥환");
const STAFF = P("u-staff", "직원");

const tpl = (steps: unknown, enforceWhen: unknown = null): LineTemplate => ({
  formId: "frm-x",
  steps: parseTemplateSteps(steps),
  enforceWhen: parseEnforceWhen(enforceWhen),
  enabled: true,
});

const T = {
  ceoOnly: tpl([{ role: "ceo" }]),
  execCeo: tpl([{ role: "exec" }, { role: "ceo" }]),
  full: tpl([{ role: "dept_head" }, { role: "exec" }, { role: "ceo" }]),
  headExec: tpl([{ role: "dept_head" }, { role: "exec" }]),
  headOnly: tpl([{ role: "dept_head" }]),
  managerProxy: tpl([{ role: "manager", fallbackRole: "ceo", proxyUserIds: [LDH.userId] }]),
  manager: tpl([{ role: "manager", fallbackRole: "ceo" }]),
};

function facts(opts: {
  drafter: LinePerson;
  dept?: string | null;
  heads?: LinePerson[];
  exec?: LinePerson | null;
  isExec?: boolean;
  isCeo?: boolean;
}): FixedLineFacts {
  return {
    drafter: { userId: opts.drafter.userId, deptId: opts.dept === undefined ? "d1" : opts.dept, deptName: "통합환경2본부" },
    deptHeads: opts.heads ?? [HDG],
    roleUsers: { exec: opts.exec === undefined ? JDJ : opts.exec, ceo: CEO, manager: LJY },
    drafterIsExec: opts.isExec ?? false,
    drafterIsCeo: opts.isCeo ?? false,
    people: { [LDH.userId]: LDH },
  };
}

const names = (r: { steps: { name: string }[] }) => r.steps.map((s) => s.name).join("→");

test("직원 — 양식 묶음별 결재선", () => {
  const f = facts({ drafter: STAFF });
  assert.equal(names(resolveLineSteps(T.ceoOnly, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.execCeo, f)), "정득종→이유억");
  assert.equal(names(resolveLineSteps(T.full, f)), "한도경→정득종→이유억");
  assert.equal(names(resolveLineSteps(T.headExec, f)), "한도경→정득종");
  assert.equal(names(resolveLineSteps(T.headOnly, f)), "한도경");
  const m = resolveLineSteps(T.managerProxy, f);
  assert.equal(names(m), "이재영");
  assert.deepEqual(m.steps[0].proxies.map((p) => p.name), ["이도희"]);
  assert.equal(m.steps[0].role, "manager");
});

test("연구소 — 부서장=임원 신총식은 한 번만", () => {
  const f = facts({ drafter: STAFF, heads: [SSK], exec: SSK });
  assert.equal(names(resolveLineSteps(T.full, f)), "신총식→이유억");
  const r = resolveLineSteps(T.headExec, f);
  assert.equal(names(r), "신총식");
  assert.equal(r.steps[0].role, "exec");
});

test("부서장 본인 — 부서장 단계를 빼고, 비면 임원으로 올림", () => {
  const f = facts({ drafter: HDG, heads: [HDG] });
  assert.equal(names(resolveLineSteps(T.full, f)), "정득종→이유억");
  assert.equal(names(resolveLineSteps(T.headExec, f)), "정득종");
  assert.equal(names(resolveLineSteps(T.headOnly, f)), "정득종");
  assert.equal(names(resolveLineSteps(T.manager, f)), "이재영");
});

test("임원 본인(정득종·권오종·김명호) — 대표이사로", () => {
  const f = facts({ drafter: JDJ, dept: "exec", heads: [], isExec: true });
  assert.equal(names(resolveLineSteps(T.full, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.headExec, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.headOnly, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.execCeo, f)), "이유억");
  // 총괄 부서에 부서장이 없어도 임원은 부서장 단계를 쓰지 않으므로 오류가 아니다
  assert.deepEqual(resolveLineSteps(T.headOnly, f).errors, []);
});

test("신총식 본인(부서장·임원) — 대표이사로", () => {
  const f = facts({ drafter: SSK, heads: [SSK], exec: SSK, isExec: true });
  assert.equal(names(resolveLineSteps(T.full, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.headOnly, f)), "이유억");
});

test("이재영 본인 관리자 양식 — 대표이사로(2026-11-03 확정), 휴가는 임원으로", () => {
  const f = facts({ drafter: LJY, heads: [LJY] });
  assert.equal(names(resolveLineSteps(T.managerProxy, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.manager, f)), "이유억");
  assert.equal(names(resolveLineSteps(T.headOnly, f)), "정득종");
});

test("이도희 본인 기안 — 지정 대결자에서 본인 제외", () => {
  const f = facts({ drafter: LDH, heads: [LJY] });
  const r = resolveLineSteps(T.managerProxy, f);
  assert.equal(names(r), "이재영");
  assert.deepEqual(r.steps[0].proxies, []);
});

test("대표이사 본인 — 관리자 양식 외에는 본인 1단계", () => {
  const f = facts({ drafter: CEO, dept: "exec", heads: [], isCeo: true, isExec: true });
  for (const t of [T.ceoOnly, T.execCeo, T.full, T.headExec, T.headOnly]) {
    const r = resolveLineSteps(t, f);
    assert.equal(names(r), "이유억");
    assert.equal(r.steps[0].userId, CEO.userId);
  }
  assert.equal(names(resolveLineSteps(T.managerProxy, f)), "이재영");
});

test("공석·복수 부서장·담당자 미지정은 오류", () => {
  assert.match(resolveLineSteps(T.headOnly, facts({ drafter: STAFF, heads: [] })).errors[0], /부서장이 지정돼 있지 않습니다/);
  assert.match(resolveLineSteps(T.full, facts({ drafter: STAFF, heads: [JOH, P("u-t", "테스트부장")] })).errors[0], /2명\(조옥환, 테스트부장\)/);
  assert.match(resolveLineSteps(T.execCeo, facts({ drafter: STAFF, exec: null })).errors[0], /'임원' 결재자가 지정돼 있지 않거나/);
  assert.match(resolveLineSteps(T.headOnly, facts({ drafter: STAFF, dept: null })).errors[0], /소속 부서가 없어/);
});

test("계약서·견적서 — 최종안일 때만 강제, 값이 없으면 최종안", () => {
  const t = tpl([{ role: "dept_head" }], { field: "doc_stage", equals: "final", whenMissing: "enforce" });
  assert.equal(isLineEnforced(t, {}), true);
  assert.equal(isLineEnforced(t, { doc_stage: "final" }), true);
  assert.equal(isLineEnforced(t, { doc_stage: "draft" }), false);
  const skip = tpl([{ role: "dept_head" }], { field: "doc_stage", equals: "final", whenMissing: "skip" });
  assert.equal(isLineEnforced(skip, {}), false);
  assert.equal(isLineEnforced({ ...t, enabled: false }, {}), false);
});

test("결재선 대조 — 순서·합의 차이는 불일치", () => {
  const steps = [JDJ, CEO];
  assert.equal(sameLineAssignees([{ assigneeUserId: "u-jdj" }, { assigneeUserId: "u-ceo", stepType: "approve" }], steps), true);
  assert.equal(sameLineAssignees([{ assigneeUserId: "u-ceo" }, { assigneeUserId: "u-jdj" }], steps), false);
  assert.equal(sameLineAssignees([{ assigneeUserId: "u-jdj", stepType: "agree" }, { assigneeUserId: "u-ceo" }], steps), false);
  assert.equal(sameLineAssignees([{ assigneeUserId: "u-jdj" }], steps), false);
});

test("템플릿 파싱 — 잘못된 역할은 버린다", () => {
  assert.deepEqual(parseTemplateSteps('[{"role":"ceo"},{"role":"boss"}]'), [{ role: "ceo" }]);
  assert.equal(parseEnforceWhen({ field: "" }), null);
});

test("부서장 기안 시 대표이사까지(347, 안 B) — 부서장만 올라가고 직원·연구소·임원은 그대로", () => {
  const headOnlyUp = { ...T.headOnly, headDrafterTo: "ceo" as const };
  const headExecUp = { ...T.headExec, headDrafterTo: "ceo" as const };
  // 부서장(한도경) 기안 — 휴가 등: 정득종 → 이유억, 교육: 정득종 → 이유억
  const head = facts({ drafter: HDG });
  assert.equal(names(resolveLineSteps(headOnlyUp, head)), "정득종→이유억");
  assert.equal(names(resolveLineSteps(headExecUp, head)), "정득종→이유억");
  assert.deepEqual(resolveLineSteps(headOnlyUp, head).steps.map((s) => s.role), ["exec", "ceo"]);
  // 옵션이 없으면 종전처럼 정득종 단독
  assert.equal(names(resolveLineSteps(T.headOnly, head)), "정득종");
  // 일반 직원 — 그대로
  const staff = facts({ drafter: STAFF });
  assert.equal(names(resolveLineSteps(headOnlyUp, staff)), "한도경");
  assert.equal(names(resolveLineSteps(headExecUp, staff)), "한도경→정득종");
  // 연구소 직원 — 그대로(부서장=임원 신총식)
  const lab = facts({ drafter: STAFF, heads: [SSK], exec: SSK });
  assert.equal(names(resolveLineSteps(headOnlyUp, lab)), "신총식");
  // 연구소장(임원 취급) 기안 — 그대로 대표이사 단독
  const labHead = facts({ drafter: SSK, heads: [SSK], exec: SSK, isExec: true });
  assert.equal(names(resolveLineSteps(headOnlyUp, labHead)), "이유억");
});

// 기안자별 추가 결재자·참조·열람(353, 2026-11-11 사용자 요청)
test("기안자별 추가 결재자 — 자리·중복·본인 제외", () => {
  const base = (people: LinePerson[]): FixedLineStep[] => people.map((p) => ({ ...p, role: "dept_head" as const, proxies: [] }));
  const line = base([HDG, JDJ, CEO]);
  const nm = (steps: FixedLineStep[]) => steps.map((s) => s.name).join("→");
  // 맨 앞 · 최종 결재자 바로 앞 · 맨 뒤
  assert.equal(nm(insertDrafterExtras(line, [{ person: JOH, position: "first" }], STAFF.userId)), "조옥환→한도경→정득종→이유억");
  assert.equal(nm(insertDrafterExtras(line, [{ person: JOH, position: "before_last" }], STAFF.userId)), "한도경→정득종→조옥환→이유억");
  assert.equal(nm(insertDrafterExtras(line, [{ person: JOH, position: "last" }], STAFF.userId)), "한도경→정득종→이유억→조옥환");
  // 추가 단계 표기 역할은 extra
  assert.deepEqual(insertDrafterExtras(line, [{ person: JOH, position: "first" }], STAFF.userId).map((s) => s.role), ["extra", "dept_head", "dept_head", "dept_head"]);
  // 이미 결재선에 있는 사람·기안자 본인·같은 사람 두 번은 건너뜀
  assert.equal(
    nm(
      insertDrafterExtras(
        line,
        [
          { person: JDJ, position: "first" },
          { person: STAFF, position: "first" },
          { person: LDH, position: "first" },
          { person: LDH, position: "last" },
          { person: LJY, position: "first" },
        ],
        STAFF.userId
      )
    ),
    "이도희→이재영→한도경→정득종→이유억"
  );
  // 결재자 1명 — 최종 결재자 바로 앞 = 그 사람 앞
  assert.equal(nm(insertDrafterExtras(base([HDG]), [{ person: JOH, position: "before_last" }], STAFF.userId)), "조옥환→한도경");
  // 해석 실패(빈 결재선)면 그대로
  assert.equal(insertDrafterExtras([], [{ person: JOH, position: "first" }], STAFF.userId).length, 0);
  // 표기
  assert.equal(describeFixedLine(insertDrafterExtras(base([HDG]), [{ person: JOH, position: "first" }], STAFF.userId)), "조옥환(추가 결재) → 한도경(부서장)");
});

test("기안자별 규칙 — 양식 행이 모든 양식 행을 덮어씀", () => {
  const rules = [
    { formId: "*", kind: "approve" as const, targetUserId: "u-a", position: "first" as const },
    { formId: "*", kind: "ref" as const, targetUserId: "u-b", position: null },
    { formId: "frm-leave", kind: "view" as const, targetUserId: "u-a", position: null },
    { formId: "frm-other", kind: "approve" as const, targetUserId: "u-c", position: "last" as const },
  ];
  const leave = pickDrafterRules(rules, "frm-leave");
  assert.deepEqual(leave.map((r) => `${r.targetUserId}:${r.kind}`), ["u-b:ref", "u-a:view"]);
  const trip = pickDrafterRules(rules, "frm-trip");
  assert.deepEqual(trip.map((r) => `${r.targetUserId}:${r.kind}`), ["u-a:approve", "u-b:ref"]);
  assert.equal(parseExtraPosition("weird"), "first");
  assert.equal(parseExtraPosition("before_last"), "before_last");
});
