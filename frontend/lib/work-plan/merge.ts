import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { summarizeProgress } from "@/lib/ai/summarize";

export interface StaffInputItem {
  itemId: string;
  reportId: string;
  authorName: string | null;
  contractId: string | null;
  subjectKind: string | null; // 'contract' | 'task'
  subjectLabel: string | null;
  statusText: string | null;
  progressText: string | null;
  planText: string | null;
  primaryName: string | null;
}

export interface MergeInput {
  deptId: string;
  periodStart: string;
  periodEnd: string;
  reportDate?: string | null;
  templateId?: string | null;
  title?: string | null;
  sourceItemIds: string[];
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export interface ConsolidatedReportRow {
  reportId: string;
  deptId: string;
  deptName: string | null;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  itemCount: number;
  createdAt: string;
}

/** 부서 통합 보고(dept_consolidated) 목록 — 임원 검토용. */
export async function listConsolidatedReports(deptId: string): Promise<ConsolidatedReportRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT r.report_id, r.dept_id, d.dept_name, r.period_start, r.period_end, r.report_date, r.created_at,
            (SELECT count(*)::int FROM work_plan_items i WHERE i.report_id = r.report_id) AS item_count
       FROM work_plan_reports r
       LEFT JOIN departments d ON d.dept_id = r.dept_id
      WHERE r.dept_id = $1 AND r.report_kind = 'dept_consolidated'
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC`,
    [deptId]
  );
  return rowsToObjects(result).map((row) => ({
    reportId: String(row.report_id ?? ""),
    deptId: String(row.dept_id ?? ""),
    deptName: row.dept_name != null ? String(row.dept_name) : null,
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: row.report_date != null ? String(row.report_date) : null,
    itemCount: Number(row.item_count ?? 0),
    createdAt: String(row.created_at ?? ""),
  }));
}

/** 부서·기간의 1차 보고(staff_input) 미머지 항목 목록. */
export async function listStaffInputItems(
  deptId: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffInputItem[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT i.item_id, i.report_id, u.name AS author_name, i.contract_id, i.subject_kind, i.subject_label,
            i.status_text, i.progress_text, i.plan_text, pe.name AS primary_name
       FROM work_plan_items i
       JOIN work_plan_reports r ON r.report_id = i.report_id
       LEFT JOIN users u ON u.user_id = r.author_user_id
       LEFT JOIN employee_profiles pe ON pe.employee_id = i.primary_employee_id
      WHERE r.dept_id = $1 AND r.report_kind = 'staff_input'
        AND r.period_start = $2 AND r.period_end = $3
        AND i.item_status <> 'merged'
      ORDER BY u.name ASC, i.subject_label ASC`,
    [deptId, periodStart, periodEnd]
  );
  return rowsToObjects(result).map((row) => ({
    itemId: String(row.item_id ?? ""),
    reportId: String(row.report_id ?? ""),
    authorName: row.author_name != null ? String(row.author_name) : null,
    contractId: row.contract_id != null ? String(row.contract_id) : null,
    subjectKind: row.subject_kind != null ? String(row.subject_kind) : null,
    subjectLabel: row.subject_label != null ? String(row.subject_label) : null,
    statusText: row.status_text != null ? String(row.status_text) : null,
    progressText: row.progress_text != null ? String(row.progress_text) : null,
    planText: row.plan_text != null ? String(row.plan_text) : null,
    primaryName: row.primary_name != null ? String(row.primary_name) : null,
  }));
}

/**
 * 선택한 staff_input 항목들을 새 dept_consolidated 보고서로 복제·취합한다.
 * - 새 통합 보고서 생성(submitted + merge_locked_at)
 * - 각 원 항목을 복제 INSERT (source_item_id 로 원 항목 추적, item_status='merged')
 * - 원 항목은 item_status='merged' 로 갱신(중복 머지 방지)
 */
