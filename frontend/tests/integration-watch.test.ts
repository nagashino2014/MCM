import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWatchMessages,
  formatAge,
  judgeDailySlot,
  judgeFreshness,
  judgeWorkdayActivity,
  kstParts,
  kstTextToIso,
  planWatch,
  type CheckResult,
  type PrevState,
} from "../lib/ops/integration-watch-core";

const H = 3600 * 1000;
// 2026-10-30(금) 10:10 KST = 01:10Z
const NOW = Date.parse("2026-10-30T01:10:00Z");

test("KST 달력·경과 표기", () => {
  assert.deepEqual(kstParts(NOW), { ymd: "2026-10-30", hour: 10, dow: 5 });
  assert.deepEqual(kstParts(Date.parse("2026-10-30T15:30:00Z")), { ymd: "2026-10-31", hour: 0, dow: 6 });
  assert.equal(formatAge(45 * 60000), "45분");
  assert.equal(formatAge(5 * H), "5시간");
  assert.equal(formatAge(47 * H), "47시간");
  assert.equal(formatAge(76 * H), "3일 4시간");
  assert.equal(formatAge(29 * 24 * H), "29일");
});

test("KST 텍스트 → ISO", () => {
  assert.equal(kstTextToIso("2026-10-30 04:05:06"), "2026-10-29T19:05:06.000Z");
  assert.equal(kstTextToIso("2026-10-30 04:05"), "2026-10-29T19:05:00.000Z");
  assert.equal(kstTextToIso(null), null);
  assert.equal(kstTextToIso("어제"), null);
});

test("신선도 — 경계와 근거 없음", () => {
  // 야간 배치 03:01 KST 성공 → 같은 날 10:10 은 정상
  assert.equal(judgeFreshness("2026-10-29T18:01:00Z", NOW, 28).status, "ok");
  // 정확히 28시간 = 정상, 1분 넘기면 이상
  assert.equal(judgeFreshness(new Date(NOW - 28 * H).toISOString(), NOW, 28).status, "ok");
  const late = judgeFreshness(new Date(NOW - 28 * H - 60000).toISOString(), NOW, 28);
  assert.equal(late.status, "failing");
  assert.match(late.reason ?? "", /마지막 성공 28시간 전\(기준 28시간\)/);
  // 10-01 마지막 성공 → 10-30 이면 한 달 가까이(이번 사고)
  assert.match(judgeFreshness("2026-09-30T18:01:00Z", NOW, 28).reason ?? "", /29일 7시간 전/);
  // 기록 없음: 오류도 없으면 unknown, 오류가 있으면 failing
  assert.equal(judgeFreshness(null, NOW, 28).status, "unknown");
  assert.equal(judgeFreshness(null, NOW, 28, "connect ECONNREFUSED").status, "failing");
  assert.match(judgeFreshness(new Date(NOW - 40 * H).toISOString(), NOW, 28, "HTTP 500").reason ?? "", /최근 오류: HTTP 500/);
});

test("매일 정시 수집(공공입찰 07시)", () => {
  const at = (iso: string) => Date.parse(iso);
  // 10:10 KST, 오늘 수집함 → 정상
  assert.equal(judgeDailySlot("2026-10-30", 7, NOW).status, "ok");
  // 08:30 KST(마감 09시 전), 어제 수집 → 정상
  assert.equal(judgeDailySlot("2026-10-29", 7, at("2026-10-29T23:30:00Z")).status, "ok");
  // 09:00 KST 이후 오늘 수집 없음 → 이상
  const miss = judgeDailySlot("2026-10-29", 7, at("2026-10-30T00:00:00Z"));
  assert.equal(miss.status, "failing");
  assert.match(miss.reason ?? "", /오늘 7시 수집이 없음\(마지막 2026-10-29\)/);
  // 마감 전이라도 그저께가 마지막이면 이상
  assert.equal(judgeDailySlot("2026-10-28", 7, at("2026-10-29T23:30:00Z")).status, "failing");
  assert.equal(judgeDailySlot(null, 7, NOW).status, "failing");
});

