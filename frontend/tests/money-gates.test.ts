import assert from "node:assert/strict";
import test from "node:test";
import { planCollection, type PartialPaymentEntry } from "../lib/contracts/milestone-collection";
import { countPlanMismatch } from "../lib/bonus/plan-check";
import { capWeeklyOvertime, payPeriodOf } from "../lib/payroll/weekly-cap";

// F-18·F-19 수금 누적 규칙(lib/contracts/milestone-collection.ts) · F-20 성과급 기안 대조(lib/bonus/plan-check.ts) · F-21 주 연장 한도 배분

const NOW = "2026-10-20T00:00:00.000Z";
let seq = 0;
const nextId = () => `pp_t${++seq}`;

function entry(amount: number, extra: Partial<PartialPaymentEntry> = {}): PartialPaymentEntry {
  return { id: nextId(), collectedAt: "2026-10-01", amount, ratio: 0, memo: null, recordedBy: null, recordedAt: NOW, ...extra };
}

test("F-19 미수금 수금 등록 — 두 번째 부분입금이 앞선 입금에 누적된다", () => {
  const first = planCollection(
    { baseAmount: 1_000_000, entries: [], legacyCollected: 0, legacyCollectedAt: null },
    { mode: "add", amount: 300_000, collectedAt: "2026-10-01" },
    NOW,
    nextId
  );
  assert.equal(first.totalAmount, 300_000);
  assert.equal(first.isCollected, false);

  const second = planCollection(
    { baseAmount: 1_000_000, entries: first.entries, legacyCollected: first.totalAmount, legacyCollectedAt: "2026-10-01" },
    { mode: "add", amount: 200_000, collectedAt: "2026-10-10" },
    NOW,
    nextId
  );
  assert.equal(second.totalAmount, 500_000);
  assert.equal(second.entries.length, 2);
  assert.equal(second.isCollected, false, "잔액 50만원이 남아 미수금 현황에 계속 보여야 한다");

  const last = planCollection(
    { baseAmount: 1_000_000, entries: second.entries, legacyCollected: second.totalAmount, legacyCollectedAt: "2026-10-10" },
    { mode: "add", amount: 500_000, collectedAt: "2026-10-20" },
    NOW,
    nextId
  );
  assert.equal(last.totalAmount, 1_000_000);
  assert.equal(last.isCollected, true);
});

test("F-18 발행/수금 모달 — 부분 수금이면 완료(payment_collected=1)로 저장하지 않는다", () => {
  const partial = planCollection(
    { baseAmount: 1_100_000, entries: [], legacyCollected: 0, legacyCollectedAt: null },
    { mode: "total", amount: 500_000, collectedAt: "2026-10-01", memo: "일부 입금" },
    NOW,
    nextId
  );
  assert.equal(partial.isCollected, false);
  assert.equal(partial.totalAmount, 500_000);

  const full = planCollection(
    { baseAmount: 1_100_000, entries: [], legacyCollected: 0, legacyCollectedAt: null },
    { mode: "total", amount: 1_100_000, collectedAt: "2026-10-01" },
    NOW,
    nextId
  );
  assert.equal(full.isCollected, true);
});

test("total 모드 — 같은 합계를 다시 저장해도 항목이 두 번 쌓이지 않는다(모달 재저장)", () => {
  const entries = [entry(400_000)];
  const again = planCollection(
    { baseAmount: 1_000_000, entries, legacyCollected: 400_000, legacyCollectedAt: "2026-10-01" },
    { mode: "total", amount: 400_000, collectedAt: "2026-10-01" },
    NOW,
    nextId
  );
  assert.equal(again.entries.length, 1);
  assert.equal(again.added, null);
  assert.equal(again.totalAmount, 400_000);

  const lowered = planCollection(
    { baseAmount: 1_000_000, entries, legacyCollected: 400_000, legacyCollectedAt: "2026-10-01" },
    { mode: "total", amount: 300_000, collectedAt: "2026-10-05" },
    NOW,
    nextId
  );
  assert.equal(lowered.added?.amount, -100_000);
  assert.equal(lowered.totalAmount, 300_000);
});

test("자동대조 항목은 보존하고, collected_amount 만 있던 예전 기록은 항목으로 승격한다", () => {
  const recon = entry(300_000, { reconMatchId: "rm-1" });
  const r = planCollection(
    { baseAmount: 1_000_000, entries: [recon], legacyCollected: 300_000, legacyCollectedAt: "2026-10-01" },
    { mode: "add", amount: 100_000, collectedAt: "2026-10-02" },
    NOW,
    nextId
  );
  assert.equal(r.entries[0].reconMatchId, "rm-1");
  assert.equal(r.totalAmount, 400_000);

  const legacy = planCollection(
    { baseAmount: 1_000_000, entries: [], legacyCollected: 600_000, legacyCollectedAt: "2026-09-01" },
    { mode: "add", amount: 400_000, collectedAt: "2026-10-02" },
    NOW,
    nextId
  );
  assert.equal(legacy.entries.length, 2);
  assert.equal(legacy.totalAmount, 1_000_000);
  assert.equal(legacy.isCollected, true);

  // 예전 발행 경로가 합계를 항목으로 한 번 더 붙여 둔 경우(항목 합 80만 ≠ collected 40만) — 화면 기준(40만)에 맞춘 뒤 더한다.
  const drift = planCollection(
    { baseAmount: 1_000_000, entries: [entry(400_000), entry(400_000)], legacyCollected: 400_000, legacyCollectedAt: null },
    { mode: "add", amount: 100_000, collectedAt: "2026-10-02" },
    NOW,
    nextId
  );
  assert.equal(drift.totalAmount, 500_000);
});

