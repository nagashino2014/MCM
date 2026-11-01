import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { assertBriefingCapability, assertBriefingDocumentOwner, getBriefingCapabilities, getBriefingDocumentPermissions, briefingVisibilitySql } from "../lib/intel/briefing-access";
import { assertBriefingAccess, getBriefingProfile, saveBriefingProfile } from "../lib/intel/briefing-store";
import { listBriefings, listSharedBriefings, getBriefing } from "../lib/intel/rag-queries";
import { dispatchBriefingDeliveries } from "../lib/intel/briefing-delivery";
import { hasPermission } from "../lib/auth/rbac";
import { invalidateDb } from "../lib/db";

test("브리핑 전용 권한과 비공개·개별 공유 ACL — 독립 PostgreSQL",async t=>{
  const raw=process.env.INTEL_BRIEFING_ACCESS_TEST_DATABASE_URL!;const url=new URL(raw);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));assert.equal(url.port,"55439");assert.equal(url.pathname,"/intel_briefing_access_test");assert.equal(url.search,"");
  const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new Client({connectionString:adminUrl.toString(),ssl:false});
  await admin.connect();try{if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_briefing_access_test'")).rowCount)await admin.query("CREATE DATABASE intel_briefing_access_test");}finally{await admin.end();}
  const db=new Client({connectionString:raw,ssl:false});await db.connect();t.after(async()=>{await invalidateDb();await db.end();});
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  const base=(await readFile("tests/fixtures/project-intelligence-base.sql","utf8")).replace(/^CREATE TABLE (scraper_sources|intel_source_documents|intel_source_document_revisions)\(.*\);\r?\n/gm,"");await db.query(base);
  const source=(await readFile("tests/fixtures/official-sources-base.sql","utf8")).split(/\r?\n/).filter(line=>/^CREATE TABLE scraper_(sources|endpoints)\(/.test(line));await db.query(source.join("\n"));
  await db.query(`ALTER TABLE users ADD COLUMN email text,ADD COLUMN name text;
    ALTER TABLE employee_profiles ADD COLUMN user_id text;
    ALTER TABLE permission_template_grants ADD COLUMN created_at text;
    CREATE TABLE permissions(permission_key text PRIMARY KEY,module text,action text,description text,scopes_supported text,is_dangerous integer,created_at text);
    CREATE TABLE intel_rag_briefings(briefing_id text PRIMARY KEY,question text NOT NULL,answer_md text,sources jsonb,filters jsonb,model text,status text,error text,created_by text,created_at text);
    CREATE TABLE intel_embeddings(signal_id text PRIMARY KEY,content text);
    INSERT INTO permission_templates(template_id) VALUES('tpl-system-admin'),('tpl-ceo'),('tpl-exec'),('tpl-sales'),('tpl-sales-staff'),('reader'),('deny');
    INSERT INTO users(user_id,role) VALUES('executive','member'),('administrator','admin'),('sales','member'),('reader','member'),('outsider','admin');
    INSERT INTO user_permission_assignments(assignment_id,user_id,template_id) VALUES('exec','executive','tpl-exec'),('admin','administrator','tpl-system-admin'),('sales','sales','tpl-sales-staff'),('reader','reader','reader');
    INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect) VALUES('reader-view','reader','intel.briefing.view','all','allow');`);
  for(const name of ["319_official_intelligence_sources.sql","320_project_intelligence.sql","131_rag_briefing_share.sql","321_scheduled_intelligence_briefings.sql","322_briefing_access_permissions.sql","322_briefing_access_permissions.sql"])await db.query(await readFile(`../infra/aws/${name}`,"utf8"));
  Object.assign(process.env,{DATABASE_URL:raw,PGSSL:"disable",NODE_ENV:"test",INTEL_BRIEFING_ENABLED:"false"});delete process.env.MCM_STORAGE_BUCKET;delete process.env.MCM_DB_EXPECTED_ROLE;delete process.env.MCM_DB_ROLE_REQUIRED;delete process.env.ANTHROPIC_API_KEY;await invalidateDb();
  const denied=(e:unknown)=>[403,404].includes(Number((e as {status?:number}).status));
  await t.test("템플릿 5종만 멱등 확장하고 영업 권한·admin 플래그는 우회 근거가 아님",async()=>{
    assert.equal(Number((await db.query("SELECT count(*) n FROM permission_template_grants WHERE template_id LIKE 'tpl-%' AND permission_key LIKE 'intel.briefing.%'")).rows[0].n),15);
    for(const uid of ["executive","administrator","sales"]){assert.deepEqual(await getBriefingCapabilities(uid),{canView:true,canCreate:true,canShare:true});assert.equal(await hasPermission(uid,"sales.edit"),false);}
    assert.deepEqual(await getBriefingCapabilities("reader"),{canView:true,canCreate:false,canShare:false});
    assert.deepEqual(await getBriefingCapabilities("outsider"),{canView:false,canCreate:false,canShare:false});
    assert.throws(()=>briefingVisibilitySql("b;DROP TABLE users"));
  });
  const profile=await saveBriefingProfile("executive",{name:"전용 권한 임원 프로필",enabled:false,visibility:"shared",recipients:[{userId:"sales",channels:["inbox"]}]});
  await db.query(`INSERT INTO intel_rag_briefings(briefing_id,question,answer_md,sources,filters,status,created_by,created_at) VALUES('manual','본인 수동','공개 근거 기반 시험','[]','{}','done','executive',now()::text),('other','다른 사람 수동','비공개','[]','{}','done','sales',now()::text),('orphan','미확인 소유자','비공개','[]','{}','done',NULL,now()::text)`);
  await db.query(`INSERT INTO intel_rag_briefings(briefing_id,question,answer_md,sources,filters,status,created_by,created_at,access_scope,profile_id) VALUES('scheduled','정기 발행본','공개 근거 기반 시험','[]','{}','done','sales',now()::text,'restricted',$1)`,[profile.profileId]);
  await t.test("수동·정기 보고서 소유자만 관리·공유하고 관리자는 남의 비공개 자료를 못 봄",async()=>{
    await assertBriefingDocumentOwner("manual","executive");await assertBriefingDocumentOwner("scheduled","executive");
    await assert.rejects(assertBriefingAccess("manual","administrator"),denied);await assert.rejects(assertBriefingDocumentOwner("scheduled","sales"),denied);
    await assert.rejects(assertBriefingAccess("orphan","executive"),denied);
    assert.deepEqual(new Set((await listBriefings(100,"executive")).map(b=>b.briefingId)),new Set(["manual","scheduled"]));
    assert.equal((await getBriefing("manual","executive"))?.canShare,true);
    assert.deepEqual(await getBriefingDocumentPermissions("scheduled","sales"),{canShare:false,canManage:false});
  });
  await t.test("개별 공유는 정기 발행본만 개방하며 프로필 권한·재공유 권한을 주지 않음",async()=>{
    await db.query("INSERT INTO intel_rag_briefing_shares(share_id,briefing_id,recipient_user_id,shared_by,created_at,explicit_share) VALUES('individual','scheduled','reader','executive',now()::text,true)");
    await assertBriefingAccess("scheduled","reader");await assert.rejects(getBriefingProfile(profile.profileId,"reader"),denied);
    await assert.rejects(assertBriefingDocumentOwner("scheduled","reader"),denied);
    const shared=await listSharedBriefings("reader");assert.equal(shared.length,1);assert.equal(shared[0].canShare,false);assert.equal(shared[0].canManage,false);
    await db.query("DELETE FROM intel_rag_briefing_shares WHERE share_id='individual'");await assert.rejects(assertBriefingAccess("scheduled","reader"),denied);
    await db.query("DELETE FROM intel_briefing_recipients WHERE profile_id=$1 AND user_id='sales'",[profile.profileId]);await assert.rejects(assertBriefingAccess("scheduled","sales"),denied);
  });
  await t.test("기존 sales 호환을 유지하되 명시 deny 및 비활성 계정은 즉시 차단",async()=>{
    assert.deepEqual(await getBriefingCapabilities("u1"),{canView:true,canCreate:true,canShare:true});
    await db.query("INSERT INTO user_permission_assignments(assignment_id,user_id,template_id) VALUES('deny-u1','u1','deny');INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect) VALUES('deny-create','deny','intel.briefing.create','all','deny')");
    assert.deepEqual(await getBriefingCapabilities("u1"),{canView:true,canCreate:false,canShare:true});await assert.rejects(assertBriefingCapability("u1","create"),denied);
    await db.query("INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect) VALUES('deny-view','deny','intel.briefing.view','all','deny')");
    assert.deepEqual(await getBriefingCapabilities("u1"),{canView:false,canCreate:false,canShare:false});
    await db.query("UPDATE users SET status='inactive' WHERE user_id='executive'");await assert.rejects(assertBriefingAccess("manual","executive"),denied);await db.query("UPDATE users SET status='active' WHERE user_id='executive'");
  });
  await t.test("예약 발송 직전에 열람 권한이 회수되면 발송하지 않음",async()=>{
    await db.query("INSERT INTO intel_briefing_recipients(profile_id,user_id,channels) VALUES($1,'sales','[\"inbox\"]')",[profile.profileId]);
    await db.query("INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,briefing_id,user_id,channel,kind,payload) VALUES('revoked','revoked',$1,'scheduled','sales','inbox','briefing','{\"title\":\"시험\",\"text\":\"시험\",\"link\":\"/sales/rag\"}')",[profile.profileId]);
    await db.query("INSERT INTO user_permission_assignments(assignment_id,user_id,template_id) VALUES('deny-sales','sales','deny')");
    assert.deepEqual(await dispatchBriefingDeliveries(),{sent:0,failed:0,skipped:1});
  });
});
