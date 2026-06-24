import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

const ROLE_BY_SLOT: Array<[string, string]> = [
  ["manager_employee_id", "관리자"],
  ["primary_employee_id", "정"],
  ["secondary_employee_id", "부"],
];

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * 업무보고 제출(submitted) 시 호출되는 정규화 잡.
 * - 계약 연결 항목의 진행내역을 contract_progress_log 에 멱등 적재
 * - 담당자(관리자/정/부)를 service_participants(source='work_plan')로 누적
 *   (이미 수기로 등록된 동일 역할은 participated_to 만 연장)
 */
export async function normalizeReport(reportId: string): Promise<void> {
  const db = await getDb();
  const reportRows = rowsToObjects(
    await db.exec("SELECT period_start, period_end FROM work_plan_reports WHERE report_id = $1", [reportId])
  );
  if (!reportRows.length) return;
  const periodStart = reportRows[0].period_start != null ? String(reportRows[0].period_start) : null;
  const periodEnd = reportRows[0].period_end != null ? String(reportRows[0].period_end) : null;

  const items = rowsToObjects(
    await db.exec(
      `SELECT item_id, contract_id, progress_text, plan_text, status_text,
              manager_employee_id, primary_employee_id, secondary_employee_id
         FROM work_plan_items
        WHERE report_id = $1 AND contract_id IS NOT NULL`,
      [reportId]
    )
  );
  if (!items.length) return;

  const now = new Date().toISOString();
  await withDbWrite(async (tx) => {
    for (const item of items) {
      const contractId = String(item.contract_id);
      const itemId = String(item.item_id);

      await tx.run(
        `INSERT INTO contract_progress_log
           (log_id, contract_id, report_id, item_id, period_start, period_end, progress_text, plan_text, status_text, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (report_id, contract_id) DO UPDATE SET
           item_id = EXCLUDED.item_id,
           progress_text = EXCLUDED.progress_text,
           plan_text = EXCLUDED.plan_text,
           status_text = EXCLUDED.status_text,
           updated_at = EXCLUDED.updated_at`,
        [
          id("cpl"),
          contractId,
          reportId,
          itemId,
          periodStart,
          periodEnd,
          item.progress_text != null ? String(item.progress_text) : null,
          item.plan_text != null ? String(item.plan_text) : null,
          item.status_text != null ? String(item.status_text) : null,
          now,
        ]
      );

      for (const [slot, role] of ROLE_BY_SLOT) {
        const empId = item[slot] != null ? String(item[slot]) : null;
        if (!empId) continue;
        await tx.run(
          `INSERT INTO service_participants
             (participation_id, contract_id, employee_id, role_label, source, source_ref, participated_from, participated_to, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'work_plan', $5, $6, $7, $8, $8)
           ON CONFLICT (contract_id, employee_id, role_label) DO UPDATE SET
             participated_to = EXCLUDED.participated_to,
             source_ref = EXCLUDED.source_ref,
             updated_at = EXCLUDED.updated_at`,
          [id("sp"), contractId, empId, role, itemId, periodStart, periodEnd, now]
        );
      }
    }
  });
}
