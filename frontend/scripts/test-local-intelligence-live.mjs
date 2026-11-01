// 실제 Anthropic 요금이 발생한다. 사용자 승인 하에 MCM_RUN_PAID_AI_TEST=1로 명시 실행한다.
import assert from "node:assert/strict";
import pg from "pg";
if (process.env.MCM_RUN_PAID_AI_TEST !== "1") throw new Error("실제 AI 호출 검증에는 MCM_RUN_PAID_AI_TEST=1이 필요합니다.");
const base = "http://127.0.0.1:4174";
async function api(path, body, method = "POST") { const response = await fetch(base + path, body ? { method, headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) } : {}); const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value; }
const meta = await api("/api/local-demo/meta"); assert.equal(meta.mode, "real"); assert(meta.aiConfigured && meta.import?.importedSignals > 0 && meta.counts.sourceDocuments >= 3);
const title = "반도체 실제 수집 브리핑 · SK하이닉스";
let profile = (await api("/api/sales/rag/profiles")).profiles.find((profile) => profile.name === title);
if (!profile) profile = (await api("/api/sales/rag/profiles", { name: title, enabled: false, visibility: "private", filters: { industries: ["semiconductor"], regions: [], signalTypes: [], companyNames: ["SK하이닉스"], services: [], amountMin: null, amountMax: null, includeUnknownScale: true }, schedule: { cadence: "weekly", startDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), time: "08:30", weekday: 1, monthDay: 1, timezone: "Asia/Seoul" }, recipients: [{ userId: "u1", channels: ["inbox"] }], reportLevel: "summary", notifyNoChange: false, allowPartialSources: true, requiredSources: [], importantAlerts: false, importantAmount: null })).profile;
const preview = (await api(`/api/sales/rag/profiles/${profile.profileId}/preview`, {})).preview;
assert(preview.totalProjects > 0 && preview.totalSignals > 0);
console.log(JSON.stringify({profileId: profile.profileId,projects: preview.totalProjects,signals: preview.totalSignals,changed: preview.changedCount}));
let run = (await api(`/api/sales/rag/profiles/${profile.profileId}/run`, { requestKey: "real-local-first-validation-20261030" })).run;
const deadline = Date.now() + 600000; let status = ""; let detail;
while (Date.now() < deadline) {
  detail = await api(`/api/sales/rag/runs/${run.runId}`); run = detail.run;
  if (run.status !== status) { console.log(`RUN ${run.runId}: ${run.status}`); status = run.status; }
  if (["published", "failed", "blocked_budget", "canceled", "no_change"].includes(run.status)) break;
  await new Promise((done) => setTimeout(done, 3000));
}
assert.equal(run.status, "published", run.error ?? "실제 보고서 발행 실패");
assert(detail.briefing.report.trends.length > 0); assert(!JSON.stringify(detail.briefing.report).includes("로컬 예시 문구"));
assert(detail.briefing.sources.some((source) => source.kind === "official"));
const pdf = await fetch(`${base}/api/sales/rag/briefings/${run.briefingId}/export`); assert(pdf.ok); const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
detail = await api(`/api/sales/rag/runs/${run.runId}`); assert(detail.deliveries.length && detail.deliveries.every((item) => item.channel === "inbox" && item.status === "sent"));
const db = new pg.Client({ connectionString: "postgresql://mcm_intel_test@127.0.0.1:55439/intel_live", ssl: false });
try {
  await db.connect();
  const calls = (await db.query("SELECT model,status,http_status,request_id,input_tokens,output_tokens,cost_usd FROM ai_usage_log WHERE subject_id=$1 AND feature_key='intel.scheduled_briefing' ORDER BY log_id", [run.runId])).rows;
  assert(calls.length > 0); assert(calls.every((call) => call.status === "ok" && call.http_status === 200 && call.request_id && call.input_tokens > 0 && call.output_tokens > 0));
  console.log(JSON.stringify({runId: run.runId,briefingId: run.briefingId,model: calls[0].model,apiCalls: calls.length,inputTokens: calls.reduce((sum, call) => sum + Number(call.input_tokens),0),outputTokens: calls.reduce((sum, call) => sum + Number(call.output_tokens),0),costUsd: calls.reduce((sum, call) => sum + Number(call.cost_usd),0),sources: detail.briefing.sources.length,pdfBytes: bytes.length}));
  console.log(`PASS: 실제 수집 DB + KDI → 실제 AI API → 발행·PDF·로컬 수신함 / ${base}/sales/rag?tab=scheduled&runId=${run.runId}`);
} finally { await db.end(); }
