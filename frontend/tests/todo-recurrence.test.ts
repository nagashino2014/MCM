import assert from "node:assert/strict";
import test from "node:test";
import { describeRecurrence, isValidRecurrence, nextOccurrence, parseRecurrence } from "../lib/todo/recurrence";

test("규칙 파싱·검증", () => {
  assert.deepEqual(parseRecurrence("daily"), { type: "daily" });
  assert.deepEqual(parseRecurrence("weekdays"), { type: "weekdays" });
  assert.deepEqual(parseRecurrence("weekly:WE,MO"), { type: "weekly", days: [0, 2] });
  assert.deepEqual(parseRecurrence("monthly:15"), { type: "monthly", day: 15 });
  assert.deepEqual(parseRecurrence("monthly:last"), { type: "monthly", day: "last" });
  assert.deepEqual(parseRecurrence("yearly:02-29"), { type: "yearly", month: 2, day: 29 });
  assert.deepEqual(parseRecurrence("after:7"), { type: "after", days: 7 });
  assert.equal(parseRecurrence("weekly:XX"), null);
  assert.equal(parseRecurrence("monthly:32"), null);
  assert.equal(parseRecurrence("hourly"), null);
  assert.equal(isValidRecurrence(null), true);
  assert.equal(isValidRecurrence(""), true);
  assert.equal(isValidRecurrence("after:0"), false);
});

test("매일·평일", () => {
  assert.equal(nextOccurrence("daily", "2026-10-13", "2026-10-13"), "2026-10-14");
  assert.equal(nextOccurrence("weekdays", "2026-10-16", "2026-10-16"), "2026-10-19"); // 금 → 월
  assert.equal(nextOccurrence("weekdays", "2026-10-14", "2026-10-14"), "2026-10-15");
});

test("매주 요일", () => {
  assert.equal(nextOccurrence("weekly:MO,WE", "2026-10-12", "2026-10-12"), "2026-10-14"); // 월 → 수
  assert.equal(nextOccurrence("weekly:MO,WE", "2026-10-14", "2026-10-14"), "2026-10-19"); // 수 → 다음 월
  assert.equal(nextOccurrence("weekly:MO", "2026-10-12", "2026-10-12"), "2026-10-19"); // 같은 요일은 7일 뒤
});

test("매월 — 31일 규칙은 말일로 당기고, 2월·윤년을 처리한다", () => {
  assert.equal(nextOccurrence("monthly:31", "2026-01-31", "2026-01-31"), "2026-02-28");
  assert.equal(nextOccurrence("monthly:31", "2026-02-28", "2026-02-28"), "2026-03-31");
  assert.equal(nextOccurrence("monthly:31", "2028-01-31", "2028-01-31"), "2028-02-29"); // 윤년
  assert.equal(nextOccurrence("monthly:last", "2026-02-28", "2026-02-28"), "2026-03-31");
  assert.equal(nextOccurrence("monthly:last", "2026-04-15", "2026-04-15"), "2026-04-30"); // 이달 말일이 아직이면 이달
  assert.equal(nextOccurrence("monthly:15", "2026-12-15", "2026-12-15"), "2027-01-15"); // 해 넘김
});

test("매년 — 02-29 는 평년에 02-28", () => {
  assert.equal(nextOccurrence("yearly:02-29", "2028-02-29", "2028-02-29"), "2029-02-28");
  assert.equal(nextOccurrence("yearly:02-29", "2027-02-28", "2027-02-28"), "2028-02-29");
  assert.equal(nextOccurrence("yearly:03-01", "2026-01-10", "2026-01-10"), "2026-03-01");
});

test("완료 후 N일은 완료일 기준", () => {
  assert.equal(nextOccurrence("after:7", "2026-09-01", "2026-10-13"), "2026-10-20");
  assert.equal(nextOccurrence("after:3", null, "2026-10-13"), "2026-10-16");
});

test("지난 반복을 뒤늦게 완료하면 완료일 이후 첫 발생으로 건너뛴다", () => {
  assert.equal(nextOccurrence("daily", "2026-10-01", "2026-10-13"), "2026-10-14");
  assert.equal(nextOccurrence("weekly:MO", "2026-09-07", "2026-10-13"), "2026-10-19");
  assert.equal(nextOccurrence("monthly:15", "2026-07-15", "2026-10-13"), "2026-10-15");
  assert.equal(nextOccurrence("monthly:15", "2026-07-15", "2026-10-20"), "2026-11-15");
});

test("do_date 가 없으면 완료일 기준, 규칙이 없거나 잘못되면 null", () => {
  assert.equal(nextOccurrence("daily", null, "2026-10-13"), "2026-10-14");
  assert.equal(nextOccurrence(null, "2026-10-13", "2026-10-13"), null);
  assert.equal(nextOccurrence("bogus", "2026-10-13", "2026-10-13"), null);
  assert.equal(nextOccurrence("daily", "2026-10-13", "20261013"), null);
});

test("한국어 설명", () => {
  assert.equal(describeRecurrence("weekly:MO,WE"), "매주 월·수");
  assert.equal(describeRecurrence("monthly:last"), "매월 말일");
  assert.equal(describeRecurrence("after:7"), "완료 후 7일");
  assert.equal(describeRecurrence("yearly:03-01"), "매년 3월 1일");
  assert.equal(describeRecurrence(null), null);
});
