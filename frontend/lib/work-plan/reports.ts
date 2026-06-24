import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeReport } from "@/lib/work-plan/normalize";

export type WorkPlanStatus = "draft" | "submitted" | "reviewed" | "finalized";

export interface WorkPlanTemplateRow {
  templateId: string;
  templateName: string;
  unitType: string;
  schemaJson: Record<string, unknown> | null;
  displayOrder: number;
}

export interface WorkPlanItemInput {
  itemId?: string;
  displayOrder: number;
  category?: string | null;
  subjectKind?: string;
  contractId?: string | null;
  facilityId?: string | null;
  subjectLabel?: string | null;
  progressText?: string | null;
  planText?: string | null;
  statusText?: string | null;
  managerEmployeeId?: string | null;
  primaryEmployeeId?: string | null;
  secondaryEmployeeId?: string | null;
  remarks?: string | null;
}

export interface WorkPlanItemRow extends Required<Omit<WorkPlanItemInput, "itemId">> {
  itemId: string;
}

export interface WorkPlanReportInput {
  reportId?: string;
  deptId: string;
  templateId?: string | null;
  reportPeriod?: string;
  periodStart: string;
  periodEnd: string;
  reportDate?: string | null;
  title?: string | null;
  status?: WorkPlanStatus;
  reportKind?: string;
  items: WorkPlanItemInput[];
}

export interface WorkPlanReportListRow {
  reportId: string;
  deptId: string;
  deptName: string;
  templateId: string | null;
  templateName: string | null;
  unitType: string | null;
  reportPeriod: string;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  status: WorkPlanStatus;
  title: string | null;
  itemCount: number;
  updatedAt: string;
}