test("잔액 면제는 명시적으로 체크했을 때만 완료 처리한다", () => {
  const base = { baseAmount: 1_000_000, entries: [], legacyCollected: 0, legacyCollectedAt: null };
  const forced = planCollection(base, { mode: "add", amount: 990_000, collectedAt: "2026-10-02", markCollected: true }, NOW, nextId);
  assert.equal(forced.isCollected, true);
  assert.equal(forced.totalAmount, 990_000);
  const plain = planCollection(base, { mode: "add", amount: 990_000, collectedAt: "2026-10-02" }, NOW, nextId);
  assert.equal(plain.isCollected, false);
});

test("F-20 기안 표와 현재 명세 대조 — 재산정으로 금액이 바뀌면 불일치", () => {
  const planRows = [
    { name: "김가", amount: "1,200,000" },
    { name: "이나", amount: "800,000" },
    { name: "이나", amount: "500,000" },
  ];
  const same = [
    { employeeName: "이나", totalAmount: 500_000 },
    { employeeName: "김가", totalAmount: 1_200_000.4 },
    { employeeName: "이나", totalAmount: 800_000 },
  ];
  assert.equal(countPlanMismatch(planRows, same), 0);

  const recalculated = [
    { employeeName: "김가", totalAmount: 1_250_000 },
    { employeeName: "이나", totalAmount: 800_000 },
    { employeeName: "이나", totalAmount: 500_000 },
  ];
  assert.equal(countPlanMismatch(planRows, recalculated), 1);

  const added = [...same, { employeeName: "박다", totalAmount: 300_000 }];
  assert.equal(countPlanMismatch(planRows, added), 1);
  assert.equal(countPlanMismatch(planRows, same.slice(1)), 1, "명세에서 빠진 인원");
  assert.equal(countPlanMismatch([], same), 3);
});

// F-21 주 연장 한도 배분(lib/payroll/weekly-cap.ts) — 12h 까지 수당, 넘는 몫은 대체휴가.
const H = 60;
const week = () => "2026-10-18";

test("F-21 주 12h 까지만 수당, 넘는 시간은 시간순으로 대체휴가로 넘긴다", () => {
  // 월~목 3h 씩(18:00~21:00, 주간) + 금 3h(21:00~24:00, 22시 이후 야간 2h) = 15h
  const rows = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].map((d, i) => ({
    docId: `d${i}`,
    employeeId: "e1",
    workDate: d,
    segs: [[18 * H, 21 * H]] as Array<[number, number]>,
  }));
  rows.push({ docId: "d4", employeeId: "e1", workDate: "2026-10-23", segs: [[21 * H, 24 * H]] });
  const shares = capWeeklyOvertime(rows, 12 * H, week);
  for (const id of ["d0", "d1", "d2", "d3"]) {
    assert.deepEqual(shares.get(id), { paidDay: 3 * H, paidNight: 0, excessDay: 0, excessNight: 0 });
  }
  // 금요일: 한도가 이미 찼으므로 3h 전부 휴가 — 21~22 주간 1h, 22~24 야간 2h
  assert.deepEqual(shares.get("d4"), { paidDay: 0, paidNight: 0, excessDay: 1 * H, excessNight: 2 * H });
});

test("F-21 한도를 넘는 날은 넘는 시각부터 잘라 실제 시간대로 주간/야간을 나눈다", () => {
  const rows = [
    { docId: "a", employeeId: "e1", workDate: "2026-10-19", segs: [[17 * H, 27 * H]] as Array<[number, number]> }, // 10h(익일 03시까지)
    { docId: "b", employeeId: "e1", workDate: "2026-10-20", segs: [[17 * H, 23 * H]] as Array<[number, number]> }, // 6h
  ];
  const s = capWeeklyOvertime(rows, 12 * H, week);
  // a: 17~22 주간 5h + 22~03 야간 5h 모두 한도 내(10h)
  assert.deepEqual(s.get("a"), { paidDay: 5 * H, paidNight: 5 * H, excessDay: 0, excessNight: 0 });
  // b: 17~19 수당(2h, 누적 12h) · 19~22 주간 3h + 22~23 야간 1h 휴가
  assert.deepEqual(s.get("b"), { paidDay: 2 * H, paidNight: 0, excessDay: 3 * H, excessNight: 1 * H });
});

test("F-21 직원·주가 다르면 한도를 따로 센다, 귀속 구간은 26일 기준", () => {
  const rows = [
    { docId: "x", employeeId: "e1", workDate: "2026-10-19", segs: [[0, 13 * H]] as Array<[number, number]> },
    { docId: "y", employeeId: "e2", workDate: "2026-10-19", segs: [[0, 13 * H]] as Array<[number, number]> },
    { docId: "z", employeeId: "e1", workDate: "2026-10-26", segs: [[0, 5 * H]] as Array<[number, number]> },
  ];
  const s = capWeeklyOvertime(rows, 12 * H, (d) => (d >= "2026-10-25" ? "2026-10-25" : "2026-10-18"));
  assert.equal(s.get("x")!.excessDay + s.get("x")!.excessNight, 1 * H);
  assert.equal(s.get("y")!.excessDay + s.get("y")!.excessNight, 1 * H);
  assert.equal(s.get("z")!.excessDay + s.get("z")!.excessNight, 0);
  assert.deepEqual(payPeriodOf("2026-10-25"), { year: 2026, month: 10 });
  assert.deepEqual(payPeriodOf("2026-10-26"), { year: 2026, month: 11 });
  assert.deepEqual(payPeriodOf("2026-12-28"), { year: 2027, month: 1 });
});