test("근무일 근태 태그 — 시간대·휴일", () => {
  // 10:10 은 판정 시간 전
  assert.equal(judgeWorkdayActivity(null, NOW, true).status, "skip");
  const noon = Date.parse("2026-10-30T03:00:00Z"); // 12:00 KST
  assert.equal(judgeWorkdayActivity(new Date(noon - 2 * H).toISOString(), noon, true).status, "ok");
  const quiet = judgeWorkdayActivity(new Date(noon - 5 * H).toISOString(), noon, true);
  assert.equal(quiet.status, "failing");
  assert.match(quiet.reason ?? "", /^마지막 출입 태그 5시간 전/);
  // 휴일·19시 이후는 skip
  assert.equal(judgeWorkdayActivity(null, noon, false).status, "skip");
  assert.equal(judgeWorkdayActivity(null, Date.parse("2026-10-30T10:00:00Z"), true).status, "skip");
});

function result(key: string, status: CheckResult["status"], reason: string | null = null): CheckResult {
  return { key, grp: "intel", label: key, status, reason, lastOkAt: null };
}

test("전이 — 신규 이상·지속 재알림·복구·skip 유지", () => {
  const prev = new Map<string, PrevState>([
    ["a", { key: "a", status: "ok", failingSince: null, lastAlertAt: null }],
    ["b", { key: "b", status: "failing", failingSince: "2026-10-28T00:00:00Z", lastAlertAt: new Date(NOW - 25 * H).toISOString() }],
    ["c", { key: "c", status: "failing", failingSince: "2026-10-30T00:00:00Z", lastAlertAt: new Date(NOW - 2 * H).toISOString() }],
    ["d", { key: "d", status: "failing", failingSince: "2026-10-29T01:10:00Z", lastAlertAt: "2026-10-29T01:10:00Z" }],
    ["e", { key: "e", status: "failing", failingSince: "2026-10-29T00:00:00Z", lastAlertAt: "2026-10-29T00:00:00Z" }],
  ]);
  const plan = planWatch(
    prev,
    [result("a", "failing", "x"), result("b", "failing", "y"), result("c", "failing"), result("d", "ok"), result("e", "skip"), result("f", "unknown")],
    NOW
  );
  assert.deepEqual(plan.newlyFailing.map((r) => r.key), ["a"]);
  assert.deepEqual(plan.reminders.map((r) => r.key), ["b"]); // c 는 2시간 전에 알림 → 재알림 안 함
  assert.deepEqual(plan.recovered.map((r) => r.key), ["d"]);
  const next = new Map(plan.next.map((n) => [n.key, n]));
  const nowIso = new Date(NOW).toISOString();
  assert.equal(next.get("a")?.failingSince, nowIso);
  assert.equal(next.get("a")?.lastAlertAt, nowIso);
  assert.equal(next.get("b")?.failingSince, "2026-10-28T00:00:00Z");
  assert.equal(next.get("b")?.lastAlertAt, nowIso);
  assert.equal(next.get("c")?.lastAlertAt, new Date(NOW - 2 * H).toISOString());
  assert.equal(next.get("d")?.status, "ok");
  assert.equal(next.get("d")?.failingSince, null);
  assert.equal(next.get("e")?.status, "failing"); // skip 은 이전 상태 유지 — 알림 없음
  assert.equal(next.get("e")?.failingSince, "2026-10-29T00:00:00Z");
  assert.equal(next.get("f")?.status, "unknown");
  assert.equal(plan.next.length, 6);
});

test("처음 보는 대상이 바로 이상이면 신규 알림", () => {
  const plan = planWatch(new Map(), [result("new", "failing", "z")], NOW);
  assert.deepEqual(plan.newlyFailing.map((r) => r.key), ["new"]);
});

test("알림 본문 묶음", () => {
  const plan = planWatch(
    new Map<string, PrevState>([
      ["b", { key: "b", status: "failing", failingSince: null, lastAlertAt: null }],
      ["d", { key: "d", status: "failing", failingSince: new Date(NOW - 50 * H).toISOString(), lastAlertAt: null }],
    ]),
    [result("a", "failing", "마지막 성공 30시간 전"), result("b", "failing", "오류"), result("d", "ok")],
    NOW
  );
  const m = buildWatchMessages(plan, NOW);
  assert.equal(m.failing?.title, "외부 연동 이상 2건");
  assert.equal(m.failing?.body, "• a: 마지막 성공 30시간 전\n• b: 오류 (계속 이상)");
  assert.equal(m.recovered?.title, "외부 연동 복구 1건");
  assert.equal(m.recovered?.body, "• d: 정상화(이상 2일 2시간 지속)");
  assert.deepEqual(buildWatchMessages(planWatch(new Map(), [result("x", "ok")], NOW), NOW), { failing: null, recovered: null });
});
