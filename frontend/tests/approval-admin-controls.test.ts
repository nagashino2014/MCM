import assert from "node:assert/strict";
import test from "node:test";
import {
  adminEditableFields,
  adminValueText,
  normalizeAdminEditValue,
  sameAdminValue,
} from "../lib/approval/admin-edit-rules";
import { pickFormWatchers, type FixedWatcherRow } from "../lib/approval/fixed-watchers";
import { docNoPoolKey } from "../lib/approval/docs";
import type { ApprovalFieldDef } from "../lib/approval/fields";

// 결재 관리자 조치(346) — 고정 참조·열람자 고르기, 관리자 값 수정 규칙, 취소 문서 번호 반납 키.

const F = (key: string, type: ApprovalFieldDef["type"], extra: Partial<ApprovalFieldDef> = {}): ApprovalFieldDef => ({
  key,
  label: key,
  type,
  row: 1,
  ...extra,
});

test("고정 참조·열람자 — 모든 양식 행 + 양식 행이 같은 사람을 덮어쓴다, 퇴사자는 뺀다", () => {
  const rows: FixedWatcherRow[] = [
    { entryId: "1", formId: "*", userId: "u-admin", userName: "관리자", kind: "view", active: true },
    { entryId: "2", formId: "*", userId: "u-proxy", userName: "대리", kind: "ref", active: true },
    { entryId: "3", formId: "*", userId: "u-gone", userName: "퇴사", kind: "ref", active: false },
    { entryId: "4", formId: "frm-leave-request", userId: "u-admin", userName: "관리자", kind: "ref", active: true },
  ];
  assert.deepEqual(pickFormWatchers(rows, "frm-expense-report"), [
    { userId: "u-admin", kind: "view" },
    { userId: "u-proxy", kind: "ref" },
  ]);
  const leave = pickFormWatchers(rows, "frm-leave-request");
  assert.equal(leave.find((w) => w.userId === "u-admin")?.kind, "ref");
  assert.equal(leave.length, 2);
});

test("관리자 수정 대상 — 일자·시각·기간·글·선택만, 금액·표·사람·휴가 종류·내부 키는 제외", () => {
  const fields = [
    F("title_note", "text"),
    F("body", "multitext"),
    F("work_date", "period", { singleDay: true }),
    F("work_time", "time_range"),
    F("amount", "currency"),
    F("rows", "table"),
    F("companion", "user_select"),
    F("leave_type", "leave_type"),
    F("_ref_check", "text"),
    F("notice", "static"),
  ];
  assert.deepEqual(
    adminEditableFields(fields).map((f) => f.key),
    ["title_note", "body", "work_date", "work_time"]
  );
});

test("값 정규화 — 날짜·시각·기간·시간 범위 검사", () => {
  assert.deepEqual(normalizeAdminEditValue(F("d", "date"), "2026-11-09"), { ok: true, value: "2026-11-09" });
  assert.equal(normalizeAdminEditValue(F("d", "date"), "2026-02-30").ok, false);
  assert.equal(normalizeAdminEditValue(F("d", "date", { required: true }), "").ok, false);
  assert.deepEqual(normalizeAdminEditValue(F("t", "time"), "21:00"), { ok: true, value: "21:00" });
  assert.equal(normalizeAdminEditValue(F("t", "time"), "25:00").ok, false);
  // 1일 1건 기간은 to=from
  assert.deepEqual(normalizeAdminEditValue(F("p", "period", { singleDay: true }), { from: "2026-11-03", to: "2026-11-09" }), {
    ok: true,
    value: { from: "2026-11-03", to: "2026-11-03" },
  });
  assert.equal(normalizeAdminEditValue(F("p", "period"), { from: "2026-11-09", to: "2026-11-03" }).ok, false);
  // 시간 범위 — 종료가 이르면 익일 야간 표시가 있어야 한다
  assert.deepEqual(normalizeAdminEditValue(F("r", "time_range"), { start: "18:00", end: "21:00" }), {
    ok: true,
    value: { start: "18:00", end: "21:00" },
  });
  assert.equal(normalizeAdminEditValue(F("r", "time_range"), { start: "22:00", end: "01:00" }).ok, false);
  assert.deepEqual(normalizeAdminEditValue(F("r", "time_range"), { start: "22:00", end: "01:00", overnight: true }), {
    ok: true,
    value: { start: "22:00", end: "01:00", overnight: true },
  });
  // 선택형은 선택지 안에서만
  assert.equal(normalizeAdminEditValue(F("s", "select", { options: ["오전", "오후"] }), "저녁").ok, false);
  // 금액은 대상 아님
  assert.equal(normalizeAdminEditValue(F("a", "currency"), 1000).ok, false);
});

test("값 비교·표시", () => {
  assert.equal(sameAdminValue({ start: "18:00", end: "21:00" }, { end: "21:00", start: "18:00" }), true);
  assert.equal(sameAdminValue({ from: "2026-11-03", to: "2026-11-03" }, { from: "2026-11-04", to: "2026-11-04" }), false);
  assert.equal(sameAdminValue(null, ""), true);
  assert.equal(adminValueText("time_range", { start: "22:00", end: "01:00", overnight: true }), "22:00 ~ 익일 01:00");
  assert.equal(adminValueText("period", { from: "2026-11-03", to: "2026-11-03" }), "2026-11-03");
  assert.equal(adminValueText("period", { from: "2026-11-03", to: "2026-11-05" }), "2026-11-03 ~ 2026-11-05");
  assert.equal(adminValueText("multitext", "<p>회의&nbsp;메모</p>"), "회의 메모");
  assert.equal(adminValueText("date", null), "(비어 있음)");
});

test("취소 문서 번호 반납 키 — 일반·공문·내부고시·견적 형식", () => {
  assert.deepEqual(docNoPoolKey("휴가신청-2026-0042"), { rule: "휴가신청", year: "2026", seq: 42 });
  assert.deepEqual(docNoPoolKey("2026-대외-01003"), { rule: "대외", year: "2026", seq: 1003 });
  assert.deepEqual(docNoPoolKey("내부고시-0007호"), { rule: "내부고시", year: "ALL", seq: 7 });
  assert.deepEqual(docNoPoolKey("2026-화관법-0012"), { rule: "견적:화관법", year: "2026", seq: 12 });
  assert.equal(docNoPoolKey(null), null);
  assert.equal(docNoPoolKey("수기번호"), null);
});
