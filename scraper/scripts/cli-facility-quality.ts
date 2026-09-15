import { connectQualityDb } from "../lib/facility-quality/postgres";
import { processQualityRun } from "../lib/facility-enrichment/runner";
import { createRun, runSummary } from "../lib/facility-quality/store";
async function main() {
  const { db, tx, close } = connectQualityDb();
  try {
    let id = process.argv.find(a => a.startsWith("--run="))?.slice(6);
    if (!id && process.argv.includes("--audit")) id = await tx(t => createRun(t, "local-audit", "audit", { sources: [] }));
    if (!id) throw new Error("--run=<저장된 작업 ID> 또는 --audit 필요. 외부 후보는 앱에서 범위를 선택해 시작하세요.");
    await processQualityRun(db, tx, id);
    console.log(JSON.stringify(await runSummary(db, id), null, 2));
  } finally { await close(); }
}
main().catch(() => { console.error("사업장 점검 실패. DB 연결·마이그레이션·작업 상태를 확인하세요."); process.exitCode = 1; });
