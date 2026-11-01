// 원본 DB에는 쓰지 않는다. 실제 공개 뉴스의 입력·기존 분류를 보존하며 로컬 복사본만 재검증한다.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { Client } from "pg";
import { loadLocalIntelligenceEnvironment } from "./local-intelligence-environment.mjs";

const apply = process.argv.includes("--apply"), retryFailed = process.argv.includes("--retry-failed"), syncInputs = process.argv.includes("--sync-inputs");
const selectedIds = process.argv.find(arg => arg.startsWith("--only="))?.slice(7).split(",").filter(Boolean);
const recheckIds = process.argv.find(arg => arg.startsWith("--recheck="))?.slice(10).split(",").filter(Boolean) ?? [];
const press = process.argv.includes("--press");
if (apply && process.env.MCM_RUN_PAID_AI_TEST !== "1") throw new Error("실제 재분류에는 MCM_RUN_PAID_AI_TEST=1이 필요합니다.");
const directory = resolve(".next/local-intelligence-demo/source-quality");
await mkdir(directory, { recursive: true });
const audit = JSON.parse(await readFile(resolve(directory, press ? "press-audit.json" : "audit-before.json"), "utf8"));
const manifest = press ? { readOnly: audit.readOnly, importMismatches: Object.values(audit.matchesOriginal).filter(value => !value).length, records: [{ local: audit.local, original: { ...audit.original, rawPublic: { body: audit.original.body } } }] } : audit;
assert.equal(manifest.readOnly, true); assert.equal(manifest.importMismatches, 0);
assert(manifest.records.length > 0 && manifest.records.length <= 50);
assert(recheckIds.every(id => manifest.records.some(record => record.local.signal_id === id)), "원본 대조를 마친 자료만 재검토할 수 있습니다.");
const env = await loadLocalIntelligenceEnvironment();
for (const key of Object.keys(process.env)) if (/^(AWS_|ANTHROPIC_|OPENAI_|VOYAGE_|MCM_STORAGE_|MCM_DB_|SES_|BID_NOTIFY_|EXPO_)/.test(key)) delete process.env[key];
const databaseUrl = "postgresql://mcm_intel_test@127.0.0.1:55439/intel_live";
Object.assign(process.env, { DATABASE_URL: databaseUrl, PGSSL: "disable", NODE_ENV: "test", AUTH_SECRET: env.authSecret, AUTH_URL: "http://127.0.0.1:4174", ANTHROPIC_API_KEY: env.apiKey, AWS_EC2_METADATA_DISABLED: "true", INTEL_BRIEFING_ENABLED: "false", MCM_INTEL_SOURCE_DATABASE_URL: env.sourceDatabaseUrl, MCM_INTEL_SOURCE_SSL: env.sourceSsl });
const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => { const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); if (!apply || url.protocol !== "https:" || url.hostname !== "api.anthropic.com" || url.port) throw new Error("재검증은 승인된 기존 AI API만 사용합니다."); return networkFetch(input, { ...options, redirect: "error" }); };
await build({ stdin: { contents: 'export { classifyNewsDetailed } from "./lib/intel/news-classifier"; export { newsInputHash, newsReviewSummary, createNewsContentQuality, checkNewsContentQuality } from "./lib/intel/news-content-quality"; export { importLocalIntelligenceSource } from "./scripts/local-intelligence-live-data"; export { ingestSignalProjects } from "./lib/intel/project-intelligence"; export { ingestSignalEvidence } from "./lib/intel/official-sources"; export { invalidateDb } from "./lib/db";', resolveDir: process.cwd(), sourcefile: "content-repair-entry.ts" }, outfile: resolve(directory, "repair-domain.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json" });
const domain = createRequire(import.meta.url)(resolve(directory, "repair-domain.cjs"));
const db = new Client({ connectionString: databaseUrl, ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const publicFields = row => ({ report_name: row.report_name, summary: row.summary, company_name: row.company_name, signal_type: row.signal_type, signal_grade: row.signal_grade, region: row.region, raw_json: row.raw_json });
let locked = false;
const results = [];
try {
  await db.connect();
  const identity = (await db.query("SELECT current_database() AS name,host(inet_server_addr()) AS host")).rows[0];
  assert.equal(identity.name, "intel_live"); assert.equal(identity.host, "127.0.0.1");
  if (syncInputs) {
    const imported = await domain.importLocalIntelligenceSource({ days: 180, limit: 2000, includeSourceSignalIds: manifest.records.map(record => record.local.source_signal_id) });
    console.log(JSON.stringify({ syncedInputs: imported.importedSignals, changedInputs: imported.changedSignals }));
  }
  if (apply) {
    locked = (await db.query("SELECT pg_try_advisory_lock(hashtext('local-intelligence-live-import')) AS locked")).rows[0].locked;
    assert(locked, "원본 가져오기가 끝난 뒤 재검증하세요.");
    await db.query(`CREATE TABLE IF NOT EXISTS local_intelligence_content_repairs(
      repair_id text PRIMARY KEY,signal_id text NOT NULL,source_signal_id text NOT NULL,input_hash text NOT NULL,policy_version text NOT NULL,
      original_json jsonb NOT NULL,result_json jsonb,error text,decision text,status text NOT NULL,attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(signal_id,input_hash,policy_version))`);
  }
  for (const record of manifest.records) {
    const signalId = record.local.signal_id;
    const row = (await db.query("SELECT s.*,o.source_signal_id FROM intel_signals s JOIN local_intelligence_signal_origins o ON o.target_signal_id=s.signal_id WHERE s.signal_id=$1", [signalId])).rows[0];
    assert(row && row.source === (press ? "press" : "news") && row.source_signal_id === record.local.source_signal_id);
    assert.equal(row.report_name, record.original.report_name, "감사 이후 원문 제목이 바뀌었습니다.");
    const description = String(row.raw_json?.[press ? "body" : "description"] ?? "");
    const inputKind = press ? "full_text" : "search_excerpt";
    assert.equal(description, String(record.original.rawPublic[press ? "body" : "description"] ?? ""), "새 importer로 공개 발췌문 또는 본문을 반영한 뒤 실행하세요.");
    const inputHash = domain.newsInputHash(row.report_name, description, inputKind);
    const repairId = `local_content_${digest([signalId, inputHash, "news-grounded-v1"]).slice(0, 28)}`;
    if (!apply) { results.push({ signalId, title: row.report_name, hasExcerpt: !!description, inputHash }); continue; }
    const previous = (await db.query("SELECT * FROM local_intelligence_content_repairs WHERE repair_id=$1", [repairId])).rows[0];
    if (previous?.status === "applied" && !recheckIds.includes(signalId) && (!previous.error || !retryFailed || (selectedIds && !selectedIds.includes(signalId)))) {
      const q = previous.result_json.quality;
      assert(domain.checkNewsContentQuality(q)); assert.equal(q.inputHash, inputHash);
      assert.equal(row.raw_json?.classification?.contentQuality?.inputHash, inputHash, "원본 재수집으로 보류된 자료는 새 검토가 필요합니다.");
      assert.equal(row.raw_json.classification.contentQuality.decision, q.decision, "이전 정정 후 판정이 변경된 자료는 새 검토가 필요합니다.");
      const summary = q.decision === "accepted" ? previous.result_json.summary : domain.newsReviewSummary(row.report_name, q.decision);
      const classification = { ...row.raw_json.classification, summary };
      const raw = { ...row.raw_json, classification };
      if (row.summary !== summary || row.raw_json.classification.summary !== summary) {
        await db.query("BEGIN");
        try {
          const current = (await db.query("SELECT * FROM intel_signals WHERE signal_id=$1 FOR UPDATE", [signalId])).rows[0];
          assert.equal(digest(publicFields(current)), digest(publicFields(row)), "정정 요약 반영 중 자료가 변경되었습니다.");
          await db.query("UPDATE intel_signals SET summary=$2,raw_json=$3::jsonb,updated_at=now()::text WHERE signal_id=$1", [signalId, summary, JSON.stringify(raw)]);
          await db.query("UPDATE local_intelligence_content_repairs SET result_json=$2::jsonb,updated_at=now() WHERE repair_id=$1", [repairId, JSON.stringify({ ...previous.result_json, summary, classification: previous.result_json.classification ? { ...previous.result_json.classification, summary } : null })]);
          await db.query("COMMIT");
        } catch(error) { await db.query("ROLLBACK"); throw error; }
      }
      results.push({ signalId, title: row.report_name, decision: previous.decision, summary, reason: q.reason, error: previous.error, reused: true }); continue;
    }
    const beforeHash = digest(publicFields(row));
    await db.query("INSERT INTO local_intelligence_content_repairs(repair_id,signal_id,source_signal_id,input_hash,policy_version,original_json,status) VALUES($1,$2,$3,$4,'news-grounded-v1',$5::jsonb,'prepared') ON CONFLICT(repair_id) DO NOTHING", [repairId, signalId, row.source_signal_id, inputHash, JSON.stringify(publicFields(row))]);
    const outcome = description ? await domain.classifyNewsDetailed(row.report_name, description, [{ id: "semiconductor", label: "반도체" }], undefined, { inputKind, publishedAt: row.disclosed_at, subjectId: repairId }) : { status: "failed", classification: null, error: "원본 발췌문 또는 본문이 없습니다." };
    const classification = outcome.status === "ok" ? outcome.classification : null;
    const quality = classification?.contentQuality ?? domain.createNewsContentQuality({ title: row.report_name, description, inputKind, decision: "needs_review", titleRelation: "unclear", evidenceQuotes: [], reason: outcome.error ?? "근거 확인에 실패했습니다." });
    assert(domain.checkNewsContentQuality(quality)); assert.equal(quality.inputHash, inputHash);
    const accepted = quality.decision === "accepted" && classification?.isSignal === true;
    const summary = accepted ? classification.summary : domain.newsReviewSummary(row.report_name, quality.decision);
    const raw = { ...row.raw_json, classification: { ...(classification ?? {}), summary, isSignal: accepted, contentQuality: quality }, localContentRepair: { repairId, inputHash, reviewedAt: new Date().toISOString() } };
    await db.query("BEGIN");
    try {
      const current = (await db.query("SELECT * FROM intel_signals WHERE signal_id=$1 FOR UPDATE", [signalId])).rows[0];
      assert.equal(digest(publicFields(current)), beforeHash, "재검증 중 자료가 수정되어 적용하지 않습니다.");
      await db.query("UPDATE intel_signals SET summary=$2,signal_type=$3,signal_grade=$4,company_name=$5,region=$6,raw_json=$7::jsonb,updated_at=now()::text WHERE signal_id=$1", [signalId, summary, accepted ? classification.signalType : "other", row.signal_grade === "excluded" ? "excluded" : accepted ? "candidate" : "monitoring", accepted ? classification.companyName || row.company_name : row.company_name, accepted ? classification.location : row.region, JSON.stringify(raw)]);
      await db.query("UPDATE local_intelligence_content_repairs SET status='applied',result_json=$2::jsonb,error=$3,decision=$4,attempts=attempts+1,updated_at=now() WHERE repair_id=$1", [repairId, JSON.stringify({ classification, quality, summary, model: outcome.model ?? null, diagnostics: outcome.diagnostics ?? null }), outcome.error ?? null, quality.decision]);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    results.push({ signalId, title: row.report_name, decision: quality.decision, summary, reason: quality.reason, error: outcome.error ?? null, diagnostics: outcome.diagnostics ?? null, reused: false });
    console.log(`${results.length}/${manifest.records.length} ${quality.decision}: ${row.report_name.slice(0, 70)}`);
  }
  let projects = null;
  if (apply) {
    const acceptedIds = results.filter(row => row.decision === "accepted").map(row => row.signalId);
    if (acceptedIds.length) { await domain.ingestSignalEvidence({ signalIds: acceptedIds, mode: "replay" }); projects = await domain.ingestSignalProjects({ signalIds: acceptedIds, mode: "replay", limit: 1000 }); }
  }
  const totals = {}; for (const row of results) totals[row.decision ?? "planned"] = (totals[row.decision ?? "planned"] ?? 0) + 1;
  const result = { mode: apply ? "applied_local_only" : syncInputs ? "synced_local_inputs" : "read_only_plan", completedAt: new Date().toISOString(), originalDatabaseWrites: 0, total: results.length, decisions: totals, failed: results.filter(row => row.error).length, projects, records: results };
  await writeFile(resolve(directory, `${press ? "press-" : ""}${apply ? "repair-result.json" : "repair-plan.json"}`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, records: undefined }));
} finally { if (locked) await db.query("SELECT pg_advisory_unlock(hashtext('local-intelligence-live-import'))").catch(() => {}); await domain.invalidateDb(); await db.end(); }