export interface WorkPlanReportDetail extends Omit<WorkPlanReportListRow, "itemCount"> {
  authorUserId: string | null;
  mergeLockedAt: string | null;
  reportKind: string;
  items: WorkPlanItemRow[];
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function str(value: unknown): string | null {
  return value != null ? String(value) : null;
}

export async function listWorkPlanTemplates(): Promise<WorkPlanTemplateRow[]> {
  const db = await getDb();
  const result = await db.exec(
    "SELECT template_id, template_name, unit_type, schema_json, display_order FROM work_plan_templates WHERE is_active = 1 ORDER BY display_order ASC, template_name ASC"
  );
  return rowsToObjects(result).map((row) => ({
    templateId: String(row.template_id ?? ""),
    templateName: String(row.template_name ?? ""),
    unitType: String(row.unit_type ?? "service"),
    schemaJson: (row.schema_json as Record<string, unknown> | null) ?? null,
    displayOrder: Number(row.display_order ?? 100),
  }));
}

export async function listWorkPlanReports(filter: {
  deptId?: string | null;
  status?: string | null;
}): Promise<WorkPlanReportListRow[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.deptId) {
    params.push(filter.deptId);
    where.push(`r.dept_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`r.status = $${params.length}`);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await db.exec(
    `SELECT r.report_id, r.dept_id, d.dept_name, r.template_id, t.template_name, t.unit_type,
            r.report_period, r.period_start, r.period_end, r.report_date, r.status, r.title,
            r.updated_at,
            (SELECT COUNT(*) FROM work_plan_items i WHERE i.report_id = r.report_id) AS item_count
       FROM work_plan_reports r
       JOIN departments d ON d.dept_id = r.dept_id
       LEFT JOIN work_plan_templates t ON t.template_id = r.template_id
       ${whereClause}
      ORDER BY r.period_start DESC, d.display_order ASC, r.updated_at DESC`,
    params
  );
  return rowsToObjects(result).map((row) => ({
    reportId: String(row.report_id ?? ""),
    deptId: String(row.dept_id ?? ""),
    deptName: String(row.dept_name ?? ""),
    templateId: str(row.template_id),
    templateName: str(row.template_name),
    unitType: str(row.unit_type),
    reportPeriod: String(row.report_period ?? "weekly"),
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: str(row.report_date),
    status: (String(row.status ?? "draft") as WorkPlanStatus),
    title: str(row.title),
    itemCount: Number(row.item_count ?? 0),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

function mapItem(row: Record<string, unknown>): WorkPlanItemRow {
  return {
    itemId: String(row.item_id ?? ""),
    displayOrder: Number(row.display_order ?? 100),
    category: str(row.category),
    subjectKind: String(row.subject_kind ?? "free"),
    contractId: str(row.contract_id),
    facilityId: str(row.facility_id),
    subjectLabel: str(row.subject_label),
    progressText: str(row.progress_text),
    planText: str(row.plan_text),
    statusText: str(row.status_text),
    managerEmployeeId: str(row.manager_employee_id),
    primaryEmployeeId: str(row.primary_employee_id),
    secondaryEmployeeId: str(row.secondary_employee_id),
    remarks: str(row.remarks),
  };
}

export async function getWorkPlanReport(reportId: string): Promise<WorkPlanReportDetail | null> {
  const db = await getDb();
  const reportResult = await db.exec(
    `SELECT r.report_id, r.dept_id, d.dept_name, r.template_id, t.template_name, t.unit_type,
            r.report_period, r.period_start, r.period_end, r.report_date, r.status, r.title,
            r.author_user_id, r.merge_locked_at, r.report_kind, r.updated_at
       FROM work_plan_reports r
       JOIN departments d ON d.dept_id = r.dept_id
       LEFT JOIN work_plan_templates t ON t.template_id = r.template_id
      WHERE r.report_id = $1
      LIMIT 1`,
    [reportId]
  );
  const reportRows = rowsToObjects(reportResult);
  if (!reportRows.length) return null;
  const row = reportRows[0];

  const itemsResult = await db.exec(
    `SELECT item_id, display_order, category, subject_kind, contract_id, facility_id, subject_label,
            progress_text, plan_text, status_text, manager_employee_id, primary_employee_id,
            secondary_employee_id, remarks
       FROM work_plan_items
      WHERE report_id = $1
      ORDER BY display_order ASC`,
    [reportId]
  );

  return {
    reportId: String(row.report_id ?? ""),
    deptId: String(row.dept_id ?? ""),
    deptName: String(row.dept_name ?? ""),
    templateId: str(row.template_id),
    templateName: str(row.template_name),
    unitType: str(row.unit_type),
    reportPeriod: String(row.report_period ?? "weekly"),
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: str(row.report_date),
    status: (String(row.status ?? "draft") as WorkPlanStatus),
    title: str(row.title),
    authorUserId: str(row.author_user_id),
    mergeLockedAt: str(row.merge_locked_at),
    reportKind: String(row.report_kind ?? "dept_consolidated"),
    updatedAt: String(row.updated_at ?? ""),
    items: rowsToObjects(itemsResult).map(mapItem),
  };
}

/**
 * 보고서 + 항목을 한 번에 저장한다. reportId 미지정 시 신규 생성.
 * 항목은 전체 교체(delete + insert) 방식 — PR-1 단순 작성/수정 기준.
 */
export async function saveWorkPlanReport(
  actorUserId: string,
  input: WorkPlanReportInput
): Promise<string> {
  if (!input.deptId) throw new Error("부서를 선택하세요.");
  if (!input.periodStart || !input.periodEnd) throw new Error("보고 기간을 입력하세요.");

  const reportId = input.reportId?.trim() || id("wpr");
  const isNew = !input.reportId;
  const now = new Date().toISOString();
  const status: WorkPlanStatus = input.status ?? "draft";

  await withDbWrite(async (db) => {
    if (isNew) {
      await db.run(
        `INSERT INTO work_plan_reports
           (report_id, dept_id, template_id, report_period, period_start, period_end, report_date,
            meeting_type, report_kind, status, title, author_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'weekly', $8, $9, $10, $11, $12, $12)`,
        [
          reportId,
          input.deptId,
          input.templateId || null,
          input.reportPeriod || "weekly",
          input.periodStart,
          input.periodEnd,
          input.reportDate || null,
          input.reportKind || "dept_consolidated",
          status,
          input.title || null,
          actorUserId,
          now,
        ]
      );
    } else {
      await db.run(
        `UPDATE work_plan_reports SET
           dept_id = $2, template_id = $3, report_period = $4, period_start = $5, period_end = $6,
           report_date = $7, status = $8, title = $9, updated_at = $10
         WHERE report_id = $1`,
        [
          reportId,
          input.deptId,
          input.templateId || null,
          input.reportPeriod || "weekly",
          input.periodStart,
          input.periodEnd,
          input.reportDate || null,
          status,
          input.title || null,
          now,
        ]
      );
      await db.run("DELETE FROM work_plan_items WHERE report_id = $1", [reportId]);
    }

    for (const [index, item] of input.items.entries()) {
      await db.run(
        `INSERT INTO work_plan_items
           (item_id, report_id, display_order, category, subject_kind, contract_id, facility_id,
            subject_label, progress_text, plan_text, status_text, manager_employee_id,
            primary_employee_id, secondary_employee_id, remarks, item_status, author_user_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16, $17, $17)`,
        [
          item.itemId?.trim() || id("wpi"),
          reportId,
          item.displayOrder ?? (index + 1) * 10,
          item.category || null,
          item.subjectKind || "free",
          item.contractId || null,
          item.facilityId || null,
          item.subjectLabel || null,
          item.progressText || null,
          item.planText || null,
          item.statusText || null,
          item.managerEmployeeId || null,
          item.primaryEmployeeId || null,
          item.secondaryEmployeeId || null,
          item.remarks || null,
          actorUserId,
          now,
        ]
      );
    }
  });

  // 제출 시 정규화 잡: 추진경과 로그 + 수행인력 자동 집계 (멱등).
  if (status === "submitted") {
    await normalizeReport(reportId);
  }

  return reportId;
}

export async function deleteWorkPlanReport(reportId: string): Promise<void> {
  if (!reportId) throw new Error("reportId가 필요합니다.");
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM work_plan_reports WHERE report_id = $1", [reportId]);
  });
}
