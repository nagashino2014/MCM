// 예시 모드에서 실제 30초 로컬 타이머를 확인한다. 실제 AI 모드에서는 예약을 등록하지 않는다.
import assert from "node:assert/strict";
const base = "http://127.0.0.1:4174";
async function api(path, body, method = "POST") { const response = await fetch(base + path, body ? { method, headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) } : {}); const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value; }
const health = await api("/api/local-demo/health");
assert.equal(health.localIntelligenceDemo, true);
assert.equal(health.mode, "demo", "예시 검증은 demo 모드에서만 실행할 수 있습니다. 실제 모드의 유료 AI 호출을 막기 위해 중단했습니다.");
assert.equal(health.database, "intel_demo", "예시 검증 DB가 아니므로 중단했습니다.");
assert.equal(health.externalServices, false, "외부 서비스가 연결된 서버에서는 예시 검증을 실행하지 않습니다.");
const next = new Date(Math.ceil((Date.now() + 10000) / 60000) * 60000 + 9 * 3600000).toISOString();
let profile;
try {
  profile = (await api("/api/sales/rag/profiles", { name: "로컬 예약 타이머 실증", enabled: true, visibility: "private", recipients: [{ userId: "u1", channels: ["inbox"] }], schedule: { cadence: "daily", startDate: next.slice(0, 10), time: next.slice(11, 16), timezone: "Asia/Seoul", weekday: 1, monthDay: 1 }, allowPartialSources: true, notifyNoChange: true })).profile;
  console.log(`예약 시각: ${next.slice(0, 16)} KST / 실제 로컬 타이머 대기`);
  const deadline = Date.now() + 110000;
  let published;
  while (Date.now() < deadline) {
    const runs = (await api(`/api/sales/rag/runs?profileId=${profile.profileId}`)).runs;
    published = runs.find((run) => run.trigger === "scheduled" && run.status === "published");
    if (published) break;
    await new Promise((done) => setTimeout(done, 3000));
  }
  assert(published, "설정 시각 이후 정기 보고서가 발행되지 않았습니다.");
  const detail = await api(`/api/sales/rag/runs/${published.runId}`);
  assert(detail.deliveries.some((item) => item.channel === "inbox" && item.status === "sent"));
  console.log("PASS: 실제 예약 시각 → 30초 타이머 → 정기 발행 → 사내 수신함 전달");
} finally {
  if (profile) { const current = (await api(`/api/sales/rag/profiles/${profile.profileId}`)).profile; await api(`/api/sales/rag/profiles/${profile.profileId}`, { ...current, enabled: false }, "PATCH"); }
}
