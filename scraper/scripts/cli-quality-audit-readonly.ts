/** 운영 마스터 읽기 전용 진단. 마이그레이션이나 후보 테이블 없이도 실행 가능하다. */
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { audit, FIELDS, formatProposals, RULE_VERSION, type Snapshot } from "../lib/facility-quality/rules";
async function main() {
  const output=process.argv.find(a=>a.startsWith("--output="))?.slice(9);
  if(!output)throw new Error("--output=<결과 폴더> 필요");
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==="disable"?false:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
  const client=await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");await client.query("SET LOCAL statement_timeout='60s'");
    const r=await client.query(`SELECT facility_id,company_name,business_registration_no,site_business_registration_no,representative_name,phone_number,
      corporate_registration_no,business_certificate_corporate_registration_no,site_address,normalized_address,region_sido,region_sigungu,
      site_address_verbatim,additional_site_addresses,source,deleted_at,
      EXISTS(SELECT 1 FROM facility_history_events h WHERE h.facility_id=f.facility_id AND (h.event_type='closure' OR h.event_types LIKE '%"closure"%')) AS is_closed
      FROM facilities f WHERE deleted_at IS NULL ORDER BY facility_id`);
    await client.query("COMMIT");
    const items=(r.rows as Snapshot[]).map(snapshot=>({snapshot,diagnosis:audit(snapshot),formatCandidates:formatProposals(snapshot)}));
    const summary:Record<string,Record<string,number>>={};
    for(const f of FIELDS){summary[f]={};for(const it of items){const s=it.diagnosis[f].status;summary[f][s]=(summary[f][s]||0)+1;}}
    const report={ruleVersion:RULE_VERSION,retrievedAt:new Date().toISOString(),readOnly:true,total:items.length,
      facilitiesWithIssues:items.filter(it=>FIELDS.some(f=>it.diagnosis[f].status!=="valid")).length,
      historical:items.filter(it=>it.snapshot.is_closed).length,formatCandidates:items.reduce((n,it)=>n+it.formatCandidates.length,0),summary};
    mkdirSync(output,{recursive:true});writeFileSync(path.join(output,"audit-summary.json"),JSON.stringify(report,null,2));writeFileSync(path.join(output,"audit-items.json"),JSON.stringify(items,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {client.release();await pool.end();}
}
main().catch(()=>{console.error("읽기 전용 진단 실패. 연결·컬럼 구성을 확인하세요 (접속 비밀정보는 출력하지 않음).");process.exitCode=1;});
