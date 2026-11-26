import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEAL_OUT_ALERT_SETTINGS,
  LONG_OUT_MINUTES,
  evaluateMealOutAlert,
  validateMealOutAlertSettings,
  isDeliveryVendor,
  pairReturn,
  secOfClock,
  summarizeByPerson,
  tagSecOnDay,
  type ReturnTag,
} from "../lib/approval/meal-return-pure";
import { evaluateMealRow, isOffDayNotAllowed } from "../lib/approval/overtime-meal";

const t = (hm: string, terminalId: string, eventCode: string): ReturnTag => ({ sec: secOfClock(hm)!, terminalId, eventCode });

test("결제 뒤 출입문 진입 태그 → 최소·최대 외출 시간", () => {
  const p = pairReturn(secOfClock("18:20")!, [t("17:55:10", "0006", "5"), t("19:40:30", "0006", "5"), t("21:05", "0007", "2")]);
  assert.equal(p.status, "tagged");
  assert.equal(p.minOutMinutes, 80); // 18:20 → 19:40:30
  assert.equal(p.maxOutMinutes, 105); // 17:55:10 → 19:40:30
  assert.equal(p.lastBefore?.terminalId, "0006");
});

test("1208호 출근 버튼(1)도 진입으로 본다", () => {
  const p = pairReturn(secOfClock("18:00")!, [t("18:30", "0005", "1")]);
  assert.equal(p.status, "tagged");
  assert.equal(p.minOutMinutes, 30);
  assert.equal(p.maxOutMinutes, null); // 직전 태그 없음
});

test("결제 뒤 첫 태그가 회의실·퇴근이면 진입 태그가 빠진 것 — 복귀 미기록", () => {
  const room = pairReturn(secOfClock("18:10")!, [t("19:00", "0004", "5"), t("19:30", "0006", "5")]);
  assert.equal(room.status, "untagged");
  assert.equal(room.minOutMinutes, null);
  assert.equal(room.next?.terminalId, "0004");
  const out = pairReturn(secOfClock("18:10")!, [t("20:00", "0007", "2")]);
  assert.equal(out.status, "untagged");
});

test("결제 뒤 태그가 없으면 태그 없음", () => {
  const p = pairReturn(secOfClock("18:10")!, [t("09:00", "0006", "5")]);
  assert.equal(p.status, "none");
  assert.equal(p.lastBefore?.sec, secOfClock("09:00"));
});

test("배달앱 결제는 짝짓지 않는다", () => {
  assert.equal(isDeliveryVendor("(주)우아한형제들"), true);
  assert.equal(isDeliveryVendor("쿠팡이츠"), true);
  assert.equal(isDeliveryVendor("김밥천국"), false);
  const p = pairReturn(secOfClock("18:10")!, [t("20:30", "0006", "5")], { delivery: true });
  assert.equal(p.status, "delivery");
  assert.equal(p.minOutMinutes, null);
});

test("익일 새벽 태그는 06:00 전까지만 그날로 본다", () => {
  assert.equal(tagSecOnDay("20261125", "20261126", "20261125", "235900"), 86340);
  assert.equal(tagSecOnDay("20261125", "20261126", "20261126", "003000"), 86400 + 1800);
  assert.equal(tagSecOnDay("20261125", "20261126", "20261126", "070000"), null);
  const p = pairReturn(secOfClock("23:40")!, [{ sec: 86400 + 600, terminalId: "0006", eventCode: "5" }]);
  assert.equal(p.minOutMinutes, 30);
});

test("직원별 요약 — 복귀 확인 건만 평균, 장시간 많은 순", () => {
  const s = summarizeByPerson([
    { employeeId: "a", status: "tagged", minOutMinutes: 20 },
    { employeeId: "a", status: "tagged", minOutMinutes: 30 },
    { employeeId: "b", status: "tagged", minOutMinutes: 90 },
    { employeeId: "b", status: "tagged", minOutMinutes: LONG_OUT_MINUTES },
    { employeeId: "b", status: "untagged", minOutMinutes: null },
  ]);
  assert.equal(s[0].employeeId, "b");
  assert.deepEqual(
    { count: s[0].count, tagged: s[0].tagged, avg: s[0].avgMinOut, max: s[0].maxMinOut, long: s[0].longCount },
    { count: 3, tagged: 2, avg: 75, max: 90, long: 2 }
  );
  assert.equal(s[1].avgMinOut, 25);
  assert.equal(s[1].longCount, 0);
});

