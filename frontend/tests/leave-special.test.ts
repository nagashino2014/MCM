import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  DEFAULT_LEAVE_TYPES,
  SPECIAL_LEAVE_TYPE_KINDS,
  specialKindOf,
  specialLeaveSubmitError,
  specialLeaveUseAmount,
  specialRemainingDays,
  specialRemainingText,
  visibleLeaveTypes,
  type SpecialLeaveBalance,
} from "../lib/approval/leave-types";
import { PgDatabase, invalidateDb } from "../lib/db";
import {
  checkSpecialLeaveOnSubmit,
  deleteLeaveUsageForDoc,
  getMySpecialLeaveRemaining,
  recordLeaveUsageOnApproval,
} from "../lib/approval/leave";

// 휴가신청 특별휴가 선택지(363) — 직원 개선 요청 18(2026-11-12): 잔여가 있는 직원에게만 보이고,
// 서버는 잔여를 넘는 상신을 막고, 승인하면 특별휴가 원장에서 차감한다.

const catalog = DEFAULT_LEAVE_TYPES.map((t, i) => ({ ...t, sortOrder: i, active: true }));
const keys = (list: { key: string }[]) => list.map((t) => t.key);

test("카탈로그 기본값과 363 의 key 가 원장 kind 에 연결된다", async () => {
  assert.equal(specialKindOf("special_longevity"), "longevity");
  assert.equal(specialKindOf("special_overtime_comp"), "overtime_comp");
  assert.equal(specialKindOf("longevity_self"), null, "수연(본인)은 경조 휴가 — 특별휴가가 아니다");
  assert.equal(specialKindOf("annual"), null);
  for (const key of Object.keys(SPECIAL_LEAVE_TYPE_KINDS)) {
    const item = DEFAULT_LEAVE_TYPES.find((t) => t.key === key);
    assert.ok(item, `${key} 가 기본 카탈로그에 있어야 기본값 복원 때 사라지지 않는다`);
    assert.equal(item!.deduct, null);
    assert.equal(item!.days, null);
  }
  const sql = await readFile("../infra/aws/363_leave_types_special_leave.sql", "utf8");
  for (const key of Object.keys(SPECIAL_LEAVE_TYPE_KINDS)) assert.ok(sql.includes(`'${key}'`), `363 이 ${key} 를 넣어야 한다`);
});

test("선택지 — 잔여가 없으면 특별휴가를 숨기고, 있으면 그 종류만 보인다", () => {
  const none = visibleLeaveTypes(catalog, []);
  assert.ok(!keys(none).includes("special_longevity"));
  assert.ok(!keys(none).includes("special_overtime_comp"));
  assert.ok(keys(none).includes("annual") && keys(none).includes("longevity_self"), "일반 휴가는 그대로");

  const longevityOnly: SpecialLeaveBalance[] = [{ kind: "longevity", remaining: 3, unit: "day" }];
  const shown = keys(visibleLeaveTypes(catalog, longevityOnly));
  assert.ok(shown.includes("special_longevity"));
  assert.ok(!shown.includes("special_overtime_comp"));

  // 잔여 0 이하(다 쓴 경우)는 없는 것과 같다
  assert.ok(!keys(visibleLeaveTypes(catalog, [{ kind: "longevity", remaining: 0, unit: "day" }])).includes("special_longevity"));
});

test("선택지 — 이미 저장된 값(임시저장·반려 문서)은 잔여가 없어도 남긴다", () => {
  const kept = keys(visibleLeaveTypes(catalog, [], "special_longevity"));
  assert.ok(kept.includes("special_longevity"));
  assert.ok(!kept.includes("special_overtime_comp"));
});

test("잔여 표기 — 일·시간 단위, 시간은 8시간 = 1일로 환산", () => {
  const b: SpecialLeaveBalance[] = [
    { kind: "longevity", remaining: 3, unit: "day" },
    { kind: "overtime_comp", remaining: 12, unit: "hour" },
  ];
  assert.equal(specialRemainingText(b, "longevity"), "잔여 3일");
  assert.equal(specialRemainingText(b, "overtime_comp"), "잔여 12시간");
  assert.equal(specialRemainingText([], "longevity"), null);
  assert.equal(specialRemainingDays(b, "overtime_comp"), 1.5);
  assert.equal(specialRemainingDays(b, "longevity"), 3);
  assert.equal(specialRemainingText([...b, { kind: "overtime_comp", remaining: 1, unit: "day" }], "overtime_comp"), "잔여 1일 + 12시간");
});

