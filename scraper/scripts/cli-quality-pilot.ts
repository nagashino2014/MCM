/** 읽기 전용 진단 산출물을 로컬 DB에 복제해 수집·후보 저장을 검증한다. 운영 DB 사용 금지. */
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import path from "node:path";
import { connectQualityDb } from "../lib/facility-quality/postgres";
import { createRun, rows, runSummary } from "../lib/facility-quality/store";
import { processQualityRun } from "../lib/facility-enrichment/runner";
async function main() {
  if(!["localhost","127.0.0.1"].includes(process.env.PGHOST||"")||process.env.PGDATABASE!=="mcm_quality_pilot"||process.env.DATABASE_URL)throw new Error("로컬 mcm_quality_pilot DB만 허용");
  const input=process.argv.find(a=>a.startsWith("--input="))?.slice(8);if(!input)throw new Error("--input 필요");
  const admin=new Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,database:"postgres",ssl:false});
  try{if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='mcm_quality_pilot'")).rows.length)await admin.query("CREATE DATABASE mcm_quality_pilot");}finally{await admin.end();}
  const {db,tx,close}=connectQualityDb();
  try{
    await tx(async t=>{
      await t.run(`CREATE TABLE IF NOT EXISTS facilities(facility_id text PRIMARY KEY,company_name text,business_registration_no text,site_business_registration_no text,
        representative_name text,phone_number text,corporate_registration_no text,business_certificate_corporate_registration_no text,
        site_address text,site_address_verbatim boolean DEFAULT false,normalized_address text,region_sido text,region_sigungu text,
        additional_site_addresses text,source text,deleted_at text,updated_at text);
        CREATE TABLE IF NOT EXISTS facility_history_events(facility_id text,event_type text,event_types text);
        CREATE TABLE IF NOT EXISTS audit_log(actor_user_id text,action text,target_table text,target_id text,before_json jsonb,after_json jsonb,created_at text);`);
      await t.run(readFileSync("../infra/aws/220_facility_quality.sql","utf8"));
      const items=JSON.parse(readFileSync(input,"utf8"));
      await t.run("INSERT INTO facilities SELECT * FROM jsonb_populate_recordset(NULL::facilities,$1::jsonb) ON CONFLICT(facility_id) DO NOTHING",[JSON.stringify(items.map((it:any)=>it.snapshot))]);
      for(const it of items.filter((it:any)=>it.snapshot.is_closed))await t.run("INSERT INTO facility_history_events SELECT $1,'closure','[\"closure\"]' WHERE NOT EXISTS(SELECT 1 FROM facility_history_events WHERE facility_id=$1)",[it.snapshot.facility_id]);
    });
    const runId=await tx(t=>createRun(t,"local-pilot","enrich",{sources:["naver","dart","fsc","bizno"],limit:50}));
    console.log(`pilot run ${runId}`);
    const targets=await rows(db,"SELECT snapshot->>'company_name' AS company_name,snapshot->>'site_address' AS address FROM facility_quality_items WHERE run_id=$1 ORDER BY facility_id",[runId]);
    writeFileSync(path.join(path.dirname(input),"pilot-targets.md"),`# 외부 조회 표본 50개\n\n작업 ID: ${runId}\n\n네이버 기업정보 카드·비즈노 공개 검색·기존 DART/금융위 기업기본정보 API에 사업장명을 검색어로 사용합니다. 후보만 저장하고 마스터를 변경하지 않습니다.\n\n`+targets.map((t,i)=>`${i+1}. ${t.company_name} — ${t.address||"주소 미입력"}`).join("\n"));
    if(process.argv.includes("--prepare-only"))return;
    await processQualityRun(db,tx,runId);
    const summary=await runSummary(db,runId);
    const outcomes=await rows(db,`SELECT o.key AS source,o.value->>'status' AS status,count(*)::int AS count FROM facility_quality_items i CROSS JOIN LATERAL jsonb_each(i.outcomes) o WHERE run_id=$1 GROUP BY o.key,o.value->>'status'`,[runId]);
    const candidates=await rows(db,"SELECT source,field,match_level,count(*)::int AS count FROM facility_enrichment_candidates WHERE run_id=$1 GROUP BY source,field,match_level",[runId]);
    const report={...summary,outcomes,candidates};writeFileSync(path.join(path.dirname(input),"pilot-summary.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally{await close();}
}
main().catch(e=>{console.error("로컬 파일럿 실패:",e instanceof Error?e.message:"unknown");process.exitCode=1;});
