import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { diagnose, audit, formatProposals, proposals, validBrn, type Profile, type Snapshot } from "@scraper/lib/facility-quality/rules";
import { createRun, auditItem, rows, saveProposals, type Database, type Transaction } from "@scraper/lib/facility-quality/store";
import { reviewCandidates, markReviewedWrite } from "@/lib/ieps/facility-update";
import { processQualityRun } from "@scraper/lib/facility-enrichment/runner";
import { enqueueAwsJob, isFacilityQualityQueueEnabled } from "@/lib/ieps/aws-job-queue";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ECSClient } from "@aws-sdk/client-ecs";
const snapshot = (changes:Partial<Snapshot> = {}): Snapshot => ({facility_id:"test1",company_name:"에이에스이코리아(주)",business_registration_no:"207-81-00390",site_business_registration_no:null,corporate_registration_no:null,business_certificate_corporate_registration_no:null,representative_name:null,phone_number:null,site_address:"경기도 파주시 산업단지길 76",...changes});
test("사업자번호: 3-2-5, 검증자리, 가림값, 문자·숫자 변경 금지",()=>{
  assert.ok(validBrn("2078100390"));
  assert.equal(diagnose("business_registration_no","2078100390").normalized,"207-81-00390");
  for(const input of ["207810039","2078100391","207-81-0****","a2078100390","0000000000","2078100390/2078100390"]) assert.equal(diagnose("business_registration_no",input).status,"review",input);
});
test("네 가지 전화 형식과 전국·국제·안심·내선·복수 예외",()=>{
  for(const [input,expected] of [["021234567","02-123-4567"],["0212345678","02-1234-5678"],["0311234567","031-123-4567"],["01012345678","010-1234-5678"],["15881234","1588-1234"]])assert.equal(diagnose("phone_number",input).normalized,expected);
  assert.equal(diagnose("phone_number","0991234567").status,"review");
  for(const input of ["02-123-4567 / 031-123-4567","02-123-4567 내선 123","02-123-4567\n031-123-4567"])assert.equal(diagnose("phone_number",input).normalized,undefined);
  for(const input of ["+82-2-1234-5678","0507-1234-5678"])assert.equal(diagnose("phone_number",input).status,"valid");
});
test("법인번호·공동대표·주소와 보조 컬럼의 출처 충돌",()=>{
  assert.equal(diagnose("corporate_registration_no","1101110006422").normalized,"110111-0006422");
  assert.equal(diagnose("corporate_registration_no","110111000642").status,"review");
  assert.equal(diagnose("representative_name","김철수, LEE GI CHOL").status,"valid");
  assert.equal(diagnose("site_address","경기도  파주시 산업단지길 76").normalized,"경기도 파주시 산업단지길 76");
  assert.equal(audit(snapshot({site_business_registration_no:"124-81-00998"})).business_registration_no.status,"conflict");
  assert.equal(formatProposals(snapshot({business_registration_no:"2078100390",site_business_registration_no:"1248100998"})).length,0);
});
test("본사/공장, 동명, 불일치 식별키와 비즈노 대표자 금지",()=>{
  const p:Profile={source:"bizno",name:"에이에스이코리아(주)",url:"https://bizno.net/article/2078100390",retrievedAt:"2026-09-08",scope:"headquarters",values:{business_registration_no:"2078100390",representative_name:"절대저장금지",phone_number:"0319400114",site_address:"서울특별시 다른로 1"}};
  const got=proposals(snapshot(),p);assert.ok(got.length);assert.ok(!JSON.stringify(got).includes("절대저장금지"));assert.ok(got.every(c=>!c.recommended));assert.equal(got.find(c=>c.field==="site_address")?.match,"review");
  const wrong=proposals(snapshot({business_registration_no:"124-81-00998"}),p);assert.ok(wrong.every(c=>c.match==="blocked"));
  assert.equal(proposals(snapshot({company_name:"전혀다른(주)",business_registration_no:null}),p).length,0);
  assert.equal(proposals(snapshot({company_name:"전혀다른(주)",business_registration_no:"124-81-00998"}),p).length,0,"관련 없는 검색 결과는 번호가 다르다는 이유만으로 충돌 후보를 만들지 않는다");
});

