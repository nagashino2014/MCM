/** 배포 검증: DB 구조와 브라우저 기동만 확인한다. 업체 외부 조회·마스터 수정 없음. */
import { chromium } from "playwright";
import { connectQualityDb } from "../lib/facility-quality/postgres";
import { rows } from "../lib/facility-quality/store";
async function main() {
  const { tx, close } = connectQualityDb();
  try {
    await tx(async db => {
      await db.run("SET TRANSACTION READ ONLY");
      const tables = await rows(db, "SELECT to_regclass('facility_quality_runs')::text runs,to_regclass('facility_enrichment_candidates')::text candidates");
      if (!tables[0]?.runs || !tables[0]?.candidates) throw new Error("마이그레이션 미적용");
    });
    const browser = await chromium.launch({ headless:true });
    try { const page = await browser.newPage(); await page.setContent('<title>quality-health</title>'); if (await page.title() !== 'quality-health') throw new Error('브라우저 점검 실패'); }
    finally { await browser.close(); }
    console.log(JSON.stringify({ database:true, browser:true, dartConfigured:!!process.env.DART_API_KEY, fscConfigured:!!process.env.DATA_GO_KR_API_KEY, masterWrites:0 }));
  } finally { await close(); }
}
main().catch(()=>{console.error('사업장 정비 워커 준비 확인 실패');process.exitCode=1;});
