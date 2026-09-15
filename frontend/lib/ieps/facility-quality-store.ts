import { getDb, withDbWrite } from "@/lib/db";
import { auditItem, rows } from "@scraper/lib/facility-quality/store";
import type { Snapshot } from "@scraper/lib/facility-quality/rules";
export { createRun, runSummary, rows } from "@scraper/lib/facility-quality/store";

/** 외부 조회 없는 진단은 짧은 묶음으로 처리한다. 중단되어도 완료 상태는 남는다. */
export async function processAuditRun(runId: string) {
  const db = await getDb();
  const acquired = await rows(db, "UPDATE facility_quality_runs SET status='running',lease_until=now()+interval '2 minutes' WHERE run_id=$1 AND mode='audit' AND (lease_until IS NULL OR lease_until<now()) AND status<>'completed' RETURNING run_id", [runId]);
  if (!acquired.length) return;
  try {
    while (true) {
      const items = await rows<{ snapshot: Snapshot }>(db, "SELECT snapshot FROM facility_quality_items WHERE run_id=$1 AND status='pending' ORDER BY facility_id LIMIT 100", [runId]);
      if (!items.length) break;
      await withDbWrite(async t => {
        for (const { snapshot } of items) {
          await auditItem(t, runId, snapshot);
          await t.run("UPDATE facility_quality_items SET status='completed',attempts=attempts+1,updated_at=now() WHERE run_id=$1 AND facility_id=$2", [runId, snapshot.facility_id]);
        }
        await t.run("UPDATE facility_quality_runs SET lease_until=now()+interval '2 minutes',updated_at=now() WHERE run_id=$1", [runId]);
      });
    }
    await db.run("UPDATE facility_quality_runs SET status='completed',lease_until=NULL,updated_at=now() WHERE run_id=$1", [runId]);
  } catch (e) {
    await db.run("UPDATE facility_quality_runs SET status='interrupted',lease_until=NULL,error='진단 중단. 미완료 항목 재개 가능' WHERE run_id=$1", [runId]);
    throw e;
  }
}