test("휴일 식대는 신청 시간과 무관하게 불인정(379)", () => {
  const off = evaluateMealRow({ paidAtHm: "12:30", isOffDay: true, appliedMinutes: 480 });
  assert.deepEqual(off, { violation: true, requiredMinutes: 0 });
  assert.equal(isOffDayNotAllowed({ isOffDay: true, requiredMinutes: 0 }), true);
  assert.equal(isOffDayNotAllowed({ isOffDay: true, requiredMinutes: 240 }), false); // 이전 스냅샷
  // 평일 기준은 그대로 — 17시 이후 결제·신청 2시간
  assert.deepEqual(evaluateMealRow({ paidAtHm: "18:30", isOffDay: false, appliedMinutes: 120 }), { violation: false, requiredMinutes: 120 });
  assert.deepEqual(evaluateMealRow({ paidAtHm: "18:30", isOffDay: false, appliedMinutes: 90 }), { violation: true, requiredMinutes: 120 });
  assert.equal(evaluateMealRow({ paidAtHm: "12:30", isOffDay: false, appliedMinutes: 0 }), null);
});

test("반복 외출 경고 — 기준 이상인 날을 날짜 단위로 세고 횟수 이상이면 warn", () => {
  const rows = [
    { usedOn: "2026-11-03", status: "tagged" as const, minOutMinutes: 75 },
    { usedOn: "2026-11-03", status: "tagged" as const, minOutMinutes: 90 }, // 같은 날 나눠 결제 — 한 번만
    { usedOn: "2026-11-10", status: "tagged" as const, minOutMinutes: 60 }, // 기준과 같으면 포함
    { usedOn: "2026-11-12", status: "tagged" as const, minOutMinutes: 59 },
    { usedOn: "2026-11-14", status: "untagged" as const, minOutMinutes: null },
    { usedOn: "2026-11-18", status: "tagged" as const, minOutMinutes: 120 },
  ];
  const a = evaluateMealOutAlert(rows, { enabled: true, longOutMinutes: 60, repeatCount: 3 });
  assert.equal(a.warn, true);
  assert.deepEqual(a.days, [
    { usedOn: "2026-11-18", minOutMinutes: 120 },
    { usedOn: "2026-11-10", minOutMinutes: 60 },
    { usedOn: "2026-11-03", minOutMinutes: 90 },
  ]);
  assert.equal(evaluateMealOutAlert(rows, { enabled: true, longOutMinutes: 60, repeatCount: 4 }).warn, false);
  assert.equal(evaluateMealOutAlert(rows, { enabled: true, longOutMinutes: 80, repeatCount: 2 }).days.length, 2);
  assert.equal(evaluateMealOutAlert(rows, { enabled: false, longOutMinutes: 60, repeatCount: 1 }).warn, false);
});

test("반복 외출 경고 설정 검증 — 380 CHECK 범위와 같다", () => {
  assert.equal(validateMealOutAlertSettings(DEFAULT_MEAL_OUT_ALERT_SETTINGS), null);
  assert.deepEqual(DEFAULT_MEAL_OUT_ALERT_SETTINGS, { enabled: true, longOutMinutes: 60, lookbackDays: 30, repeatCount: 3 });
  assert.match(validateMealOutAlertSettings({ ...DEFAULT_MEAL_OUT_ALERT_SETTINGS, repeatCount: 0 }) ?? "", /경고 횟수/);
  assert.match(validateMealOutAlertSettings({ ...DEFAULT_MEAL_OUT_ALERT_SETTINGS, lookbackDays: 400 }) ?? "", /조회 기간/);
  assert.match(validateMealOutAlertSettings({ ...DEFAULT_MEAL_OUT_ALERT_SETTINGS, longOutMinutes: 45.5 }) ?? "", /외출 기준/);
  assert.match(validateMealOutAlertSettings({ ...DEFAULT_MEAL_OUT_ALERT_SETTINGS, longOutMinutes: NaN }) ?? "", /외출 기준/);
});

test("직원별 요약 — 설정한 외출 기준으로 장시간 건수를 센다", () => {
  const s = summarizeByPerson([{ employeeId: "a", status: "tagged", minOutMinutes: 50 }], 45);
  assert.equal(s[0].longCount, 1);
});
