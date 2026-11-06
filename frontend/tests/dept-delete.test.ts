import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEPARTMENT_DELETE_BLOCKERS,
  DEPARTMENT_DELETE_CASCADES,
  DEPARTMENT_DELETE_RELEASED_FKS,
  departmentRefWhere,
} from "../lib/admin/department-references";

// 부서 삭제 규칙 — departments 를 FK 로 가리키는 컬럼이 빠짐없이 분류됐는지 마이그레이션과 대조한다.
// FK 대부분이 SET NULL·CASCADE 라, 빠뜨리면 삭제가 오류 없이 직원 소속·업무 기록을 비운다.

const SQL_DIR = path.join(process.cwd(), "..", "infra", "aws");

function departmentForeignKeys(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(SQL_DIR).filter((name) => /^\d+_.*\.sql$/.test(name))) {
    let table = "";
    for (const line of readFileSync(path.join(SQL_DIR, file), "utf8").split(/\r?\n/)) {
      const context = line.match(/\b(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: IF EXISTS)?)\s+(?:public\.)?(\w+)/i);
      if (context) table = context[1];
      const fk = line.match(/(\w+)\s+text\b[^,]*\bREFERENCES\s+(?:public\.)?departments\b/i);
      if (fk) found.add(`${table}.${fk[1]}`);
    }
  }
  return found;
}

test("departments 를 가리키는 FK 는 모두 막거나 풀어 주는 쪽으로 분류돼 있다", () => {
  const foreignKeys = departmentForeignKeys();
  assert.ok(foreignKeys.size >= 15, `FK 파싱 실패 의심: ${foreignKeys.size}개`);
  const classified = new Set([
    ...DEPARTMENT_DELETE_BLOCKERS.map((spec) => `${spec.table}.${spec.column}`),
    ...DEPARTMENT_DELETE_RELEASED_FKS,
  ]);
  const missing = [...foreignKeys].filter((key) => !classified.has(key));
  assert.deepEqual(missing, [], "새 FK 를 lib/admin/department-references.ts 에 분류하세요");
});

test("업무보고처럼 CASCADE 로 사라지는 업무 기록과 재직 직원은 삭제를 막는다", () => {
  const keys = DEPARTMENT_DELETE_BLOCKERS.map((spec) => spec.key);
  for (const key of ["work_plan_reports", "active_employees", "resigned_employees", "child_departments", "active_posts", "contracts"]) {
    assert.ok(keys.includes(key), key);
  }
});

test("보직은 활성만 막고 해제된 기록은 함께 지운다", () => {
  const blocker = DEPARTMENT_DELETE_BLOCKERS.find((spec) => spec.key === "active_posts");
  const cascade = DEPARTMENT_DELETE_CASCADES.find((spec) => spec.key === "revoked_posts");
  assert.equal(departmentRefWhere(blocker!), "t.dept_id = $1 AND t.revoked_at IS NULL");
  assert.equal(departmentRefWhere(cascade!), "t.dept_id = $1 AND t.revoked_at IS NOT NULL");
});

test("막는 사유마다 화면에 보여 줄 안내가 있다", () => {
  for (const spec of DEPARTMENT_DELETE_BLOCKERS) assert.ok(spec.hint.length > 0, spec.key);
  assert.equal(new Set(DEPARTMENT_DELETE_BLOCKERS.map((spec) => spec.key)).size, DEPARTMENT_DELETE_BLOCKERS.length);
});