test("상신 검증 — 잔여 없음·잔여 초과·결재 중인 신청분 차감", () => {
  assert.match(specialLeaveSubmitError({ label: "장기근속휴가", useDays: 1, remainingDays: 0 })!, /잔여가 없어/);
  assert.equal(specialLeaveSubmitError({ label: "장기근속휴가", useDays: 3, remainingDays: 3 }), null);
  assert.match(specialLeaveSubmitError({ label: "장기근속휴가", useDays: 4, remainingDays: 3 })!, /잔여 3일보다 많이/);
  const msg = specialLeaveSubmitError({ label: "장기근속휴가", useDays: 2, remainingDays: 3, pendingDays: 2 })!;
  assert.match(msg, /잔여 1일 \(결재 중인 다른 신청 2일 제외\)/);
  assert.match(specialLeaveSubmitError({ label: "장기근속휴가", useDays: 0, remainingDays: 3 })!, /사용일수/);
});

test("승인 차감량 — 장기근속은 일, 초과근무 대체는 일수 × 8시간", () => {
  assert.deepEqual(specialLeaveUseAmount("longevity", 2), { amount: 2, unit: "day" });
  assert.deepEqual(specialLeaveUseAmount("overtime_comp", 1.5), { amount: 12, unit: "hour" });
});

