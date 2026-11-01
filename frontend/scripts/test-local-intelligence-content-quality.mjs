// 실제 정정 자료·독립 사전 QA·발행 스냅샷을 읽어 검증한다. AI 호출과 DB 쓰기는 없다.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { loadLocalIntelligenceEnvironment } from "./local-intelligence-environment.mjs";
const directory = ".next/local-intelligence-demo/source-quality";
const audit = JSON.parse(await readFile(`${directory}/audit-before.json`, "utf8"));
let pressAudit = null;
try { pressAudit = JSON.parse(await readFile(`${directory}/press-audit.json`, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (pressAudit) {
  audit.records.push({ local: pressAudit.local, original: { ...pressAudit.original, rawPublic: { body: pressAudit.original.body, classification: pressAudit.original.classification } } });
  audit.count = audit.records.length;
}
const expected = JSON.parse(await readFile(`${directory}/review-expectations.json`, "utf8"));
const baseline = JSON.parse(await readFile(`${directory}/baseline-briefing.json`, "utf8"));
const normalize = text => text.replace(/\s+/g, " ").trim();
const db = new Client({ connectionString: "postgresql://mcm_intel_test@127.0.0.1:55439/intel_live", ssl: false, options: "-c default_transaction_read_only=on" });
const api = async path => { const response = await fetch(`http://127.0.0.1:4174${path}`); assert(response.ok); return response.json(); };
const result = { passed: false, checks: [], decisions: {}, cases: [], report: null };
try {
  await db.connect();
  assert.equal((await db.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only, "on");
  const rows = (await db.query("SELECT signal_id,source,report_name,summary,signal_grade,raw_json FROM intel_signals WHERE signal_id=ANY($1::text[])", [audit.records.map(row => row.local.signal_id)])).rows;
  assert.equal(rows.length, audit.count);
  const byId = new Map(rows.map(row => [row.signal_id, row]));
  for (const row of rows) {
    const q = row.raw_json.classification.contentQuality;
    assert.equal(q.version, "news-grounded-v1");
    const description = row.raw_json[row.source === "press" ? "body" : "description"];
    const hash = createHash("sha256").update(JSON.stringify({ title: row.report_name, description, inputKind: row.source === "press" ? "full_text" : "search_excerpt" })).digest("hex");
    assert.equal(q.inputHash, hash);
    result.decisions[q.decision] = (result.decisions[q.decision] ?? 0) + 1;
    for (const quote of q.evidenceQuotes) assert([row.report_name, description].some(text => normalize(text).includes(normalize(quote))), "원문에 없는 인용");
    if (q.decision === "accepted") { assert.notEqual(row.signal_grade, "confirmed"); assert.equal(row.summary, q.evidenceQuotes.join(" ")); }
    else assert(row.summary.startsWith(normalize(row.report_name)), "비채택 자료의 요약이 기사 주제를 유지하지 않습니다.");
  }
  result.checks.push(`${rows.length}건 입력 식별자·근거 인용·검색 발췌 등급 상한 검증`);
  result.localContentFingerprint = createHash("sha256").update(JSON.stringify(rows.sort((a,b) => a.signal_id.localeCompare(b.signal_id)).map(row => ({ signalId: row.signal_id, title: row.report_name, summary: row.summary, grade: row.signal_grade, classification: row.raw_json.classification })))).digest("hex");
  for (const testCase of expected.cases) {
    const row = byId.get(testCase.localSignalId); assert(row);
    const decision = row.raw_json.classification.contentQuality.decision;
    const shouldAccept = testCase.expected.directInvestmentSignalEligible === true;
    assert.equal(decision === "accepted", shouldAccept, `${testCase.caseId}: ${decision}`);
    result.cases.push({ caseId: testCase.caseId, signalId: row.signal_id, decision, passed: true });
  }
  result.checks.push(`독립 검토 ${expected.cases.length}사례: 배경·촉구·주체혼동 보류 / 직접 투자·일정변경 보존`);
  const journal = (await db.query("SELECT signal_id,original_json,error FROM local_intelligence_content_repairs WHERE status='applied' AND signal_id=ANY($1::text[])", [rows.map(row => row.signal_id)])).rows;
  assert.equal(journal.length, rows.length);
  assert.equal(journal.filter(row => row.error).length, 0, "AI 응답 처리 오류와 의미상 보류를 구분하고 처리 오류를 해결하세요.");
  for (const original of audit.records) assert.equal(journal.find(row => row.signal_id === original.local.signal_id).original_json.summary, original.local.summary);
  result.checks.push("정정 전 요약·분류 원장 보존");
  const env = await loadLocalIntelligenceEnvironment();
  const source = new Client({ connectionString: env.sourceDatabaseUrl, ssl: env.sourceSsl === "disable" ? false : { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  try {
    await source.connect();
    assert.equal((await source.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only, "on");
    const originals = (await source.query("SELECT signal_id,report_name,summary,url,raw_json FROM intel_signals WHERE signal_id=ANY($1::text[])", [audit.records.map(row => row.local.source_signal_id)])).rows;
    assert.equal(originals.length, audit.count);
    for (const record of audit.records) {
      const original = originals.find(row => row.signal_id === record.local.source_signal_id); assert(original);
      for (const field of ["report_name", "summary", "url"]) assert.equal(original[field], record.original[field], `원본 ${field} 변경`);
      const inputField = record.local.source === "press" ? "body" : "description";
      assert.equal(original.raw_json[inputField], record.original.rawPublic[inputField]);
      assert.deepEqual(original.raw_json.classification, record.original.rawPublic.classification);
    }
    result.checks.push(`원본 DB ${audit.count}건 제목·요약·발췌/본문·분류 불변 확인(읽기 전용)`);
  } finally { await source.end(); }
  const old = await api(`/api/sales/rag/runs/${baseline.run.runId}`);
  assert.equal(old.briefing.answerMd, baseline.briefing.answerMd);
  result.checks.push("이전 발행본 본문 보존·조회 가능");
  const runId = process.env.MCM_CONTENT_QUALITY_RUN_ID;
  if (runId) {
    const detail = await api(`/api/sales/rag/runs/${runId}`); assert.equal(detail.run.status, "published");
    const snapshot = (await db.query("SELECT payload FROM intel_briefing_snapshots WHERE run_id=$1", [runId])).rows[0].payload;
    const heldIds = rows.filter(row => row.raw_json.classification.contentQuality.decision !== "accepted").map(row => row.signal_id);
    assert(!snapshot.items.some(item => heldIds.includes(item.id.replace(/^signal:/, ""))));
    const heldProjects = (await db.query("SELECT DISTINCT project_id FROM intel_project_signals WHERE signal_id=ANY($1::text[])", [heldIds])).rows.map(row => `project:${row.project_id}`);
    assert(!snapshot.items.some(item => heldProjects.includes(item.id)), "보류 자료의 파생 프로젝트가 스냅샷에 포함됐습니다.");
    for (const item of result.cases.filter(row => row.decision === "accepted")) assert(snapshot.items.some(e => e.id === `signal:${item.signalId}`), `양성 근거 누락: ${item.caseId}`);
    for (const row of rows.filter(row => row.raw_json.classification.contentQuality.decision === "accepted")) {
      const evidence = snapshot.items.find(item => item.id === `signal:${row.signal_id}`); assert(evidence);
      assert.equal(evidence.originalText, row.raw_json[row.source === "press" ? "body" : "description"]);
      assert.equal(evidence.qualityInputKind, row.source === "press" ? "full_text" : "search_excerpt");
    }
    const reviewCalls = (await db.query("SELECT status,http_status,request_id FROM ai_usage_log WHERE subject_id=$1 AND feature_key='intel.scheduled_briefing' AND meta->>'briefing_phase'='evidence_review'", [runId])).rows;
    assert(reviewCalls.some(call => call.status === "ok" && call.http_status === 200 && call.request_id), "실제 원자료 대조 검수 호출이 없습니다.");
    const r = detail.briefing.report;
    assert(r.trends.length > 0 && r.trends.length <= 15); assert(r.companies.length > 0 && r.companies.length <= 15);
    assert(detail.briefing.sources.some(source => source.kind === "official"));
    assert.match(r.etcNote, /재검증.*보류.*제외/);
    result.report = { runId, briefingId: detail.briefing.briefingId, snapshotItems: snapshot.items.length, trends: r.trends.length, investments: r.companies.length, insights: r.insights.length, heldSignalsExcluded: heldIds.length };
    result.checks.push("보류 뉴스·파생 사업 미포함 / 직접 투자 근거·공식 동향 유지 / 15개 상한");
    result.checks.push("검색 발췌·원문을 파생 요약과 분리해 보존 / 실제 AI 원자료 대조 검수 완료");
  }
  result.failedClassifications = journal.filter(row => row.error).length;
  result.passed = true;
  await writeFile(`${directory}/validation-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await db.end(); }
