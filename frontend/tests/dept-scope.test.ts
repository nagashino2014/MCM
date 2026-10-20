import assert from "node:assert/strict";
import test from "node:test";
import { allowedDeptIds, checkPermission, resolveDeptScope, type UserAccess, type ScopeKind } from "../lib/auth/rbac";

// 겸직(복수 부서 보직, 300) 판정 — docs/concurrent-dept-post-design-2026-10-20.md §4·§6.
// 한도경 사례: 주 소속 통합환경2(env2) + 화학안전(chem) 겸직 부서장.

function grant(permissionKey: string, scopeKind: ScopeKind, scopeDeptId: string | null = null) {
  return { permissionKey, scopeKind, scopeDeptId, effect: "allow" as const };
}

function access(partial: Partial<UserAccess>): UserAccess {
  return {
    userId: "u-han",
    role: "member",
    deptId: "env2",
    employeeId: "e-han",
    postDeptIds: ["env2"],
    headDeptIds: new Set(),
    participantContractIds: new Set(),
    participantProjectIds: new Set(),
    deptIds: new Set(),
    deptContractIds: new Set(),
    deptProjectIds: new Set(),
    deptContractsByDept: new Map(),
    deptProjectsByDept: new Map(),
    grants: [],
    ...partial,
  };
}

const concurrentHead = access({
  postDeptIds: ["env2", "chem"],
  headDeptIds: new Set(["env2", "chem"]),
  deptIds: new Set(["env2", "chem", "ulsan"]),
  deptContractsByDept: new Map([
    ["env2", new Set(["c-env2"])],
    ["chem", new Set(["c-chem"])],
    ["ulsan", new Set(["c-ulsan"])],
  ]),
  deptContractIds: new Set(["c-env2", "c-chem", "c-ulsan"]),
  grants: [
    grant("work_plan.view", "self_dept"),
    grant("billing.dept.view", "self_dept"),
    // 다른 키로 받은 지정 부서(울산) — L-1: 이 범위가 self_dept 키에 섞이면 안 된다
    grant("staffing.record.view", "specific_dept", "ulsan"),
  ],
});

test("self_dept = 주 소속 + 겸직 부서 모두", () => {
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { deptId: "env2" }), true);
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { deptId: "chem" }), true);
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { deptId: "env1" }), false);
  assert.deepEqual(resolveDeptScope(concurrentHead, "billing.dept.view"), { kind: "dept", deptIds: ["env2", "chem"] });
});

test("L-1: 다른 키의 지정 부서 계약이 self_dept 키에 통과하지 않는다", () => {
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { contractId: "c-chem" }), true);
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { contractId: "c-ulsan" }), false);
  assert.equal(checkPermission(concurrentHead, "staffing.record.view", { contractId: "c-ulsan" }), true);
  assert.equal(checkPermission(concurrentHead, "staffing.record.view", { contractId: "c-chem" }), false);
});

test("계약·부서 target 은 같은 부서에서 함께 만족해야 한다", () => {
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { contractId: "c-chem", deptId: "chem" }), true);
  assert.equal(checkPermission(concurrentHead, "work_plan.view", { contractId: "c-chem", deptId: "env2" }), false);
});

test("allowedDeptIds: 주 소속이 첫 번째, 전사는 null, 범위 없음은 빈 배열", () => {
  assert.deepEqual(allowedDeptIds(concurrentHead, "work_plan.view"), ["env2", "chem"]);
  const admin = access({ grants: [grant("work_plan.view", "all")] });
  assert.equal(allowedDeptIds(admin, "work_plan.view"), null);
  const staff = access({ grants: [grant("work_plan.view", "self")] });
  assert.deepEqual(allowedDeptIds(staff, "work_plan.view"), []);
});

test("겸직 없는 부서장은 종전과 같다(주 소속만)", () => {
  const lead = access({
    deptIds: new Set(["env1"]),
    deptId: "env1",
    postDeptIds: ["env1"],
    deptContractsByDept: new Map([["env1", new Set(["c-env1"])]]),
    grants: [grant("work_plan.view", "self_dept")],
  });
  assert.equal(checkPermission(lead, "work_plan.view", { deptId: "env1" }), true);
  assert.equal(checkPermission(lead, "work_plan.view", { deptId: "env2" }), false);
  assert.equal(checkPermission(lead, "work_plan.view", { contractId: "c-env1" }), true);
  assert.equal(checkPermission(lead, "work_plan.view", { contractId: "c-chem" }), false);
  assert.equal(checkPermission(lead, "work_plan.view"), true); // target 없음 = 목록 필터가 처리
});

test("보직이 하나도 없으면 self_dept 는 target 이 있을 때 불통과", () => {
  const noDept = access({ deptId: null, postDeptIds: [], grants: [grant("work_plan.view", "self_dept")] });
  assert.equal(checkPermission(noDept, "work_plan.view", { deptId: "env2" }), false);
  assert.deepEqual(resolveDeptScope(noDept, "work_plan.view"), { kind: "none" });
});
