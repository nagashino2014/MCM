import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { saveBriefingProfile, queueManualBriefing, queueDueBriefings, getBriefingProfile, getBriefingRun, assertBriefingAccess, listBriefingRuns } from "../lib/intel/briefing-store";
import { claimBriefingRun, executeClaimedBriefing, generateScheduledBriefing } from "../lib/intel/briefing-runner";
import { assertBriefingEvidenceContentQuality, buildBriefingEvidence } from "../lib/intel/briefing-evidence";
import { dispatchBriefingDeliveries, retryBriefingRun } from "../lib/intel/briefing-delivery";
import { normalizeBriefingProfile } from "../lib/intel/briefing-schedule";
import { listBriefings } from "../lib/intel/rag-queries";
import { invalidateDb } from "../lib/db";
import { refreshBriefingWakeup, triggerDueBriefingWorker } from "../lib/intel/briefing-scheduler";
import { ingestSignalProjects } from "../lib/intel/project-intelligence";
import { createNewsContentQuality } from "../lib/intel/news-content-quality";

test("독립 PostgreSQL에서 정기 브리핑 상태·ACL·스냅샷·부분전달을 검증",async t=>{
  const raw=process.env.INTEL_BRIEFING_TEST_DATABASE_URL!; const url=new URL(raw);
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname));assert.equal(url.pathname,"/intel_briefing_test");
  const adminUrl=new URL(raw);adminUrl.pathname="/postgres";const admin=new Client({connectionString:adminUrl.toString(),ssl:false});
  try {
    await admin.connect();
    if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_briefing_test'")).rowCount)await admin.query("CREATE DATABASE intel_briefing_test");
  } finally { await admin.end(); }
  const db=new Client({connectionString:raw,ssl:false});
  t.after(async()=>{await Promise.allSettled([invalidateDb(),db.end()]);});
  await db.connect();
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  const projectBase=(await readFile("tests/fixtures/project-intelligence-base.sql","utf8")).replace(/^CREATE TABLE (scraper_sources|intel_source_documents|intel_source_document_revisions)\(.*\);\r?\n/gm,"");
  await db.query(projectBase);
  // 다른 suite가 추가한 영업·RAG fixture를 섞지 않고 수집기 테이블만 재사용한다.
  const sourceTables=(await readFile("tests/fixtures/official-sources-base.sql","utf8")).split(/\r?\n/).filter(line=>/^CREATE TABLE scraper_(sources|endpoints)\(/.test(line));
  assert.equal(sourceTables.length,2,"공식 소스 fixture의 수집기 테이블 정의를 확인하세요.");
  await db.query(sourceTables.join("\n"));
  await db.query(`ALTER TABLE users ADD COLUMN email text,ADD COLUMN name text,ADD COLUMN email_local text;
    ALTER TABLE employee_profiles ADD COLUMN user_id text;
    ALTER TABLE intel_signals ADD COLUMN region text,ADD COLUMN raw_json text,ADD COLUMN relevance_note text,ADD COLUMN match_type text;
    UPDATE users SET email=user_id||'@example.test',name=user_id,email_local=user_id;
    UPDATE employee_profiles SET user_id=CASE WHEN employee_id='e1' THEN 'u1' ELSE 'u2' END;
    INSERT INTO users(user_id,role,status,email,name) VALUES('u3','member','active','u3@example.test','비수신자');
    INSERT INTO user_permission_assignments(assignment_id,user_id,template_id) VALUES('a3','u3','all');
    CREATE TABLE intel_rag_briefings(briefing_id text PRIMARY KEY,question text NOT NULL,answer_md text,sources jsonb,filters jsonb,model text,status text,error text,created_by text,created_at text);
    CREATE TABLE intel_embeddings(signal_id text PRIMARY KEY,content text);
    CREATE TABLE intel_collect_state(source text PRIMARY KEY,last_run_at text,last_cursor text,updated_at text);
    CREATE TABLE alerts(id bigserial PRIMARY KEY,severity text,source text,code text,title text,body text,payload_json jsonb,created_at text);`);
  for(const file of ["319_official_intelligence_sources.sql","320_project_intelligence.sql","131_rag_briefing_share.sql","132_scraper_run_logs.sql","095_mail_core.sql","096_mail_folders.sql","098_mail_folders_sys_unique.sql","321_scheduled_intelligence_briefings.sql"]){const sql=await readFile(`../infra/aws/${file}`,"utf8");await db.query(sql);}
  await db.query(await readFile("../infra/aws/321_scheduled_intelligence_briefings.sql","utf8"));
  await db.query(`INSERT INTO mailboxes(mailbox_id,user_id,address,local_part,status,created_at,updated_at) VALUES('mb1','u1','u1@example.test','u1','active',now()::text,now()::text),('mb2','u2','u2@example.test','u2','active',now()::text,now()::text);
    UPDATE intel_signals SET region='경기도 용인시',updated_at=now()::text;
    INSERT INTO scraper_run_logs(run_id,source_id,source_slug,trigger,status,started_at,finished_at) VALUES('success-dart','dart','dart','batch','success',now()::text,now()::text);`);
  Object.assign(process.env,{DATABASE_URL:raw,PGSSL:"disable",NODE_ENV:"test"});delete process.env.MCM_DB_EXPECTED_ROLE;delete process.env.MCM_DB_ROLE_REQUIRED;delete process.env.MCM_STORAGE_BUCKET;delete process.env.ANTHROPIC_API_KEY;
  let profile=await saveBriefingProfile("u1",{...normalizeBriefingProfile({name:"반도체 주간",visibility:"shared",recipients:[{userId:"u2",channels:["inbox","email"]}]},"u1"),enabled:false});
  const fakeGenerate:typeof generateScheduledBriefing=async(preview)=>({model:"test-fixture",sources:[],report:{kpis:[{label:"대상",value:String(preview.totalProjects),sub:null}],trends:["검증용 고정 응답"],companies:[],insights:[],etcNote:null}});
  let publishedRun="",reportId="";
  await t.test("프로필 접근은 소유자·명시 수신자만, 비수신자는 차단",async()=>{
    assert.equal((await getBriefingProfile(profile.profileId,"u2")).canManage,false);
    await assert.rejects(getBriefingProfile(profile.profileId,"u3"),e=>(e as any).status===404);
    await assert.rejects(getBriefingProfile(profile.profileId,"u2",true),e=>(e as any).status===404);
  });
  await t.test("필터 버전이 같아도 오래된 설정 저장은 충돌로 거부",async()=>{
    const stale={...profile};profile=await saveBriefingProfile("u1",{version:profile.version,updatedAt:profile.updatedAt,name:"새 이름"},profile.profileId);
    assert.equal(stale.version,profile.version);assert.notEqual(stale.updatedAt,profile.updatedAt);
    await assert.rejects(saveBriefingProfile("u1",{version:stale.version,updatedAt:stale.updatedAt,name:"덮어쓰기"},profile.profileId),e=>(e as any).status===409);
    await assert.rejects(saveBriefingProfile("u1",{version:profile.version,name:"토큰 없음"},profile.profileId),e=>(e as any).status===409);
  });
  await t.test("동시 수동 요청과 실행 선점은 각각 하나이고 수동 생성은 정기 기준을 소모하지 않음",async()=>{
    const [a,b]=await Promise.all([queueManualBriefing(profile.profileId,"u1","manual-concurrent"),queueManualBriefing(profile.profileId,"u1","manual-concurrent")]);assert.equal(a.runId,b.runId);
    const claims=await Promise.all([claimBriefingRun(),claimBriefingRun()]);assert.equal(claims.filter(Boolean).length,1);
    assert.equal(await executeClaimedBriefing(claims.find(Boolean)!,fakeGenerate),"published");
    const row=(await db.query("SELECT * FROM intel_briefing_runs WHERE run_id=$1",[a.runId])).rows[0];publishedRun=a.runId;reportId=row.briefing_id;
    assert.equal(Number((await db.query("SELECT count(*) n FROM intel_profile_seen_revisions")).rows[0].n),0);
    assert.equal((await db.query("SELECT count(*) n FROM intel_rag_briefings WHERE run_id=$1",[a.runId])).rows[0].n,"1");
  });
  await t.test("발행본 목록·직접 열람 ACL과 권한 회수",async()=>{
    await assertBriefingAccess(reportId,"u2");await assert.rejects(assertBriefingAccess(reportId,"u3"));
    assert.equal((await listBriefings(100,"u3")).length,0);
    profile=await saveBriefingProfile("u1",{version:profile.version,updatedAt:profile.updatedAt,recipients:[{userId:"u1",channels:["inbox"]}]},profile.profileId);
    await assert.rejects(assertBriefingAccess(reportId,"u2"));assert.equal((await listBriefingRuns("u2")).length,0);
    profile=await saveBriefingProfile("u1",{version:profile.version,updatedAt:profile.updatedAt,recipients:[{userId:"u1",channels:["inbox"]},{userId:"u2",channels:["inbox","email"]}]},profile.profileId);
  });
  await t.test("공식 자료 이용 회수는 기존 발행본 목록과 직접 조회에서도 차단",async()=>{
    const permissions={storageAllowed:true,aiAllowed:true,internalReportAllowed:true};
    await db.query("INSERT INTO scraper_sources(source_id,slug,name,created_at,updated_at,official_provider,official_config) VALUES('official-test','official-test','공식 검증',now()::text,now()::text,'test',$1::jsonb)",[JSON.stringify({enabled:true,verifiedAt:new Date().toISOString(),permissions})]);
    await db.query("INSERT INTO intel_source_documents(document_id,source_id,external_id,document_type,title,url) VALUES('doc-test','official-test','d','trend','공식 자료','https://example.test/official')");
    await db.query("INSERT INTO intel_source_document_revisions(revision_id,document_id,content_hash,rights_snapshot) VALUES('rev-test','doc-test','hash',$1::jsonb)",[JSON.stringify(permissions)]);
    await db.query("UPDATE intel_source_documents SET current_revision_id='rev-test' WHERE document_id='doc-test'");
    await db.query("UPDATE intel_briefing_snapshots SET payload=jsonb_set(payload,'{items}',(payload->'items')||$2::jsonb) WHERE run_id=$1",[publishedRun,JSON.stringify([{id:'official:doc-test',kind:'official',revision:'rev-test'}])]);
    await assertBriefingAccess(reportId,"u1");
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','false') WHERE source_id='official-test'");
    await assert.rejects(assertBriefingAccess(reportId,"u1"),e=>(e as any).status===403);
    assert.equal((await listBriefings(100,"u1")).some(b=>b.briefingId===reportId),false);
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','true') WHERE source_id='official-test'");
  });
  await t.test("사내 수신함에 실제 메일 저장·전달 재실행 무중복",async()=>{
    const r=await dispatchBriefingDeliveries();assert.equal(r.sent,2);
    const count=Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n);assert.equal(count,2);
    await dispatchBriefingDeliveries();assert.equal(Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n),2);
    assert.equal(Number((await db.query("SELECT count(*) n FROM mail_message_state WHERE is_read=0")).rows[0].n),2);
  });
  await t.test("재전송은 성공 채널을 보존하고 unknown을 명시적으로만 재시도",async()=>{
    await db.query("UPDATE intel_notification_outbox SET status='unknown' WHERE briefing_id=$1 AND channel='email'",[reportId]);
    await retryBriefingRun(publishedRun,"u1",false);assert.equal((await db.query("SELECT status FROM intel_notification_outbox WHERE briefing_id=$1 AND channel='email'",[reportId])).rows[0].status,"unknown");
    await retryBriefingRun(publishedRun,"u1",true);assert.equal((await db.query("SELECT status FROM intel_notification_outbox WHERE briefing_id=$1 AND channel='email'",[reportId])).rows[0].status,"pending");
    assert.equal((await db.query("SELECT count(*) n FROM intel_notification_outbox WHERE briefing_id=$1 AND channel='inbox' AND status='sent'",[reportId])).rows[0].n,"2");
  });
  await t.test("고정된 기간과 자료 확보 시각을 분리하고 오래된 발표를 지연 자료로 표시",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,signal_type,industry,disclosed_at,created_at,updated_at) VALUES('late','news','회사','과거 투자 발표','뒤늦게 수집한 투자','investment','semiconductor','2020-01-01',now()::text,now()::text)");
    const periodEnd=new Date(Date.now()+1000).toISOString(),periodStart=new Date(Date.now()-86400000).toISOString();
    const p=await buildBriefingEvidence(profile,periodEnd,{periodStart,periodEnd});assert.equal(p.periodEnd,periodEnd);assert.equal(p.items.find(x=>x.id==='signal:late')?.temporalClass,"late_arrival");
    assert.ok(p.sourceHealth.some(x=>x.source==='dart'&&x.status==='fresh'));assert.ok(p.sourceHealth.some(x=>x.source==='news'&&x.status==='unavailable'));
  });
  await t.test("원신호도 제외 상태와 정확한 기업·업종 조건을 프로젝트와 동일하게 적용",async()=>{
    for(const [id,company,industry,status] of [['exact','삼성전자','semiconductor','new'],['partner','삼성전자 협력사','semiconductor','new'],['dismissed','삼성전자','semiconductor','dismissed'],['other-industry','삼성전자','semiconductor_parts','new']])
      await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,industry,region,status,created_at,updated_at) VALUES($1,'news',$2,'기업 투자',$3,'경기도 용인시',$4,now()::text,now()::text)",[`filter-${id}`,company,industry,status]);
    const p=await saveBriefingProfile('u1',{name:'정확 조건',enabled:false,filters:{companyNames:['삼성전자'],industries:['semiconductor'],regions:['경기도']}});
    const preview=await buildBriefingEvidence(p,new Date(Date.now()+1000).toISOString());
    assert.deepEqual(preview.items.filter(e=>e.kind==='signal').map(e=>e.id),['signal:filter-exact']);assert.equal(preview.totalSignals,1);
  });
  await t.test("문서 이력을 가진 기존 수집 신호도 원신호와 프로젝트를 양방향 연결",async()=>{
    await db.query("INSERT INTO scraper_sources(source_id,slug,name,created_at,updated_at) VALUES('legacy-link-source','legacy-link-source','기존 수집',now()::text,now()::text)");
    await db.query("INSERT INTO intel_projects(project_id,title,company_name,industry,public_summary,created_by,created_at,updated_at) VALUES('legacy-link-project','기존 공장 증설','근거연결회사','semiconductor','기존 기사와 공시를 함께 확인','u1',now(),now())");
    for(const source of ['dart','news']) {
      await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,industry,created_at,updated_at) VALUES($1,$2,'근거연결회사','기존 공장 증설','semiconductor',now()::text,now()::text)",[`legacy-link-${source}`,source]);
      await db.query("INSERT INTO intel_project_signals(project_id,signal_id,reason) VALUES('legacy-link-project',$1,'같은 투자 근거')",[`legacy-link-${source}`]);
      await db.query("INSERT INTO intel_source_documents(document_id,source_id,external_id,document_type,title,url,signal_id) VALUES($1,'legacy-link-source',$2,'company_event','기존 공장 증설','https://example.test/legacy',$3)",[`legacy-doc-${source}`,source,`legacy-link-${source}`]);
    }
    const p=await saveBriefingProfile('u1',{name:'원근거 연결',enabled:false,filters:{companyNames:['근거연결회사']}});
    const result=await buildBriefingEvidence(p,new Date(Date.now()+1000).toISOString());
    assert.deepEqual(result.items.find(e=>e.id==='project:legacy-link-project')?.relatedEvidenceIds?.sort(),['signal:legacy-link-dart','signal:legacy-link-news']);
    for(const source of ['dart','news']) assert.deepEqual(result.items.find(e=>e.id===`signal:legacy-link-${source}`)?.relatedEvidenceIds,['project:legacy-link-project']);
    assert.ok(!result.items.some(e=>e.id.startsWith('official:legacy-doc-')));
  });
  await t.test("180일 된 유효 공식 투자 근거는 동향 기간과 분리해 유지하고 권리 회수는 적용",async()=>{
    const rights={storageAllowed:true,aiAllowed:true,internalReportAllowed:true};
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,industry,region,created_at,updated_at) VALUES('long-official','official:test','장기회사','장기 투자','semiconductor','경기도 용인시',(now()-interval '180 days')::text,(now()-interval '180 days')::text)");
    await db.query("INSERT INTO intel_projects(project_id,title,company_name,industry,region,public_summary,created_by,created_at,updated_at) VALUES('long-project','장기 투자','장기회사','semiconductor','경기도 용인시','공식 발표에 따른 장기 투자','u1',now()-interval '180 days',now()-interval '180 days')");
    await db.query("INSERT INTO intel_project_signals(project_id,signal_id,reason) VALUES('long-project','long-official','공식 자료')");
    await db.query("INSERT INTO intel_source_documents(document_id,source_id,external_id,document_type,title,url,signal_id) VALUES('old-document','official-test','old','company_event','장기 투자','https://example.test/old','long-official')");
    await db.query("INSERT INTO intel_source_document_revisions(revision_id,document_id,content_hash,normalized_text,structured_data,rights_snapshot,fetched_at) VALUES('old-revision','old-document','oldhash','장기회사 장기 투자 계획',$1::jsonb,$2::jsonb,now()-interval '180 days')",[JSON.stringify({evidence:{title:'장기 투자',url:'https://example.test/old',companyName:'장기회사',industries:['semiconductor']}}),JSON.stringify(rights)]);
    await db.query("UPDATE intel_source_documents SET current_revision_id='old-revision' WHERE document_id='old-document'");
    const p=await saveBriefingProfile('u1',{name:'장기 투자',enabled:false,filters:{companyNames:['장기회사']}});
    const preview=await buildBriefingEvidence(p,new Date(Date.now()+1000).toISOString());assert.equal(preview.totalProjects,1);assert.ok(preview.items.some(e=>e.id==='project:long-project'));assert.ok(preview.items.some(e=>e.id==='official:old-document'));
    assert.deepEqual(preview.items.find(e=>e.id==='project:long-project')?.relatedEvidenceIds,['official:old-document']);
    assert.deepEqual(preview.items.find(e=>e.id==='official:old-document')?.relatedEvidenceIds,['project:long-project']);
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','false') WHERE source_id='official-test'");
    const revoked=await buildBriefingEvidence(p,new Date(Date.now()+1000).toISOString());assert.equal(revoked.totalProjects,0);assert.ok(!revoked.items.some(e=>e.id==='official:old-document'));
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','true') WHERE source_id='official-test'");
  });
  await t.test("필수 자료 미확인은 대기이고 API 키 부재는 가짜 보고서를 만들지 않음",async()=>{
    const p=await saveBriefingProfile("u1",{name:"실패 검증",requiredSources:["news"]});await queueManualBriefing(p.profileId,"u1","wait-source-test");
    const claim=await claimBriefingRun();assert.ok(claim);assert.equal(await executeClaimedBriefing(claim!,fakeGenerate),"waiting_sources");
    const p2=await saveBriefingProfile("u1",{name:"AI 미설정"});const run=await queueManualBriefing(p2.profileId,"u1","no-model-test");const c=await claimBriefingRun();assert.ok(c);assert.equal(await executeClaimedBriefing(c!),"failed");
    const row=await getBriefingRun(run.runId,"u1");assert.match(row.error!,/API 키/);assert.equal(row.briefingId,null);
  });
  await t.test("동일 정기 슬롯은 하나·발행 뒤 증분 원장·중지된 lease의 결과 커밋 차단",async()=>{
    profile=await saveBriefingProfile("u1",{version:profile.version,updatedAt:profile.updatedAt,enabled:true,schedule:{...profile.schedule,cadence:"daily",startDate:"2020-01-01",time:"00:00"}},profile.profileId);
    await db.query("UPDATE intel_briefing_profiles SET next_run_at=now()-interval '1 day' WHERE profile_id=$1",[profile.profileId]);
    await Promise.all([queueDueBriefings(),queueDueBriefings()]);assert.equal((await db.query("SELECT count(*) n FROM intel_briefing_runs WHERE profile_id=$1 AND trigger='scheduled'",[profile.profileId])).rows[0].n,"1");
    const claim=await claimBriefingRun();assert.ok(claim);profile=await saveBriefingProfile("u1",{version:profile.version,updatedAt:profile.updatedAt,enabled:false},profile.profileId);
    await executeClaimedBriefing(claim!,fakeGenerate);assert.equal((await db.query("SELECT status FROM intel_briefing_runs WHERE run_id=$1",[claim!.runId])).rows[0].status,"canceled");
  });
  await t.test("만료된 실행자의 결과를 차단하고 재선점해도 최초 기준은 유지",async()=>{
    const p=await saveBriefingProfile("u1",{name:"재선점 검증",enabled:false});const run=await queueManualBriefing(p.profileId,"u1","lease-recovery-test");
    const first=await claimBriefingRun();assert.equal(first!.runId,run.runId);assert.equal(first!.periodStart,null);
    await db.query("UPDATE intel_briefing_runs SET lease_until=now()-interval '1 second' WHERE run_id=$1",[run.runId]);
    const second=await claimBriefingRun();assert.equal(second!.runId,run.runId);assert.equal(second!.periodStart,null);assert.notEqual(second!.token,first!.token);
    await executeClaimedBriefing(first!,fakeGenerate);assert.equal((await getBriefingRun(run.runId,"u1")).status,"running");
    assert.equal(await executeClaimedBriefing(second!,fakeGenerate),"published");
    assert.equal((await db.query("SELECT count(*) n FROM intel_rag_briefings WHERE run_id=$1",[run.runId])).rows[0].n,"1");
  });
  await t.test("정기 발행만 증분 기준을 기록하고 같은 근거의 다음 실행은 새 변동 없음",async()=>{
    const p=await saveBriefingProfile("u1",{name:"정기 증분 검증",enabled:true});
    for(let i=1;i<=2;i++) {
      const slot=new Date(Date.now()+i*1000).toISOString();
      await db.query("INSERT INTO intel_briefing_runs(run_id,profile_id,trigger,scheduled_for,profile_version,config_snapshot) VALUES($1,$2,'scheduled',$3,$4,$5::jsonb)",[`incremental-${i}`,p.profileId,slot,p.version,JSON.stringify(p)]);
      const claim=await claimBriefingRun();assert.equal(claim!.runId,`incremental-${i}`);
      assert.equal(await executeClaimedBriefing(claim!,fakeGenerate),i===1?'published':'no_change');
    }
    assert.ok(Number((await db.query("SELECT count(*) n FROM intel_profile_seen_revisions WHERE profile_id=$1",[p.profileId])).rows[0].n)>0);
    assert.equal((await db.query("SELECT count(*) n FROM intel_notification_outbox d JOIN intel_briefing_runs r ON r.briefing_id=d.briefing_id WHERE r.run_id='incremental-2'")).rows[0].n,'0');
  });
  await t.test("중요 알림은 야간 보류·일일 상한·익일 묶음과 성공 무중복을 지킴",async()=>{
    const p=await saveBriefingProfile("u1",{name:"알림 상한",enabled:true,importantAlerts:true});
    // 앞선 브리핑 전달은 이 검증 대상과 분리한다.
    await db.query("UPDATE intel_notification_outbox SET next_attempt_at='9999-12-31' WHERE kind='briefing' AND status='pending'");
    const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),daytime=new Date(`${day}T12:00:00+09:00`),night=new Date(`${day}T23:00:00+09:00`);
    process.env.INTEL_IMPORTANT_DAILY_LIMIT='1';
    for(let i=1;i<=3;i++)await db.query("INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,event_id,user_id,channel,kind,payload) VALUES($1,$1,$2,$3,'u1','inbox','important',$4::jsonb)",[`important-${i}`,p.profileId,`event-${i}`,JSON.stringify({title:`중요${i}`,text:`변경${i}`,eventId:`event-${i}`,link:'/sales/rag?tab=projects',profileIds:[p.profileId]})]);
    assert.equal((await dispatchBriefingDeliveries(20,night)).sent,0);
    assert.equal((await db.query("SELECT count(*) n FROM intel_notification_outbox WHERE delivery_id LIKE 'important-%' AND status='pending' AND attempt=0")).rows[0].n,"3");
    await db.query("UPDATE intel_notification_outbox SET next_attempt_at=now() WHERE delivery_id LIKE 'important-%'");
    assert.equal((await dispatchBriefingDeliveries(20,daytime)).sent,1);
    const digest=(await db.query("SELECT * FROM intel_notification_outbox WHERE payload->>'digest'='true'")).rows[0];assert.ok(digest);
    assert.equal((await db.query("SELECT count(*) n FROM intel_notification_outbox WHERE digest_delivery_id=$1",[digest.delivery_id])).rows[0].n,"2");
    await db.query("UPDATE intel_notification_outbox SET next_attempt_at=now() WHERE delivery_id=$1",[digest.delivery_id]);
    const before=Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n);
    assert.equal((await dispatchBriefingDeliveries(20,daytime)).sent,1);
    assert.equal(Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n),before+1);
    assert.equal((await db.query("SELECT count(*) n FROM intel_notification_outbox WHERE delivery_id LIKE 'important-%' AND status='sent'")).rows[0].n,"3");
    assert.equal((await db.query("SELECT jsonb_array_length(payload->'eventIds') n FROM intel_notification_outbox WHERE delivery_id=$1",[digest.delivery_id])).rows[0].n,2);
    await dispatchBriefingDeliveries(20,daytime);assert.equal(Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n),before+1);
    // 외부 채널 결과 불명은 원사건에도 유지하고 자동으로 다시 보내지 않는다.
    await db.query("INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,user_id,channel,kind,payload,status,lease_until) VALUES('unknown-digest','unknown-digest',$1,'u1','email','important','{\"digest\":true}','sending',now()-interval '1 minute')",[p.profileId]);
    await db.query("INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,user_id,channel,kind,payload,digest_delivery_id) VALUES('unknown-member','unknown-member',$1,'u1','email','important','{}','unknown-digest')",[p.profileId]);
    await dispatchBriefingDeliveries(20,daytime);await dispatchBriefingDeliveries(20,daytime);
    assert.equal((await db.query("SELECT count(*) n FROM intel_notification_outbox WHERE delivery_id IN('unknown-digest','unknown-member') AND status='unknown'")).rows[0].n,"2");
    delete process.env.INTEL_IMPORTANT_DAILY_LIMIT;
  });
  await t.test("뉴스 제목·요약 재검증 보류는 정기 분석의 원자료와 파생 프로젝트를 함께 제외",async()=>{
    const qualityProfile=await saveBriefingProfile('u1',{name:'뉴스 품질 경계',enabled:false,filters:{companyNames:['품질검증기업']}});
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,industry,created_at,updated_at) VALUES('brief-quality-held','news','품질검증기업','공장 투자 요구','과거 분류 요약','semiconductor',now()::text,now()::text),('brief-quality-legacy','news','품질검증기업','별도 공장 계획','기존 자료 요약','semiconductor',now()::text,now()::text)");
    const initial=await ingestSignalProjects({signalIds:['brief-quality-held','brief-quality-legacy'],mode:'initial_backfill'});assert.equal(initial.created,2);
    const originalPreview=await buildBriefingEvidence(qualityProfile);assert.equal(originalPreview.totalSignals,2);
    const quality=createNewsContentQuality({title:'공장 투자 요구',description:'정부가 투자 발표를 촉구했다.',decision:'background',titleRelation:'background',reason:'기업의 확정 투자가 아닌 요구 기사'});
    await db.query("UPDATE intel_signals SET signal_grade='monitoring',raw_json=$1,updated_at=now()::text WHERE signal_id='brief-quality-held'",[JSON.stringify({classification:{contentQuality:quality}})]);
    const result=await buildBriefingEvidence(qualityProfile,new Date(Date.now()+1000).toISOString());assert.equal(result.totalSignals,1);assert.equal(result.totalProjects,1);
    assert.match(result.coverageNote??'',/보류된 수집 자료 1건/);
    await assert.rejects(assertBriefingEvidenceContentQuality(originalPreview.items),/재검증/);
    await assert.rejects(assertBriefingEvidenceContentQuality(originalPreview.items.filter(e=>e.kind==='project')),/재검증/);
    await assertBriefingEvidenceContentQuality(result.items);
    assert.ok(result.items.some(e=>e.id==='signal:brief-quality-legacy'));
    assert.ok(!result.items.some(e=>e.id==='signal:brief-quality-held'||e.text.includes('과거 분류 요약')));
    assert.equal((await db.query("SELECT summary FROM intel_signals WHERE signal_id='brief-quality-held'")).rows[0].summary,'과거 분류 요약');
    const retry=await queueManualBriefing(qualityProfile.profileId,'u1','held-snapshot-retry');
    await db.query("INSERT INTO intel_briefing_snapshots(snapshot_id,run_id,as_of,payload) VALUES('held-old-snapshot',$1,now(),$2::jsonb)",[retry.runId,JSON.stringify(originalPreview)]);
    await db.query("UPDATE intel_briefing_runs SET snapshot_id='held-old-snapshot' WHERE run_id=$1",[retry.runId]);
    const retryClaim=await claimBriefingRun();assert.equal(retryClaim!.runId,retry.runId);let calls=0;
    const trackedGenerate:typeof generateScheduledBriefing=async(...args)=>{calls++;return fakeGenerate(...args);};
    assert.equal(await executeClaimedBriefing(retryClaim!,trackedGenerate),'failed');assert.equal(calls,0);
    assert.equal((await getBriefingRun(retry.runId,'u1')).briefingId,null);
    await db.query("UPDATE intel_signals SET raw_json=NULL,updated_at=now()::text WHERE signal_id='brief-quality-held'");
    const race=await queueManualBriefing(qualityProfile.profileId,'u1','held-during-generation');const raceClaim=await claimBriefingRun();assert.equal(raceClaim!.runId,race.runId);
    const raceGenerate:typeof generateScheduledBriefing=async(...args)=>{calls++;await db.query("UPDATE intel_signals SET raw_json=$1,updated_at=now()::text WHERE signal_id='brief-quality-held'",[JSON.stringify({classification:{contentQuality:quality}})]);return fakeGenerate(...args);};
    assert.equal(await executeClaimedBriefing(raceClaim!,raceGenerate),'failed');assert.equal(calls,1);
    const failed=await getBriefingRun(race.runId,'u1');assert.equal(failed.briefingId,null);assert.match(failed.error??'',/재검증/);
  });
  await t.test("할 일이 없는 실행 힌트는 1시간 유효하고 틱에서 DB를 깨우지 않음",async()=>{
    await db.query("UPDATE intel_briefing_profiles SET enabled=false; UPDATE intel_briefing_runs SET next_attempt_at='9999-12-31',lease_until=NULL; UPDATE intel_notification_outbox SET next_attempt_at='9999-12-31'; UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{enabled}','false')");
    const wake=await refreshBriefingWakeup();assert.equal(wake.nextDueAt,null);assert.ok(Date.parse(wake.expiresAt)-Date.parse(wake.checkedAt)>=59*60000);
    await invalidateDb();process.env.DATABASE_URL='postgresql://invalid@127.0.0.1:1/unreachable';process.env.INTEL_BRIEFING_ENABLED='true';
    assert.deepEqual(await triggerDueBriefingWorker(),{skipped:'not-due'});process.env.DATABASE_URL=raw;delete process.env.INTEL_BRIEFING_ENABLED;
  });
});