const testUrl = process.env.FACILITY_QUALITY_TEST_DATABASE_URL;
test("SQS 전달 뒤 워커 기동, 서버 설정 사용, 기동 실패 전달", async()=>{
  const original={...process.env};const sqsSend=SQSClient.prototype.send;const ecsSend=ECSClient.prototype.send;
  const calls:{kind:string;input:any}[]=[];
  try {
    Object.assign(process.env,{MCM_JOB_QUEUE_MODE:'sqs',MCM_JOB_QUEUE_URL:'https://example.invalid/queue',MCM_FACILITY_QUALITY_WORKER_READY:'true',MCM_FACILITY_QUALITY_TASK_DEFINITION:'worker:3',MCM_FACILITY_QUALITY_CLUSTER:'cluster',MCM_FACILITY_QUALITY_SUBNETS:'subnet-1,subnet-2',MCM_FACILITY_QUALITY_SECURITY_GROUPS:'sg-1'});
    SQSClient.prototype.send=(async(command:any)=>{calls.push({kind:'sqs',input:command.input});return {};}) as any;
    ECSClient.prototype.send=(async(command:any)=>{calls.push({kind:'ecs',input:command.input});return {tasks:[{taskArn:'task'}]};}) as any;
    assert.equal(isFacilityQualityQueueEnabled(),true);
    const result=await enqueueAwsJob({type:'facility-enrich',runId:'saved-run'});
    assert.deepEqual(calls.map(c=>c.kind),['sqs','ecs']);
    assert.equal(calls[1].input.clientToken,result.jobId);assert.equal(calls[1].input.taskDefinition,'worker:3');
    assert.deepEqual(calls[1].input.overrides.containerOverrides[0].command,['npm','run','worker:aws','--','--drain']);
    ECSClient.prototype.send=(async()=>({failures:[{reason:'capacity'}]})) as any;
    await assert.rejects(()=>enqueueAwsJob({type:'facility-enrich',runId:'retry-run'}),/기동 실패/);
    delete process.env.MCM_FACILITY_QUALITY_TASK_DEFINITION;assert.equal(isFacilityQualityQueueEnabled(),false);
  } finally {
    SQSClient.prototype.send=sqsSend;ECSClient.prototype.send=ecsSend;
    for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
  }
});
test("PostgreSQL: 스냅샷·멱등·CAS·주소 동시 갱신·복원·재유입 보호", {skip:!testUrl}, async()=>{
  const url=new URL(testUrl!);
  assert.ok(["localhost","127.0.0.1"].includes(url.hostname),"테스트는 로컬 DB만 허용");
  const pool=new Pool({connectionString:testUrl,ssl:false});
  const schema=`quality_test_${process.pid}_${Date.now()}`;
  const wrap=(client:any):Database=>({async run(sql,params=[]){await client.query(sql,params);},async exec(sql,params=[]){const r=await client.query(sql,params);return r.fields.length?[{columns:r.fields.map((f:any)=>f.name),values:r.rows.map((row:any)=>r.fields.map((f:any)=>row[f.name]))}]:[];}});
  const tx:Transaction=async fn=>{const c=await pool.connect();try{await c.query("BEGIN");await c.query(`SET LOCAL search_path TO ${schema}`);const r=await fn(wrap(c));await c.query("COMMIT");return r;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}};
  await pool.query(`CREATE SCHEMA ${schema}`);
  try {
    await tx(async db=>{
      await db.run(`CREATE TABLE facilities(facility_id text PRIMARY KEY,company_name text, business_registration_no text,site_business_registration_no text,
        representative_name text,phone_number text,corporate_registration_no text,business_certificate_corporate_registration_no text,
        site_address text,site_address_verbatim boolean DEFAULT false,normalized_address text,region_sido text,region_sigungu text,
        additional_site_addresses text,source text,deleted_at text,updated_at text);
        CREATE TABLE facility_history_events(facility_id text,event_type text,event_types text);
        CREATE TABLE audit_log(actor_user_id text,action text,target_table text,target_id text,before_json jsonb,after_json jsonb,created_at text);`);
      const sql=readFileSync("../infra/aws/220_facility_quality.sql","utf8");await db.run(sql);await db.run(sql);
      await db.run("INSERT INTO facilities(facility_id,company_name,business_registration_no,phone_number,site_address,normalized_address,region_sido,region_sigungu,additional_site_addresses) VALUES('a','검증회사','2078100390','0311234567','서울특별시 종로구 세종대로 1','기존정규주소','서울특별시','종로구','[\"보조주소 1\"]')");
    });
    const id=await tx(db=>createRun(db,"tester","audit",{sources:[]}));
    const s=(await tx(db=>rows<{snapshot:Snapshot}>(db,"SELECT snapshot FROM facility_quality_items WHERE run_id=$1",[id])))[0].snapshot;
    await tx(db=>auditItem(db,id,s));await tx(db=>auditItem(db,id,s));
    const cs=await tx(db=>rows<any>(db,"SELECT * FROM facility_enrichment_candidates WHERE run_id=$1",[id]));
    assert.equal(cs.length,2,"재진단 중복 없음");
    const phone=cs.find(c=>c.field==="phone_number");const brn=cs.find(c=>c.field==="business_registration_no");
    let r=await reviewCandidates(tx,[phone.candidate_id,brn.candidate_id],"tester","apply");assert.equal(r.applied,2);
    await reviewCandidates(tx,[phone.candidate_id],"tester","apply");
    assert.equal((await tx(db=>rows<any>(db,"SELECT count(*)::int n FROM audit_log WHERE action='facility_enrich_apply'")))[0].n,2,"재반영 감사 중복 없음");
    await tx(db=>db.run("UPDATE facilities SET phone_number='031-999-9999' WHERE facility_id='a'"));
    assert.equal((await tx(db=>rows<any>(db,"SELECT phone_number FROM facilities WHERE facility_id='a'")))[0].phone_number,"031-123-4567","재수집 덮어쓰기 차단");
    assert.equal((await tx(db=>rows<any>(db,"SELECT count(*)::int n FROM facility_enrichment_candidates WHERE source='ingestion'")))[0].n,1);
    r=await reviewCandidates(tx,[phone.candidate_id],"tester","revert");assert.equal(r.results[0].status,"reverted");
    assert.equal((await tx(db=>rows<any>(db,"SELECT phone_number FROM facilities WHERE facility_id='a'")))[0].phone_number,"0311234567");
    const fresh=(await tx(db=>rows<any>(db,"SELECT facility_quality_snapshot(f) snapshot FROM facilities f WHERE facility_id='a'")))[0].snapshot;
    await tx(db=>saveProposals(db,id,fresh,[{field:"site_address",value:"경기도 파주시 산업단지길 76",source:"naver",url:"https://search.naver.com",evidence:{},match:"review",recommended:false}]));
    const address=(await tx(db=>rows<any>(db,"SELECT candidate_id FROM facility_enrichment_candidates WHERE field='site_address'")))[0].candidate_id;
    await reviewCandidates(tx,[address],"tester","apply");
    const after=(await tx(db=>rows<any>(db,"SELECT * FROM facilities WHERE facility_id='a'")))[0];
    assert.equal(after.site_address,after.normalized_address);assert.equal(after.region_sido,"경기도");assert.equal(after.region_sigungu,"파주시");assert.equal(after.site_address_verbatim,true);assert.equal(after.additional_site_addresses,'["보조주소 1"]');
    await reviewCandidates(tx,[address],"tester","revert");
    const restored=(await tx(db=>rows<any>(db,"SELECT * FROM facilities WHERE facility_id='a'")))[0];
    assert.equal(restored.normalized_address,"기존정규주소");assert.equal(restored.region_sido,"서울특별시");assert.equal(restored.site_address_verbatim,false);
    await tx(async db=>{await markReviewedWrite(db);await db.run("UPDATE facilities SET business_registration_no='124-81-00998' WHERE facility_id='a'");});
    r=await reviewCandidates(tx,[brn.candidate_id],"tester","revert");assert.equal(r.results[0].status,"stale_conflict");
    // 후보 생성 뒤 다른 편집자가 수정하면 사용자 값을 보존한다.
    const ingest=(await tx(db=>rows<any>(db,"SELECT candidate_id FROM facility_enrichment_candidates WHERE source='ingestion'")))[0].candidate_id;
    r=await reviewCandidates(tx,[ingest],"tester","apply");assert.equal(r.results[0].status,"stale_conflict");
    await assert.rejects(()=>tx(db=>db.run("INSERT INTO facility_enrichment_candidates(candidate_id,facility_id,field,value,source,evidence,snapshot,match_level) VALUES('forbidden','a','representative_name','금지','bizno','{}','{}','review')")));
    // 등록증 원본은 그대로, 마스터에만 반영한다.
    await tx(async db=>{await markReviewedWrite(db);await db.run("UPDATE facilities SET corporate_registration_no='110111-0006422' WHERE facility_id='a'");});
    await tx(db=>db.run("UPDATE facilities SET corporate_registration_no='123456-1234567',business_certificate_corporate_registration_no='123456-1234567' WHERE facility_id='a'"));
    const corp=(await tx(db=>rows<any>(db,"SELECT * FROM facilities WHERE facility_id='a'")))[0];assert.equal(corp.corporate_registration_no,"110111-0006422");assert.equal(corp.business_certificate_corporate_registration_no,"123456-1234567");
    const corpConflict=(await tx(db=>rows<any>(db,"SELECT candidate_id FROM facility_enrichment_candidates WHERE field='corporate_registration_no' AND source='ingestion'")))[0];
    r=await reviewCandidates(tx,[corpConflict.candidate_id],"tester","apply");assert.equal(r.results[0].status,"applied","같은 등록증 업로드가 바꾼 증빙 컬럼 때문에 즉시 stale이 되지 않는다");
    // 주소 자체가 같아도 파생 지역값의 재수집 덮어쓰기를 막는다.
    await tx(db=>db.run("UPDATE facilities SET normalized_address='오래된 파생값',region_sido='잘못된지역' WHERE facility_id='a'"));
    assert.equal((await tx(db=>rows<any>(db,"SELECT normalized_address FROM facilities WHERE facility_id='a'")))[0].normalized_address,"기존정규주소");
    // 한 정보원 실패가 다른 소스의 저장을 막지 않고, 재개·재전달 시 성공 조회를 반복하지 않는다.
    const job=await tx(db=>createRun(db,"tester","enrich",{sources:["naver","fsc"]}));
    const workerDb:Database={run:(sql,params)=>tx(t=>t.run(sql,params)),exec:(sql,params)=>tx(t=>t.exec(sql,params))};
    let naverCalls=0;let fscCalls=0;
    const providers={naver:async()=>{naverCalls++;return {status:"success" as const,profiles:[]};},fsc:async()=>{fscCalls++;return {status:"timeout" as const,profiles:[]};}};
    await Promise.all([processQualityRun(workerDb,tx,job,providers),processQualityRun(workerDb,tx,job,providers)]);
    assert.equal(naverCalls,1);assert.equal(fscCalls,1);
    assert.equal((await tx(db=>rows<any>(db,"SELECT status FROM facility_quality_runs WHERE run_id=$1",[job])))[0].status,"needs_attention");
    await tx(async db=>{await db.run("UPDATE facility_quality_runs SET status='queued' WHERE run_id=$1",[job]);await db.run("UPDATE facility_quality_items SET status='pending' WHERE run_id=$1",[job]);});
    await processQualityRun(workerDb,tx,job,{...providers,fsc:async()=>{fscCalls++;return {status:"not_found",profiles:[]};}});
    await processQualityRun(workerDb,tx,job,providers);
    assert.equal(naverCalls,1,"성공 소스 재조회 없음");assert.equal(fscCalls,2,"실패 소스만 재시도");
    assert.equal((await tx(db=>rows<any>(db,"SELECT status FROM facility_quality_runs WHERE run_id=$1",[job])))[0].status,"completed");
  } finally {await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();}
});
