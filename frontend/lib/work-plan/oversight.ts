import { getDb, rowsToObjects } from "@/lib/db";

export interface OversightCard {
  kind: "contract" | "task";
  subjectId: string;          // contractId | taskId (통합 키)
  contractId: string | null;  // 이슈 패널 등 계약 전용 기능용
  taskId: string | null;
  title: string;
  subtitle: string | null;    // 발주처 · 용역분류 | 업무분류
  stageTotal: number;
  stageDone: number;
  currentStage: string | null;
  currentPct: number | null;
  issueOpen: number;
  latestProgress: string | null;
  participantNames: string | null;
}

/**
 * 한 부서(owning_dept_id)의 용역 + Task 진행 현황 카드.
 * 공정 진행/현재 단계, 미해결 이슈 수(용역만), 최근 보고 진행상황, 수행인력을 집계한다.
 */
export async function listOversight(deptId: string): Promise<OversightCard[]> {
  const db = await getDb();

  // 용역(계약) 카드.
  const contractResult = await db.exec(
    `SELECT c.contract_id, c.contract_title, cp.company_name AS counterparty_name, c.service_type,
            (SELECT COUNT(*) FROM contract_process_stages s WHERE s.contract_id = c.contract_id) AS stage_total,
            (SELECT COUNT(*) FROM contract_process_stages s WHERE s.contract_id = c.contract_id AND s.status = 'done') AS stage_done,
            (SELECT s.stage_name FROM contract_process_stages s WHERE s.contract_id = c.contract_id AND s.status = 'in_progress' ORDER BY s.stage_order ASC LIMIT 1) AS current_stage,
            (SELECT s.progress_pct FROM contract_process_stages s WHERE s.contract_id = c.contract_id AND s.status = 'in_progress' ORDER BY s.stage_order ASC LIMIT 1) AS current_pct,
            (SELECT COUNT(*) FROM work_plan_issues i WHERE i.contract_id = c.contract_id AND i.status <> 'resolved') AS issue_open,
            (SELECT wi.progress_text FROM work_plan_items wi WHERE wi.contract_id = c.contract_id AND wi.progress_text IS NOT NULL ORDER BY wi.updated_at DESC LIMIT 1) AS latest_progress,
            (SELECT string_agg(e.name, ', ') FROM service_participants sp JOIN employee_profiles e ON e.employee_id = sp.employee_id WHERE sp.contract_id = c.contract_id) AS participant_names
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
      WHERE c.owning_dept_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.contract_title ASC`,
    [deptId]
  );

  // Task 카드. (이슈는 계약 전용이라 0 고정, 최근 진행상황은 보고→work_plan_items 경유.)
  const taskResult = await db.exec(
    `SELECT t.task_id, t.task_name, wc.category_name,
            (SELECT COUNT(*) FROM work_task_process_stages s WHERE s.task_id = t.task_id) AS stage_total,
            (SELECT COUNT(*) FROM work_task_process_stages s WHERE s.task_id = t.task_id AND s.status = 'done') AS stage_done,
            (SELECT s.stage_name FROM work_task_process_stages s WHERE s.task_id = t.task_id AND s.status = 'in_progress' ORDER BY s.stage_order ASC LIMIT 1) AS current_stage,
            (SELECT s.progress_pct FROM work_task_process_stages s WHERE s.task_id = t.task_id AND s.status = 'in_progress' ORDER BY s.stage_order ASC LIMIT 1) AS current_pct,
            (SELECT wi.progress_text FROM work_plan_items wi JOIN work_plan_reports r ON r.report_id = wi.report_id
              WHERE r.task_id = t.task_id AND wi.progress_text IS NOT NULL ORDER BY wi.updated_at DESC LIMIT 1) AS latest_progress,
            (SELECT string_agg(e.name, ', ') FROM work_task_participants wtp JOIN employee_profiles e ON e.employee_id = wtp.employee_id WHERE wtp.task_id = t.task_id) AS participant_names
       FROM work_tasks t
       LEFT JOIN work_task_categories wc ON wc.category_id = t.category_id
      WHERE t.owning_dept_id = $1 AND t.status <> 'archived'
      ORDER BY t.task_name ASC`,
    [deptId]
  );

  const contracts: OversightCard[] = rowsToObjects(contractResult).map((row) => ({
    kind: "contract",
    subjectId: String(row.contract_id ?? ""),
    contractId: String(row.contract_id ?? ""),
    taskId: null,
    title: String(row.contract_title ?? ""),
    subtitle: [row.counterparty_name != null ? String(row.counterparty_name) : null, row.service_type != null ? String(row.service_type) : null]
      .filter(Boolean)
      .join(" · ") || null,
    stageTotal: Number(row.stage_total ?? 0),
    stageDone: Number(row.stage_done ?? 0),
    currentStage: row.current_stage != null ? String(row.current_stage) : null,
    currentPct: row.current_pct != null ? Number(row.current_pct) : null,
    issueOpen: Number(row.issue_open ?? 0),
    latestProgress: row.latest_progress != null ? String(row.latest_progress) : null,
    participantNames: row.participant_names != null ? String(row.participant_names) : null,
  }));

  const tasks: OversightCard[] = rowsToObjects(taskResult).map((row) => ({
    kind: "task",
    subjectId: String(row.task_id ?? ""),
    contractId: null,
    taskId: String(row.task_id ?? ""),
    title: String(row.task_name ?? ""),
    subtitle: row.category_name != null ? String(row.category_name) : null,
    stageTotal: Number(row.stage_total ?? 0),
    stageDone: Number(row.stage_done ?? 0),
    currentStage: row.current_stage != null ? String(row.current_stage) : null,
    currentPct: row.current_pct != null ? Number(row.current_pct) : null,
    issueOpen: 0,
    latestProgress: row.latest_progress != null ? String(row.latest_progress) : null,
    participantNames: row.participant_names != null ? String(row.participant_names) : null,
  }));

  return [...contracts, ...tasks];
}