export async function createConsolidated(actorUserId: string, input: MergeInput): Promise<string> {
  const reportId = id("wpr");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_plan_reports
         (report_id, dept_id, template_id, report_period, period_start, period_end, report_date,
          meeting_type, report_kind, status, title, author_user_id, merge_locked_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'weekly', $4, $5, $6, 'weekly', 'dept_consolidated', 'submitted', $7, $8, $9, $9, $9)`,
      [
        reportId,
        input.deptId,
        input.templateId || null,
        input.periodStart,
        input.periodEnd,
        input.reportDate || null,
        input.title || null,
        actorUserId,
        now,
      ]
    );

    let order = 10;
    for (const sourceItemId of input.sourceItemIds) {
      await db.run(
        `INSERT INTO work_plan_items
           (item_id, report_id, display_order, category, subject_kind, contract_id, facility_id, subject_label,
            progress_text, plan_text, status_text, progress_stage, progress_pct, key_dates_json,
            manager_employee_id, primary_employee_id, secondary_employee_id, participants_json, milestones_json,
            remarks, source_item_id, item_status, author_user_id, created_at, updated_at)
         SELECT $1, $2, $3, category, subject_kind, contract_id, facility_id, subject_label,
                progress_text, plan_text, status_text, progress_stage, progress_pct, key_dates_json,
                manager_employee_id, primary_employee_id, secondary_employee_id, participants_json, milestones_json,
                remarks, item_id, 'merged', $4, $5, $5
           FROM work_plan_items WHERE item_id = $6`,
        [id("wpi"), reportId, order, actorUserId, now, sourceItemId]
      );
      await db.run("UPDATE work_plan_items SET item_status = 'merged', updated_at = $1 WHERE item_id = $2", [now, sourceItemId]);
      order += 10;
    }
  });
  return reportId;
}

/**
 * 부서장이 확인(confirmed)한 보고들을 묶어 부서 통합 보고를 생성한다.
 * - 대상 보고의 work_plan_item 들을 source 로 createConsolidated 재사용.
 * - 처리한 보고는 review_status='merged' 로 갱신(머징 대상 목록에서 제외).
 */
export async function mergeConfirmedReports(
  actorUserId: string,
  deptId: string,
  reportIds: string[]
): Promise<string> {
  if (!reportIds.length) throw new Error("통합할 보고를 선택하세요.");
  const db = await getDb();
  const placeholders = reportIds.map((_, i) => `$${i + 1}`).join(", ");
  const itemsResult = await db.exec(
    `SELECT i.item_id FROM work_plan_items i WHERE i.report_id IN (${placeholders}) ORDER BY i.created_at ASC`,
    reportIds
  );
  const sourceItemIds = rowsToObjects(itemsResult).map((r) => String(r.item_id));

  const rangeResult = await db.exec(
    `SELECT min(period_start) AS ps, max(period_end) AS pe FROM work_plan_reports WHERE report_id IN (${placeholders})`,
    reportIds
  );
  const range = rowsToObjects(rangeResult)[0] ?? {};

  const reportId = await createConsolidated(actorUserId, {
    deptId,
    periodStart: String(range.ps ?? ""),
    periodEnd: String(range.pe ?? ""),
    reportDate: String(range.pe ?? ""),
    sourceItemIds,
  });

  // 대상 보고별 추진내역 AI 요약 생성 → summary_text 저장(임원 카드 표기용).
  const now = new Date().toISOString();
  for (const rid of reportIds) {
    const itr = await db.exec(
      "SELECT progress_text, plan_text FROM work_plan_items WHERE report_id = $1 ORDER BY display_order ASC LIMIT 1",
      [rid]
    );
    const it = rowsToObjects(itr)[0] ?? {};
    const summary = await summarizeProgress(
      it.progress_text != null ? String(it.progress_text) : null,
      it.plan_text != null ? String(it.plan_text) : null
    );
    await withDbWrite(async (wdb) => {
      await wdb.run("UPDATE work_plan_reports SET summary_text = $1, updated_at = $2 WHERE report_id = $3", [summary || null, now, rid]);
    });
  }

  const updPlaceholders = reportIds.map((_, i) => `$${i + 2}`).join(", "); // $1 = now
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `UPDATE work_plan_reports SET review_status = 'merged', updated_at = $1 WHERE report_id IN (${updPlaceholders})`,
      [now, ...reportIds]
    );
  });
  return reportId;
}
