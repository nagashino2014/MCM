import assert from "node:assert/strict";
import test from "node:test";
import { followAbsence, kstToday, pickAbsence, type AbsenceHit, type AbsenceRow } from "../lib/approval/absence-routing";

// 부재 판정(대결·건너뛰기) — docs/e-approval-delegation-blueprint.md §3·§5-1, 결정 D-1~D-5.

function row(partial: Partial<AbsenceRow>): AbsenceRow {
  return {
    absenceId: "a1",
    mode: "delegate",
    delegateUserId: "u-d",
    allowSelfAct: 1,
    startDate: "2026-10-21",
    endDate: "2026-10-30",
    createdAt: "2026-10-20T01:00:00.000Z",
    canceledAt: null,
    ...partial,
  };
}

function lookupOf(map: Record<string, AbsenceHit | null>) {
  return async (userId: string) => map[userId] ?? null;
}

const delegateTo = (delegateUserId: string, absenceId: string | null = "a-" + delegateUserId): AbsenceHit => ({
  mode: "delegate",
  delegateUserId,
  absenceId,
  source: "absence",
  allowSelfAct: true,
});
const skip: AbsenceHit = { mode: "skip", absenceId: "a-skip", source: "absence", allowSelfAct: true };

test("kstToday 는 UTC 15시 이후를 다음 날로 본다", () => {
  assert.equal(kstToday(new Date("2026-10-20T14:59:59Z")), "2026-10-20");
  assert.equal(kstToday(new Date("2026-10-20T15:00:00Z")), "2026-10-21");
  assert.equal(kstToday(new Date("2026-10-20T00:30:00Z")), "2026-10-20");
});

test("pickAbsence 는 기간 경계(시작·종료일 포함)와 취소를 지킨다", () => {
  assert.equal(pickAbsence([row({})], "2026-10-20"), null);
  assert.equal(pickAbsence([row({})], "2026-10-21")?.mode, "delegate");
  assert.equal(pickAbsence([row({})], "2026-10-30")?.mode, "delegate");
  assert.equal(pickAbsence([row({})], "2026-10-31"), null);
  assert.equal(pickAbsence([row({ canceledAt: "2026-10-20T02:00:00Z" })], "2026-10-25"), null);
});

test("pickAbsence 는 겹치는 부재 중 최근 등록분을 쓴다", () => {
  const hit = pickAbsence(
    [
      row({ absenceId: "old", mode: "delegate", createdAt: "2026-10-01T00:00:00Z" }),
      row({ absenceId: "new", mode: "skip", delegateUserId: null, createdAt: "2026-10-19T00:00:00Z" }),
    ],
    "2026-10-25"
  );
  assert.deepEqual(hit, { mode: "skip", absenceId: "new", source: "absence", allowSelfAct: true });
});

test("pickAbsence 는 allow_self_act 0 을 false 로 읽는다", () => {
  const hit = pickAbsence([row({ allowSelfAct: 0 })], "2026-10-25");
  assert.equal(hit?.allowSelfAct, false);
});

test("부재가 없으면 none", async () => {
  assert.deepEqual(await followAbsence("u-b", lookupOf({})), { kind: "none" });
});

test("건너뛰기 부재는 skip", async () => {
  assert.deepEqual(await followAbsence("u-b", lookupOf({ "u-b": skip })), { kind: "skip", absenceId: "a-skip", allowSelfAct: true });
});

test("대결자가 있으면 delegate, 원결재자의 부재 id 를 남긴다", async () => {
  const r = await followAbsence("u-b", lookupOf({ "u-b": delegateTo("u-d", "a-b") }));
  assert.deepEqual(r, { kind: "delegate", delegateUserId: "u-d", absenceId: "a-b", allowSelfAct: true, chain: ["u-b", "u-d"] });
});

test("대결자도 부재(대결)면 연쇄를 따라간다 — 3단계까지 허용", async () => {
  const r = await followAbsence(
    "u-b",
    lookupOf({ "u-b": delegateTo("u-d", "a-b"), "u-d": delegateTo("u-e"), "u-e": delegateTo("u-f") })
  );
  assert.equal(r.kind, "delegate");
  if (r.kind === "delegate") {
    assert.equal(r.delegateUserId, "u-f");
    assert.equal(r.absenceId, "a-b");
    assert.deepEqual(r.chain, ["u-b", "u-d", "u-e", "u-f"]);
  }
});

test("4단계 이상 연쇄는 unresolved(too_deep)", async () => {
  const r = await followAbsence(
    "u-b",
    lookupOf({ "u-b": delegateTo("u-d"), "u-d": delegateTo("u-e"), "u-e": delegateTo("u-f"), "u-f": delegateTo("u-g") })
  );
  assert.equal(r.kind, "unresolved");
  if (r.kind === "unresolved") assert.equal(r.reason, "too_deep");
});

test("순환 지정은 unresolved(cycle)", async () => {
  const r = await followAbsence("u-a", lookupOf({ "u-a": delegateTo("u-b"), "u-b": delegateTo("u-a") }));
  assert.equal(r.kind, "unresolved");
  if (r.kind === "unresolved") {
    assert.equal(r.reason, "cycle");
    assert.deepEqual(r.chain, ["u-a", "u-b", "u-a"]);
  }
});

test("대결자가 건너뛰기 부재면 unresolved(delegate_skip) — 원결재자 유지", async () => {
  const r = await followAbsence("u-b", lookupOf({ "u-b": delegateTo("u-d"), "u-d": skip }));
  assert.equal(r.kind, "unresolved");
  if (r.kind === "unresolved") assert.equal(r.reason, "delegate_skip");
});

test("대결자가 기안자면 unresolved(self) — 자기 결재 방지", async () => {
  const r = await followAbsence("u-b", lookupOf({ "u-b": delegateTo("u-drafter") }), { excludeUserIds: ["u-drafter"] });
  assert.equal(r.kind, "unresolved");
  if (r.kind === "unresolved") assert.equal(r.reason, "self");
});

test("휴가 연동 대결(absenceId null)도 delegate 로 해석된다", async () => {
  const leave: AbsenceHit = { mode: "delegate", delegateUserId: "u-d", absenceId: null, source: "leave", allowSelfAct: true };
  const r = await followAbsence("u-b", lookupOf({ "u-b": leave }));
  assert.equal(r.kind, "delegate");
  if (r.kind === "delegate") assert.equal(r.absenceId, null);
});
