// 실제 공개자료를 읽기 전용 복사하는 격리 검증. 실제 AI·운영 원본·intel_live 쓰기·서버 재시작은 하지 않는다.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

if (process.env.MCM_RUN_LIVE_SCHEDULE_TEST !== "1") throw new Error("실제 공개자료 복사 검증에는 MCM_RUN_LIVE_SCHEDULE_TEST=1이 필요합니다.");
const connection = "postgresql://mcm_intel_test@127.0.0.1:55439/";
const sourceUrl = connection + "intel_live", testName = `intel_live_schedule_test_${Date.now()}`, testUrl = connection + testName;
assert.match(testName, /^intel_live_schedule_test_\d{13}$/);
const output = resolve(".next/local-intelligence-live-schedule"); await mkdir(output, { recursive: true });
for (const key of Object.keys(process.env)) if (/^(AWS_|ANTHROPIC_|OPENAI_|VOYAGE_|MCM_STORAGE_|MCM_DB_|SES_|BID_NOTIFY_|EXPO_)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATABASE_URL: testUrl, PGSSL: "disable", NODE_ENV: "test", INTEL_BRIEFING_ENABLED: "false", AWS_EC2_METADATA_DISABLED: "true", AUTH_SECRET: "isolated-live-schedule-test-not-a-service-secret", AUTH_URL: "http://127.0.0.1:1" });
let blockedNetworkCalls = 0;
globalThis.fetch = async () => { blockedNetworkCalls++; throw new Error("이 격리 검증에서는 외부 네트워크 호출을 허용하지 않습니다."); };
const source = new pg.Client({ connectionString: sourceUrl, ssl: false, options: "-c default_transaction_read_only=on -c statement_timeout=30000" });
const admin = new pg.Client({ connectionString: connection + "postgres", ssl: false });
const destination = new pg.Client({ connectionString: testUrl, ssl: false });
let domain;
const results = [], provenance = {};
const digest = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const count = async (table, where = "true", params = []) => Number((await destination.query(`SELECT count(*) n FROM ${table} WHERE ${where}`, params)).rows[0].n);
async function insertRows(table, records) {
  for (const row of records) {
    const columns = Object.keys(row);
    const values = columns.map(column => { const value = row[column]; return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) ? JSON.stringify(value) : value; });
    // pg의 JS 배열은 PG 배열용이다. JSON 열의 배열은 명시적으로 JSON 인코딩한다.
    const jsonColumns = (await destination.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND data_type IN('json','jsonb')", [table])).rows.map(r => r.column_name);
    for (const column of jsonColumns) if (Array.isArray(row[column])) values[columns.indexOf(column)] = JSON.stringify(row[column]);
    await destination.query(`INSERT INTO ${table}(${columns.map(c=>`"${c}"`).join(",")}) VALUES(${columns.map((_,i)=>`$${i+1}`).join(",")})`, values);
  }
}
const mockGenerate = async preview => ({ model: "isolated-test-mock-no-external-ai", sources: preview.items.map(e=>({signalId:e.id,kind:e.kind,revision:e.revision,source:e.source,reportName:e.title,companyName:e.companyName,url:e.url})), report: { kpis:[{label:"실제 공개자료 시험",value:String(preview.items.length),sub:"AI 응답은 mock"}], trends:[`[시험용 응답] ${preview.items[0]?.title ?? "변동 없음"} [1]`], companies:[], insights:[], etcNote:"이 결과는 별도 시험 DB의 상태 검증용이며 실제 AI 분석 결과가 아닙니다." } });
async function takeClaim(runId) { const claim = await domain.claimBriefingRun(); assert.equal(claim?.runId, runId); return claim; }
async function snapshot(runId) { return (await destination.query("SELECT payload FROM intel_briefing_snapshots WHERE run_id=$1", [runId])).rows[0]?.payload; }
async function manual(profile, key, generate = mockGenerate) { const run=await domain.queueManualBriefing(profile.profileId,"u1",key); const status=await domain.executeClaimedBriefing(await takeClaim(run.runId),generate); return {runId:run.runId,status}; }
try {
  await source.connect(); await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal((await source.query("SHOW transaction_read_only")).rows[0].transaction_read_only,"on");
  const liveBefore = (await source.query("SELECT (SELECT count(*) FROM intel_briefing_profiles) profiles,(SELECT count(*) FROM intel_briefing_runs) runs,(SELECT count(*) FROM ai_budgets) budgets")).rows[0];
  const signals = (await source.query("SELECT s.* FROM intel_signals s JOIN local_intelligence_signal_origins o ON o.target_signal_id=s.signal_id WHERE s.source IN('dart','news','press','eiass','gosi_eum','gosi_me','gosi') AND s.signal_grade<>'excluded' AND s.status<>'dismissed' AND s.duplicate_of IS NULL AND s.facility_id IS NULL AND s.industry IN('semiconductor','electronics') ORDER BY (s.region IS NULL) DESC,(s.amount IS NULL) DESC,s.disclosed_at DESC,s.signal_id LIMIT 12")).rows;
  assert(signals.length >= 2, "복사할 실제 공개 신호가 부족합니다.");
  assert(signals.every(s=>s.url && !/example\.(invalid|test)/.test(s.url) && !/\[예시\]|로컬 예시/.test(s.report_name ?? "")), "가상 자료는 실제자료 검증에 포함하지 않습니다.");
  const docs = (await source.query("SELECT * FROM intel_source_documents WHERE source_id='official_kdi' AND status='available' ORDER BY document_id")).rows;
  const revisions = (await source.query("SELECT * FROM intel_source_document_revisions WHERE revision_id=ANY($1::text[])", [docs.map(d=>d.current_revision_id)])).rows;
  assert.equal(docs.length,3); assert.equal(revisions.length,3); assert(revisions.every(r=>r.structured_data.licenseMarker==="KOGL-1"));
  provenance.source = "localhost intel_live (READ ONLY)"; provenance.signalCount=signals.length; provenance.signalDigest=digest(signals); provenance.signalDates=signals.map(s=>s.disclosed_at); provenance.sourceCounts=Object.fromEntries([...new Set(signals.map(s=>s.source))].map(name=>[name,signals.filter(s=>s.source===name).length]));
  provenance.kdi=docs.map(d=>({title:d.title,url:d.url,publishedAt:d.published_at}));
  provenance.unknownRegion=signals.filter(s=>!s.region).length; provenance.unknownAmount=signals.filter(s=>s.amount==null).length;
  await admin.connect(); await admin.query(`CREATE DATABASE ${testName}`); await destination.connect();
  const schema = spawnSync("C:/Program Files/PostgreSQL/17/bin/pg_dump.exe", ["--schema-only","--no-owner","--no-privileges","--dbname",sourceUrl], {encoding:"utf8",maxBuffer:5*1024*1024,env:{...process.env,PGOPTIONS:"-c default_transaction_read_only=on"}});
  assert.equal(schema.status,0,schema.stderr);
  // pg_dump의 psql 전용 메타 명령만 제거하고 실제 스키마를 빈 시험 DB에 복제한다.
  await destination.query(schema.stdout.split(/\r?\n/).filter(line=>!line.startsWith("\\")).join("\n"));
  await destination.query("SET search_path TO public");
  for (const [table, predicate] of [["departments","dept_id IN('d1','d2')"],["positions","position_id='live_reviewer'"],["employee_profiles","employee_id IN('e1','e2')"],["users","user_id IN('u1','u2')"],["permission_templates","template_id='local-reviewer'"],["permission_template_grants","template_id='local-reviewer'"],["user_permission_assignments","user_id IN('u1','u2')"],["permissions","true"],["mailboxes","user_id IN('u1','u2')"],["mail_folders","mailbox_id IN('live_mailbox_u1','live_mailbox_u2')"],["ai_model_prices","true"]]) await insertRows(table,(await source.query(`SELECT * FROM ${table} WHERE ${predicate}`)).rows);
  const officialSource=(await source.query("SELECT * FROM scraper_sources WHERE source_id='official_kdi'")).rows;
  assert.equal(officialSource[0].auth_secret_enc,null); await insertRows("scraper_sources",officialSource);
  await insertRows("scraper_endpoints",(await source.query("SELECT * FROM scraper_endpoints WHERE source_id='official_kdi'")).rows);
  await insertRows("intel_signals",signals);
  await insertRows("intel_source_documents",docs.map(d=>({...d,current_revision_id:null})));
  await insertRows("intel_source_document_revisions",revisions);
  for (const doc of docs) await destination.query("UPDATE intel_source_documents SET current_revision_id=$2 WHERE document_id=$1",[doc.document_id,doc.current_revision_id]);
  assert.deepEqual((await source.query("SELECT (SELECT count(*) FROM intel_briefing_profiles) profiles,(SELECT count(*) FROM intel_briefing_runs) runs,(SELECT count(*) FROM ai_budgets) budgets")).rows[0],liveBefore);
  await source.query("COMMIT");
  await destination.query("INSERT INTO ai_settings VALUES('single_call_alert_usd','null',now()::text,'u1'); INSERT INTO ai_budgets(budget_id,scope,monthly_limit_usd,warn_pcts,action,recipients,enabled) VALUES('budget-org','org',1,'{}','block_all','{}',1)");
  await build({stdin:{contents:'export * from "./lib/intel/briefing-store"; export * from "./lib/intel/briefing-runner"; export * from "./lib/intel/briefing-delivery"; export * from "./lib/intel/briefing-evidence"; export {ingestSignalProjects} from "./lib/intel/project-intelligence"; export {collectOfficialSource,listOfficialSources} from "./lib/intel/official-sources"; export {invalidateDb} from "./lib/db"; export {invalidateBudgetCache} from "./lib/ai/budget";',resolveDir:process.cwd(),sourcefile:"live-schedule-domain.ts"},outfile:resolve(output,"domain.cjs"),bundle:true,platform:"node",format:"cjs",packages:"external",tsconfig:"tsconfig.json"});
  domain=createRequire(import.meta.url)(resolve(output,"domain.cjs"));
  const ingestion=await domain.ingestSignalProjects({signalIds:signals.map(s=>s.signal_id),mode:"initial_backfill",limit:100});
  assert.equal(ingestion.created,signals.length);
  console.log(`준비 완료: 읽기 전용 실제 신호 ${signals.length}건 + KDI 3건 → ${testName}`);
  const scheduleClock=new Date(Date.now()+120000), kst=new Date(scheduleClock.valueOf()+9*3600000).toISOString();
  let profile=await domain.saveBriefingProfile("u1",{name:"실제자료 격리 예약·증분 검증",enabled:true,schedule:{cadence:"daily",startDate:kst.slice(0,10),time:kst.slice(11,16),timezone:"Asia/Seoul"},recipients:[{userId:"u1",channels:["inbox"]}],notifyNoChange:false,allowPartialSources:false,requiredSources:["kdi"]});
  const runScheduled=async(clock,expected)=>{await Promise.all([domain.queueDueBriefings(clock),domain.queueDueBriefings(clock)]);const claim=await domain.claimBriefingRun();assert(claim);assert.equal(claim.profileId,profile.profileId);assert.equal(await domain.executeClaimedBriefing(claim,mockGenerate),expected);return claim.runId;};
  const initialRun=await runScheduled(scheduleClock,"published"), initial=await snapshot(initialRun);
  assert.equal(initial.totalSignals,signals.length); assert.equal(initial.totalProjects,signals.length); assert.equal(initial.items.filter(e=>e.kind==="official").length,3);
  assert(initial.items.every(e=>!e.text.includes("로컬 예시"))); assert(initial.items.filter(e=>e.kind==="signal").every(e=>e.url));
  const projected=(await destination.query("SELECT p.region,p.amount,s.region AS source_region,s.amount AS source_amount FROM intel_projects p JOIN intel_project_signals ps ON ps.project_id=p.project_id JOIN intel_signals s ON s.signal_id=ps.signal_id")).rows;
  for (const row of projected) { if (!row.source_region) assert.equal(row.region,null,"원문 미확인 지역을 추정으로 채우지 않습니다."); if (row.source_amount==null) assert.equal(row.amount,null,"원문 미확인 투자액을 0이나 임의 금액으로 채우지 않습니다."); }
  assert.equal(await count("intel_briefing_runs","profile_id=$1",[profile.profileId]),1);
  assert.equal((await domain.dispatchBriefingDeliveries()).sent,1);
  const sameRun=await runScheduled(new Date(scheduleClock.valueOf()+86400000),"no_change");
  assert.equal((await snapshot(sameRun)).changedCount,0); assert.equal(await count("intel_notification_outbox","briefing_id=(SELECT briefing_id FROM intel_briefing_runs WHERE run_id=$1)",[sameRun]),0);
  const repeated=await domain.dispatchBriefingDeliveries();assert.equal(repeated.sent,0);assert.equal(await count("mail_messages"),1);
  results.push({case:"실제 공개자료 예약·동시 슬롯·무변동·중복 전달",status:"passed",initialRun,sameRun,projects:initial.totalProjects,signals:initial.totalSignals,official:3});
  const changedId=signals[0].signal_id;
  await destination.query("UPDATE intel_signals SET summary=COALESCE(summary,'')||' [격리 시험용 정정: 실제 기관의 변경 발표가 아님]',updated_at=now()::text WHERE signal_id=$1",[changedId]);
  await domain.ingestSignalProjects({signalIds:[changedId],mode:"initial_backfill",limit:1});
  const changedRun=await runScheduled(new Date(scheduleClock.valueOf()+2*86400000),"published"), changed=await snapshot(changedRun);
  assert(changed.items.find(e=>e.id===`signal:${changedId}`)?.changed); assert.equal(changed.items.filter(e=>e.kind==="official"&&e.changed).length,0); assert.equal(initial.items.find(e=>e.id===`signal:${changedId}`).text.includes("격리 시험용 정정"),false);
  results.push({case:"복사본 정정만 다음 회차에 반영·기존 스냅샷 유지",status:"passed",changedRun,changedCount:changed.changedCount});
  // 다음 수동 실패 검증에 예약 회차가 섞이지 않게 이 시험 프로필만 중지한다.
  profile=await domain.saveBriefingProfile("u1",{version:profile.version,updatedAt:profile.updatedAt,enabled:false},profile.profileId);
  const successState=(await destination.query("SELECT official_config FROM scraper_sources WHERE source_id='official_kdi'")).rows[0].official_config;
  const sourceFailure=await domain.collectOfficialSource("kdi",{fetcher:async()=>{throw new Error("격리 시험 수집 연결 실패");}});
  assert.equal(sourceFailure.status,"failed");assert.equal(await count("intel_source_documents"),3);
  const failedState=(await destination.query("SELECT official_config FROM scraper_sources WHERE source_id='official_kdi'")).rows[0].official_config;assert.equal(failedState.lastSuccessAt,successState.lastSuccessAt);assert(failedState.lastError);
  const waitingProfile=await domain.saveBriefingProfile("u1",{name:"실제 KDI 수집 실패·복구 시험",enabled:false,allowPartialSources:false,requiredSources:["kdi"]});
  const waiting=await manual(waitingProfile,"live-source-wait");assert.equal(waiting.status,"waiting_sources");assert.equal(await count("intel_briefing_snapshots","run_id=$1",[waiting.runId]),0);
  await destination.query("UPDATE scraper_sources SET official_config=$1::jsonb WHERE source_id='official_kdi'",[JSON.stringify(successState)]);
  await destination.query("UPDATE intel_briefing_runs SET next_attempt_at=now() WHERE run_id=$1",[waiting.runId]);
  assert.equal(await domain.executeClaimedBriefing(await takeClaim(waiting.runId),mockGenerate),"published");assert.equal(await count("intel_rag_briefings","run_id=$1",[waiting.runId]),1);
  results.push({case:"실제 KDI 복사자료의 수집실패→대기→복구·중복발행 방지",status:"passed",runId:waiting.runId,lastSuccessPreserved:true});
  const failureProfile=await domain.saveBriefingProfile("u1",{name:"실제자료 AI 실패 차단 시험",enabled:false,allowPartialSources:true});
  const failed=await manual(failureProfile,"live-ai-failure",async()=>{throw Object.assign(new Error("격리 시험 AI 연결 실패"),{status:502});});
  assert.equal(failed.status,"failed");assert.equal(await count("intel_rag_briefings","run_id=$1",[failed.runId]),0);
  await destination.query("UPDATE intel_briefing_runs SET next_attempt_at='9999-12-31' WHERE run_id=$1",[failed.runId]);
  const budgetProfile=await domain.saveBriefingProfile("u1",{name:"실제자료 예산 게이트 시험",enabled:false,allowPartialSources:true});
  await destination.query("INSERT INTO ai_usage_log(feature_key,model,model_family,cost_usd,status,env,meta) VALUES('intel.scheduled_briefing','test-budget-cost','test-budget-cost',2,'ok','isolated-test','{\"syntheticBudgetFixture\":true}')");
  domain.invalidateBudgetCache();process.env.ANTHROPIC_API_KEY="isolated-placeholder-not-a-real-key";
  const budget=await manual(budgetProfile,"live-budget-block",domain.generateScheduledBriefing);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(budget.status,"blocked_budget");assert.equal(await count("intel_rag_briefings","run_id=$1",[budget.runId]),0);assert.equal(blockedNetworkCalls,0);
  results.push({case:"AI 실패 및 실제 예산 게이트 차단·가상 성공 대체 없음",status:"passed",failureRun:failed.runId,budgetRun:budget.runId,externalAiCalls:0});
  const summary={passed:true,testDatabase:testName,sourceReadOnly:true,clock:"예약 시각은 격리 시험에서만 앞당겨 평가",ai:"정상·연결실패=명시적 mock, 예산=실제 domain 게이트; 외부 API 호출 0",provenance,results};
  await writeFile(resolve(output,"result.json"),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
} finally {
  delete process.env.ANTHROPIC_API_KEY;
  await domain?.invalidateDb();
  await Promise.allSettled([source.end(),destination.end(),admin.end()]);
}
