import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { applyPresetToTask } from "@/lib/work-plan/task-stages";
import type { ServiceReportListRow } from "@/lib/work-plan/workspace";

export interface TaskCategoryRow {
  categoryId: string;
  categoryName: string;
  presetId: string | null;
  displayOrder: number;
}

export interface MyTaskRow {
  taskId: string;
  taskName: string;
  categoryId: string | null;
  categoryName: string | null;
  startedAt: string | null;
  status: string;
  lastStage: string | null;
  lastPct: number | null;
  stageIndex: number | null; // 현재 공정의 순서(1-based)
  stageTotal: number | null; // 전체 공정 수
  lastReportDate: string | null; // 마지막 제출 보고의 회의일자(없으면 보고기간 종료)
  lastReportSeq: number | null;  // 마지막 보고 회차(= 제출 보고 수)
  completed: boolean; // 모든 공정 단계 완료 여부
  workerNames: string[]; // 실무자 성명(관리자 제외, 역할순)
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function str(value: unknown): string | null {
  return value != null ? String(value) : null;
}

export async function listTaskCategories(): Promise<TaskCategoryRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT category_id, category_name, preset_id, display_order
       FROM work_task_categories
      WHERE is_active = 1
      ORDER BY display_order ASC, category_name ASC`
  );
  return rowsToObjects(result).map((row) => ({
    categoryId: String(row.category_id ?? ""),
    categoryName: String(row.category_name ?? ""),
    presetId: str(row.preset_id),
    displayOrder: Number(row.display_order ?? 100),
  }));
}

export async function saveTaskCategory(input: {
  categoryId?: string;
  categoryName: string;
  presetId?: string | null;
  displayOrder?: number | null;
}): Promise<string> {
  const categoryId = input.categoryId?.trim() || id("wtc");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_task_categories (category_id, category_name, preset_id, is_active, display_order, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $5)
       ON CONFLICT (category_id) DO UPDATE SET
         category_name = EXCLUDED.category_name,
         preset_id = EXCLUDED.preset_id,
         display_order = EXCLUDED.display_order,
         updated_at = EXCLUDED.updated_at`,
      [categoryId, input.categoryName.trim() || "새 업무분류", input.presetId || null, input.displayOrder ?? 100, now]
    );
  });
  return categoryId;
}

/** Task 생성. 분류에 프리셋이 있으면 공정표를 자동 적용한다. */
export async function createTask(
  actorUserId: string,
  input: { taskName: string; categoryId?: string | null; startedAt?: string | null; owningDeptId?: string | null }
): Promise<string> {
  if (!input.taskName?.trim()) throw new Error("업무명을 입력하세요.");
  const taskId = id("wt");
  const now = new Date().toISOString();

  // 수행부서 미지정 시 작성자 소속 부서로 기본 설정(부서장 감독/머지 집계 키).
  let owningDeptId = input.owningDeptId || null;
  if (!owningDeptId) {
    const db = await getDb();
    const r = await db.exec("SELECT dept_id FROM employee_profiles WHERE user_id = $1 LIMIT 1", [actorUserId]);
    owningDeptId = str(rowsToObjects(r)[0]?.dept_id);
  }

  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_tasks (task_id, task_name, category_id, started_at, owning_dept_id, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $7)`,
      [taskId, input.taskName.trim(), input.categoryId || null, input.startedAt || null, owningDeptId, actorUserId, now]
    );
  });

  // 분류 프리셋 자동 적용.
  if (input.categoryId) {
    const db = await getDb();
    const r = await db.exec("SELECT preset_id FROM work_task_categories WHERE category_id = $1 LIMIT 1", [input.categoryId]);
    const presetId = str(rowsToObjects(r)[0]?.preset_id);
    if (presetId) await applyPresetToTask(taskId, presetId);
  }
  return taskId;
}

/** Task 완전 삭제: 보고(work_plan_reports) + Task(공정표·수행인력 cascade). */
export async function deleteTask(taskId: string): Promise<void> {
  if (!taskId) throw new Error("taskId가 필요합니다.");
  await withDbWrite(async (db) => {
    // 보고는 task_id ON DELETE SET NULL 이라 고아가 되므로 먼저 명시 삭제.
    await db.run("DELETE FROM work_plan_reports WHERE task_id = $1", [taskId]);
    await db.run("DELETE FROM work_tasks WHERE task_id = $1", [taskId]);
  });
}

export async function getTask(taskId: string): Promise<{
  taskId: string;
  taskName: string;
  categoryId: string | null;
  categoryName: string | null;
  startedAt: string | null;
  owningDeptId: string | null;
  status: string;
} | null> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT t.task_id, t.task_name, t.category_id, c.category_name, t.started_at, t.owning_dept_id, t.status
       FROM work_tasks t
       LEFT JOIN work_task_categories c ON c.category_id = t.category_id
      WHERE t.task_id = $1
      LIMIT 1`,
    [taskId]
  );
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    taskId: String(row.task_id ?? ""),
    taskName: String(row.task_name ?? ""),
    categoryId: str(row.category_id),
    categoryName: str(row.category_name),
    startedAt: str(row.started_at),
    owningDeptId: str(row.owning_dept_id),
    status: String(row.status ?? "active"),
  };
}

