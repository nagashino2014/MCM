import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectQualityDb } from "../lib/facility-quality/postgres";
import { rows, runSummary } from "../lib/facility-quality/store";
import { audit, FIELDS, formatProposals, RULE_VERSION } from "../lib/facility-quality/rules";
async function main(){
  const dir=process.argv.find(a=>a.startsWith('--output='))?.slice(9);const runId=process.argv.find(a=>a.startsWith('--run='))?.slice(6);
  if(!dir||!runId||process.env.PGDATABASE!=='mcm_quality_pilot'||!['localhost','127.0.0.1'].includes(process.env.PGHOST||'')||process.env.DATABASE_URL)throw new Error('로컬 파일럿 DB와 결과 경로·작업 ID 필요');
  const {db,tx,close}=connectQualityDb();
  try{
    // 파일럿 중 수정한 관련성 규칙을 기존 생성 후보에 재적용한다. 반영 이력은 건드리지 않는다.
    const excluded=await tx(t=>rows(t,`DELETE FROM facility_enrichment_candidates WHERE run_id=$1 AND status='pending' AND source IN('naver','dart','fsc','bizno')
      AND NOT COALESCE((evidence->>'sameName')::boolean,false) AND NOT COALESCE((evidence->>'sameEntity')::boolean,false) AND NOT COALESCE((evidence->>'sameCorporateName')::boolean,false) RETURNING candidate_id`,[runId]));
    const summary=await runSummary(db,runId);
    const outcomes=await rows(db,`SELECT o.key AS source,o.value->>'status' AS status,count(*)::int AS count FROM facility_quality_items i CROSS JOIN LATERAL jsonb_each(i.outcomes) o WHERE run_id=$1 GROUP BY o.key,o.value->>'status' ORDER BY o.key`,[runId]);
    const candidateSummary=await rows(db,'SELECT source,match_level,count(*)::int AS count FROM facility_enrichment_candidates WHERE run_id=$1 GROUP BY source,match_level ORDER BY source,match_level',[runId]);
    const candidates=await rows(db,'SELECT * FROM facility_enrichment_candidates WHERE run_id=$1 ORDER BY source,facility_id,field',[runId]);
    const report={...summary,outcomes,candidateSummary,excludedUnrelated:excluded.length,productionChanges:0};
    writeFileSync(path.join(dir,'pilot-summary.json'),JSON.stringify(report,null,2));writeFileSync(path.join(dir,'pilot-candidates.json'),JSON.stringify(candidates,null,2));
    const old=JSON.parse(readFileSync(path.join(dir,'audit-summary.json'),'utf8'));
    const items=JSON.parse(readFileSync(path.join(dir,'audit-items.json'),'utf8')).map((it:any)=>({...it,diagnosis:audit(it.snapshot),formatCandidates:formatProposals(it.snapshot)}));
    const fields:Record<string,Record<string,number>>={};for(const f of FIELDS){fields[f]={};for(const it of items){const s=it.diagnosis[f].status;fields[f][s]=(fields[f][s]||0)+1;}}
    const auditSummary={...old,ruleVersion:RULE_VERSION,recomputedAt:new Date().toISOString(),facilitiesWithIssues:items.filter((it:any)=>FIELDS.some(f=>!['valid','not_applicable'].includes(it.diagnosis[f].status))).length,formatCandidates:items.reduce((n:number,it:any)=>n+it.formatCandidates.length,0),summary:fields};
    writeFileSync(path.join(dir,'audit-summary-final.json'),JSON.stringify(auditSummary,null,2));
    writeFileSync(path.join(dir,'audit-items-final.json'),JSON.stringify(items,null,2));
    console.log(JSON.stringify({audit:auditSummary,pilot:report},null,2));
  }finally{await close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
