import assert from "node:assert/strict";
import test from "node:test";
import { parseYmd, resolvePeriod, toRecordCategory, type ParticipationSource } from "../lib/staffing/records";

const base: ParticipationSource = {
  employeeId: "e1",
  contractId: "c1",
  contractTitle: "용역",
  clientName: "발주처",
  amount: 100_000_000,
  serviceType: "통합허가",
  serviceSubtype: "변경허가",
  roleLabels: ["실무(정)"],
  taskLabels: [],
  participatedFrom: null,
  participatedTo: null,
  contractStart: "2026-01-01",
  contractEnd: null,
  hiredAt: null,
  resignedAt: null,
  leftOn: null,
};
const TODAY = "2026-10-02";

test("수행기간 시작일은 계약 시작일이 아니라 입사일(더 늦은 날)", () => {
  const p = resolvePeriod({ ...base, hiredAt: "2026-02-01" }, TODAY);
  assert.equal(p.periodFrom, "2026-02-01");
  assert.equal(p.periodTo, null);
  assert.equal(p.ongoing, true);
});

test("퇴사자의 수행기간 종료일은 퇴사일", () => {
  const p = resolvePeriod({ ...base, hiredAt: "2020-03-02", resignedAt: "2026-05-31" }, TODAY);
  assert.deepEqual([p.periodFrom, p.periodTo, p.ongoing], ["2026-01-01", "2026-05-31", false]);
  assert.equal(p.periodDays, 151);
});

test("완료 계약은 계약 종료일, 투입 종료·제외 이력이 더 이르면 그 날", () => {
  assert.equal(resolvePeriod({ ...base, contractEnd: "2026-08-31" }, TODAY).periodTo, "2026-08-31");
  assert.equal(resolvePeriod({ ...base, contractEnd: "2026-08-31", participatedTo: "2026-04-30" }, TODAY).periodTo, "2026-04-30");
  assert.equal(resolvePeriod({ ...base, contractEnd: "2026-08-31", leftOn: "2026-03-15" }, TODAY).periodTo, "2026-03-15");
});

test("근거 날짜가 없거나 역전되면 수행기간을 만들지 않는다", () => {
  assert.equal(resolvePeriod({ ...base, contractStart: null }, TODAY).periodDays, null);
  // 입사 전에 끝난 계약
  assert.equal(resolvePeriod({ ...base, contractEnd: "2026-03-31", hiredAt: "2026-06-01" }, TODAY).periodFrom, null);
});

test("날짜 문구·용역 종류 정규화", () => {
  assert.equal(parseYmd("용역 완료시 까지"), null);
  assert.equal(parseYmd("2026.1.5"), "2026-01-05");
  assert.equal(parseYmd("2026-13-01"), null);
  assert.equal(toRecordCategory("장외&화관법"), "화관법");
  assert.equal(toRecordCategory("ESG탄소중립"), "ESG 탄소중립");
  assert.equal(toRecordCategory(""), "기타");
});