// ── 독립 PostgreSQL 통합 — LEAVE_SPECIAL_TEST_DATABASE_URL(127.0.0.1 의 leave_special_test DB)이 있을 때만 ──
const rawUrl = process.env.LEAVE_SPECIAL_TEST_DATABASE_URL;
test("독립 PostgreSQL — 상신 거부·승인 차감·관리자 회수", { skip: !rawUrl && "LEAVE_SPECIAL_TEST_DATABASE_URL 없음" }, async (t) => {
  const url = new URL(rawUrl!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "로컬 DB 에서만 돈다");
  assert.equal(url.pathname, "/leave_special_test");
  const adminUrl = new URL(rawUrl!);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString(), ssl: false });
  try {
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='leave_special_test'")).rowCount) await admin.query("CREATE DATABASE leave_special_test");
  } finally {
    await admin.end();
  }
  process.env.DATABASE_URL = rawUrl;
  process.env.PGSSL = "disable";
  const client = new Client({ connectionString: rawUrl, ssl: false });
  t.after(async () => {
    await Promise.allSettled([invalidateDb(), client.end()]);
  });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  // 운영과 같은 마이그레이션 파일로 표를 만든다(연차 대장 본체는 084 의 해당 부분만).
  await client.query(`
    CREATE TABLE annual_leave_ledger (entry_id text PRIMARY KEY, employee_id text NOT NULL, year text NOT NULL,
      entry_type text NOT NULL, days double precision NOT NULL, doc_id text, note text, created_by text, created_at text NOT NULL);
    CREATE TABLE users (user_id text PRIMARY KEY, employee_id text);
    CREATE TABLE approval_docs (doc_id text PRIMARY KEY, form_id text NOT NULL, drafter_user_id text, drafter_employee_id text,
      doc_no text, status text NOT NULL, field_values jsonb);
  `);
  for (const f of ["086_leave_types.sql", "087_leave_usage_history.sql", "133_special_leave.sql", "134_special_leave_unit.sql", "146_leave_types_fixed_one_day.sql", "363_leave_types_special_leave.sql"]) {
    await client.query(await readFile(`../infra/aws/${f}`, "utf8"));
  }
  await client.query(await readFile("../infra/aws/363_leave_types_special_leave.sql", "utf8")); // 재적용 멱등
  const special = await client.query("SELECT key FROM leave_types WHERE key LIKE 'special_%' ORDER BY key");
  assert.deepEqual(special.rows.map((r: { key: string }) => r.key), ["special_longevity", "special_overtime_comp"]);

  const db = new PgDatabase(client);
  await client.query(`INSERT INTO users VALUES ('u-a', 'emp-a'), ('u-b', 'emp-b')`);
  // 직원 A: 장기근속 3일(소멸일 미래) + 지난 소멸분 5일(무시), 직원 B: 없음
  await client.query(`INSERT INTO special_leave_ledger (entry_id, employee_id, kind, entry_type, days, unit, effective_on, expires_on, created_at) VALUES
    ('g1', 'emp-a', 'longevity', 'grant', 3, 'day', '2026-03-01', '2036-02-28', now()::text),
    ('g0', 'emp-a', 'longevity', 'grant', 5, 'day', '2016-03-01', '2020-02-28', now()::text)`);
  const doc = (id: string, user: string, emp: string, status: string, days: string, type = "special_longevity", from = "2026-11-16") =>
    client.query(`INSERT INTO approval_docs VALUES ($1, 'frm-leave-request', $2, $3, $4, $5, $6::jsonb)`, [
      id, user, emp, `휴가-${id}`, status,
      JSON.stringify({ leave_type: type, use_days: days, leave_period: { from, to: from } }),
    ]);
  const check = (docId: string, user: string, fv: Record<string, unknown>) => checkSpecialLeaveOnSubmit(db, { docId, drafterUserId: user, fieldValues: fv });

  assert.deepEqual(await getMySpecialLeaveRemaining("u-a"), [{ kind: "longevity", label: "장기근속휴가", remaining: 3, unit: "day" }]);
  assert.deepEqual(await getMySpecialLeaveRemaining("u-b"), []);

  // 잔여 없는 직원 B 는 거부, 일반 연차는 이 검사와 무관
  assert.match((await check("d-b", "u-b", { leave_type: "special_longevity", use_days: "1" }))!, /잔여가 없어/);
  assert.equal(await check("d-b", "u-b", { leave_type: "annual", use_days: "1" }), null);
  // 직원 A: 3일 이내 통과, 4일 거부
  assert.equal(await check("d-a1", "u-a", { leave_type: "special_longevity", use_days: "2" }), null);
  assert.match((await check("d-a1", "u-a", { leave_type: "special_longevity", use_days: "4" }))!, /잔여 3일보다/);
  // 결재 중인 다른 신청 2일이 있으면 남은 1일까지만
  await doc("d-a0", "u-a", "emp-a", "in_progress", "2");
  assert.match((await check("d-a1", "u-a", { leave_type: "special_longevity", use_days: "2" }))!, /결재 중인 다른 신청 2일 제외/);
  assert.equal(await check("d-a1", "u-a", { leave_type: "special_longevity", use_days: "1" }), null);

  // 승인 → 연차 대장에는 연차 외 사용, 특별휴가 원장에는 use 2일
  await client.query(`UPDATE approval_docs SET status = 'approved' WHERE doc_id = 'd-a0'`);
  await recordLeaveUsageOnApproval(db, "d-a0");
  await recordLeaveUsageOnApproval(db, "d-a0"); // 두 번 불러도 한 번만
  const annual = await client.query(`SELECT leave_type_key, days FROM annual_leave_ledger WHERE doc_id = 'd-a0'`);
  assert.deepEqual(annual.rows, [{ leave_type_key: "special_longevity", days: 2 }]);
  const uses = await client.query(`SELECT kind, unit, days::float AS days FROM special_leave_ledger WHERE doc_id = 'd-a0' AND entry_type = 'use'`);
  assert.deepEqual(uses.rows, [{ kind: "longevity", unit: "day", days: 2 }]);
  assert.equal((await getMySpecialLeaveRemaining("u-a"))[0]?.remaining, 1);

  // 관리자 결재 취소·문서 삭제 경로 — 두 원장 모두 회수
  assert.equal(await deleteLeaveUsageForDoc(db, "d-a0"), 1);
  assert.equal((await client.query(`SELECT 1 FROM special_leave_ledger WHERE doc_id = 'd-a0'`)).rowCount, 0);
  assert.equal((await getMySpecialLeaveRemaining("u-a"))[0]?.remaining, 3);

  // 초과근무 대체휴가 — 시간 원장 16h 를 일 단위 신청 1.5일(12h)로 사용
  await client.query(`INSERT INTO special_leave_ledger (entry_id, employee_id, kind, entry_type, days, unit, effective_on, source, ref_key, created_at)
    VALUES ('ot1', 'emp-b', 'overtime_comp', 'grant', 16, 'hour', '2026-11-02', 'auto_overtime', 'ot-2026-11-02', now()::text)`);
  assert.match((await check("d-b2", "u-b", { leave_type: "special_overtime_comp", use_days: "3" }))!, /잔여 2일보다/);
  await doc("d-b2", "u-b", "emp-b", "approved", "1.5", "special_overtime_comp");
  await recordLeaveUsageOnApproval(db, "d-b2");
  const ot = await client.query(`SELECT unit, days::float AS days FROM special_leave_ledger WHERE doc_id = 'd-b2'`);
  assert.deepEqual(ot.rows, [{ unit: "hour", days: 12 }]);
  assert.deepEqual(await getMySpecialLeaveRemaining("u-b"), [{ kind: "overtime_comp", label: "초과근무 대체휴가", remaining: 4, unit: "hour" }]);

  // 일반 휴가(연차) 승인은 특별휴가 원장을 건드리지 않는다
  await doc("d-b3", "u-b", "emp-b", "approved", "1", "annual");
  await recordLeaveUsageOnApproval(db, "d-b3");
  assert.equal((await client.query(`SELECT 1 FROM special_leave_ledger WHERE doc_id = 'd-b3'`)).rowCount, 0);
});
