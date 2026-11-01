// 사용자 요청에 따른 실제 AI 요약 검증. 외부 메시지 발송은 없고 로컬 수신함만 사용한다.
import assert from "node:assert/strict";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const existingRunId = process.env.MCM_QUALITY_EXISTING_RUN_ID;
if (!existingRunId && process.env.MCM_RUN_PAID_AI_TEST !== "1") throw new Error("실제 AI 호출 검증에는 MCM_RUN_PAID_AI_TEST=1이 필요합니다.");
const base = "http://127.0.0.1:4174";
async function api(path, body) { const response = await fetch(base + path, body ? { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) } : {}); const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value; }
assert.equal((await api("/api/local-demo/health")).mode, "real");
const previous = await api("/api/sales/rag/runs/ibr_df899b9bc37e4783a754a4f55b10232b");
const profile = (await api("/api/sales/rag/profiles")).profiles.find(profile => profile.profileId === previous.run.profileId);
assert(profile && !profile.enabled);
const key = process.env.MCM_QUALITY_REQUEST_KEY || "real-local-quality-validation-20261031-v1";
let run = existingRunId ? (await api(`/api/sales/rag/runs/${encodeURIComponent(existingRunId)}`)).run : (await api(`/api/sales/rag/profiles/${profile.profileId}/run`, { requestKey: key })).run;
assert.equal(run.profileId, profile.profileId);
if (existingRunId) assert.equal(run.status, "published", "읽기 검증은 발행된 회차만 선택하세요.");
else assert.equal((await api(`/api/sales/rag/profiles/${profile.profileId}/run`, { requestKey: key })).run.runId, run.runId);
const deadline = Date.now() + 900000; let state = "", detail;
while (Date.now() < deadline) {
  detail = await api(`/api/sales/rag/runs/${run.runId}`); run = detail.run;
  if (state !== run.status) { console.log(`RUN ${run.runId}: ${run.status}`); state = run.status; }
  if (["published", "failed", "blocked_budget", "canceled", "no_change"].includes(run.status)) break;
  await new Promise(done => setTimeout(done, 3000));
}
assert.equal(run.status, "published", run.error || "실제 요약 발행 실패");
const report = detail.briefing.report;
assert(report.trends.length > 0 && report.trends.length <= 15);
assert(report.trends.length < previous.briefing.report.trends.length);
assert(report.companies.length > 0 && report.companies.length < previous.briefing.report.companies.length);
assert(report.insights.length <= 8);
const ranks = { "우선 검토": 0, "확인 필요": 1, "참고": 2 };
for (let i = 0; i < report.insights.length; i++) {
  assert(report.insights[i].badge in ranks);
  if (i) { const a = report.insights[i - 1], b = report.insights[i]; assert(ranks[a.badge] <= ranks[b.badge]); if (a.badge === b.badge) assert((a.importance ?? 0) >= (b.importance ?? 0)); }
}
const texts = [...report.trends, ...report.companies.map(item => item.desc), ...report.insights.map(item => item.text)];
for (const text of texts) { const citations = [...text.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])); assert(citations.length && citations.every(n => n > 0 && n <= detail.briefing.sources.length)); }
assert(detail.briefing.sources.some(source => source.kind === "official"));
const linkedIds = report.companies.map(company => company.projectId).filter(Boolean);
assert.equal(new Set(linkedIds).size, linkedIds.length, "서로 다른 사업을 같은 프로젝트로 자동 연결하지 않습니다.");
const pdf = await fetch(`${base}/api/sales/rag/briefings/${run.briefingId}/export`); assert(pdf.ok); const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
for (let attempt = 0; attempt < 10; attempt++) { detail = await api(`/api/sales/rag/runs/${run.runId}`); if (detail.deliveries.every(item => item.status === "sent")) break; await new Promise(done => setTimeout(done, 1000)); }
assert(detail.deliveries.length && detail.deliveries.every(item => item.channel === "inbox" && item.status === "sent"));
assert.deepEqual((await api(`/api/sales/rag/runs/${previous.run.runId}`)).briefing, previous.briefing);
const db = new pg.Client({ connectionString: "postgresql://mcm_intel_test@127.0.0.1:55439/intel_live", ssl: false });
try {
  await db.connect();
  const calls = (await db.query("SELECT model,status,http_status,request_id,input_tokens,output_tokens,cost_usd,meta->>'briefing_phase' AS phase FROM ai_usage_log WHERE subject_id=$1 AND feature_key='intel.scheduled_briefing' ORDER BY log_id", [run.runId])).rows;
  const successfulCalls = calls.filter(call => call.status === "ok" && call.http_status === 200 && call.request_id);
  // 재시도 전 연결 실패도 기록·비용 집계에 남긴다. 최종 발행의 원자료 대조 성공은 별도로 확인한다.
  assert(successfulCalls.some(call => call.phase === "draft"));
  assert(calls.at(-1)?.phase === "evidence_review" && successfulCalls.includes(calls.at(-1)), "최종 원자료 대조 검수가 실제 API에서 성공해야 합니다.");
  const snapshot = (await db.query("SELECT jsonb_array_length(payload->'items') AS count FROM intel_briefing_snapshots WHERE run_id=$1", [run.runId])).rows[0];
  const result = { runId: run.runId, briefingId: run.briefingId, before: { trends: previous.briefing.report.trends.length, investments: previous.briefing.report.companies.length, insights: previous.briefing.report.insights.length }, after: { trends: report.trends.length, investments: report.companies.length, insights: report.insights.length }, snapshotEvidence: snapshot.count, selectedSources: detail.briefing.sources.length, model: successfulCalls.at(-1).model, apiCalls: calls.length, successfulApiCalls: successfulCalls.length, failedApiCalls: calls.length - successfulCalls.length, costUsd: calls.reduce((sum, call) => sum + Number(call.cost_usd), 0), pdfBytes: bytes.length, url: `${base}/sales/rag?tab=scheduled&runId=${run.runId}` };
  assert(result.selectedSources < result.snapshotEvidence);
  const output = resolve(".next/local-intelligence-demo/quality"); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(resolve(output, "report.json"), JSON.stringify(detail.briefing, null, 2));
  await writeFile(resolve(output, "report.pdf"), bytes);
  console.log(JSON.stringify(result)); console.log("PASS: 실제 AI 대표근거 선별·압축 / 출처 / 우선순위 / 기존 발행본 보존 / PDF·수신함 / 중복 생성 방지");
} finally { await db.end(); }