// Task 카드 공통 SELECT/LATERAL/GROUP (listMyTasks·listDeptTasks 공유).
const TASK_CARD_COLS = `t.task_id, t.task_name, t.category_id, c.category_name, t.started_at, t.status,
        cur.stage_name AS last_stage, cur.progress_pct AS last_pct,
        cnt.idx AS stage_index, cnt.total AS stage_total, cnt.done AS stage_done,
        lr.rdate AS last_report_date, rc.seq AS last_report_seq, wk.names AS worker_names`;

const TASK_CARD_LATERALS = `
   LEFT JOIN work_task_categories c ON c.category_id = t.category_id
   LEFT JOIN LATERAL (
     SELECT s.stage_name, s.progress_pct, s.stage_order
       FROM work_task_process_stages s
      WHERE s.task_id = t.task_id AND s.status <> 'pending'
      ORDER BY (s.status = 'in_progress') DESC, s.stage_order DESC
      LIMIT 1
   ) cur ON true
   LEFT JOIN LATERAL (
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE s2.stage_order <= cur.stage_order)::int AS idx,
            count(*) FILTER (WHERE s2.status = 'done')::int AS done
       FROM work_task_process_stages s2 WHERE s2.task_id = t.task_id
   ) cnt ON true
   LEFT JOIN LATERAL (
     SELECT COALESCE(NULLIF(r.report_date, ''), r.period_end) AS rdate
       FROM work_plan_reports r
      WHERE r.task_id = t.task_id AND r.status = 'submitted'
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC
      LIMIT 1
   ) lr ON true
   LEFT JOIN LATERAL (
     SELECT count(*)::int AS seq FROM work_plan_reports r3 WHERE r3.task_id = t.task_id AND r3.status = 'submitted'
   ) rc ON true
   LEFT JOIN LATERAL (
     SELECT array_agg(e2.name ORDER BY wtp2.role_label) AS names
       FROM work_task_participants wtp2 JOIN employee_profiles e2 ON e2.employee_id = wtp2.employee_id
      WHERE wtp2.task_id = t.task_id AND wtp2.role_label NOT ILIKE '%관리자%'
   ) wk ON true`;

const TASK_CARD_GROUP = `GROUP BY t.task_id, t.task_name, t.category_id, c.category_name, t.started_at, t.status,
           cur.stage_name, cur.progress_pct, cnt.idx, cnt.total, cnt.done, lr.rdate, rc.seq, wk.names`;

const TASK_CARD_ORDER = `ORDER BY t.started_at DESC NULLS LAST, t.task_name ASC`;

function mapTaskRow(row: Record<string, unknown>): MyTaskRow {
  return {
    taskId: String(row.task_id ?? ""),
    taskName: String(row.task_name ?? ""),
    categoryId: str(row.category_id),
    categoryName: str(row.category_name),
    startedAt: str(row.started_at),
    status: String(row.status ?? "active"),
    lastStage: str(row.last_stage),
    lastPct: row.last_pct != null ? Number(row.last_pct) : null,
    stageIndex: row.stage_index != null ? Number(row.stage_index) : null,
    stageTotal: row.stage_total != null ? Number(row.stage_total) : null,
    lastReportDate: str(row.last_report_date),
    lastReportSeq: row.last_report_seq != null ? Number(row.last_report_seq) : null,
    completed: Number(row.stage_total ?? 0) > 0 && Number(row.stage_done ?? 0) === Number(row.stage_total ?? 0),
    workerNames: Array.isArray(row.worker_names) ? (row.worker_names as unknown[]).map((n) => String(n)) : [],
  };
}

/**
 * 진행 Task = 로그인 사용자가 수행인력으로 매핑된 Task + 현재 공정단계/진행률.
 * 현재 단계 = 누적 공정표(work_task_process_stages)에서 진행중(최상위) → 없으면 완료(최상위).
 */
export async function listMyTasks(userId: string): Promise<MyTaskRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT ${TASK_CARD_COLS}
       FROM work_task_participants wtp
       JOIN employee_profiles e ON e.employee_id = wtp.employee_id
       JOIN work_tasks t ON t.task_id = wtp.task_id
       ${TASK_CARD_LATERALS}
      WHERE e.user_id = $1
      ${TASK_CARD_GROUP}
      ${TASK_CARD_ORDER}`,
    [userId]
  );
  return rowsToObjects(result).map(mapTaskRow);
}

/** 부서 감독: 한 부서(owning_dept_id)의 모든 Task 카드. listMyTasks 와 동일 컬럼. */
export async function listDeptTasks(deptId: string): Promise<MyTaskRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT ${TASK_CARD_COLS}
       FROM work_tasks t
       ${TASK_CARD_LATERALS}
      WHERE t.owning_dept_id = $1 AND t.status <> 'archived'
      ${TASK_CARD_GROUP}
      ${TASK_CARD_ORDER}`,
    [deptId]
  );
  return rowsToObjects(result).map(mapTaskRow);
}

/** 보고 Log = 특정 Task의 보고 목록(최신순). */
export async function listTaskReports(taskId: string): Promise<ServiceReportListRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT report_id, task_id, period_start, period_end, report_date, meeting_label, status, title, updated_at
       FROM work_plan_reports
      WHERE task_id = $1
      ORDER BY COALESCE(NULLIF(report_date, ''), period_end) DESC, updated_at DESC`,
    [taskId]
  );
  return rowsToObjects(result).map((row) => ({
    reportId: String(row.report_id ?? ""),
    contractId: null,
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: str(row.report_date),
    meetingLabel: str(row.meeting_label),
    status: String(row.status ?? "draft"),
    title: str(row.title),
    updatedAt: String(row.updated_at ?? ""),
  }));
}
