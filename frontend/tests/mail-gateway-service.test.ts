import assert from "node:assert/strict";
import test from "node:test";
import { getGatewayServiceStatus, syncGatewayService, toStatus, type GatewayEcs } from "../lib/mail/gateway-service";

function fakeEcs(init: { desired: number; running: number; pending: number } | null, fail = false) {
  const calls: number[] = [];
  let cur = init ? { ...init } : null;
  const ecs: GatewayEcs = {
    async describe() {
      if (fail) throw new Error("AccessDenied");
      return cur ? { ...cur } : null;
    },
    async setDesired(n) {
      calls.push(n);
      if (cur) cur = { ...cur, desired: n };
    },
  };
  return { ecs, calls };
}

test("상태 표시: 실행·켜는 중·끄는 중·꺼짐·조회 불가", () => {
  assert.equal(toStatus({ desired: 1, running: 1, pending: 0 }).state, "running");
  assert.equal(toStatus({ desired: 1, running: 0, pending: 1 }).state, "starting");
  assert.equal(toStatus({ desired: 0, running: 1, pending: 0 }).state, "stopping");
  assert.equal(toStatus({ desired: 0, running: 0, pending: 0 }).state, "stopped");
  assert.equal(toStatus(null, "x").state, "unavailable");
});

test("허용 스위치 → 대수 맞추기: 켜짐=1·꺼짐=0, 이미 맞으면 호출 안 함", async () => {
  const off = fakeEcs({ desired: 1, running: 1, pending: 0 });
  const r1 = await syncGatewayService(false, off.ecs);
  assert.deepEqual(off.calls, [0]);
  assert.equal(r1.desired, 0);
  assert.equal(r1.state, "stopping");

  const on = fakeEcs({ desired: 0, running: 0, pending: 0 });
  const r2 = await syncGatewayService(true, on.ecs);
  assert.deepEqual(on.calls, [1]);
  assert.equal(r2.state, "starting");

  const same = fakeEcs({ desired: 1, running: 1, pending: 0 });
  await syncGatewayService(true, same.ecs);
  assert.deepEqual(same.calls, []);
});

test("서비스 없음·권한 오류는 던지지 않고 조회 불가로 돌려준다", async () => {
  const none = fakeEcs(null);
  const r1 = await syncGatewayService(true, none.ecs);
  assert.equal(r1.available, false);
  assert.deepEqual(none.calls, []);
  const denied = fakeEcs({ desired: 0, running: 0, pending: 0 }, true);
  const r2 = await syncGatewayService(true, denied.ecs);
  assert.equal(r2.available, false);
  assert.equal(r2.error, "AccessDenied");
  assert.equal((await getGatewayServiceStatus(denied.ecs)).state, "unavailable");
});
