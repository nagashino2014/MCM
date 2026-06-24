import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeReport } from "@/lib/work-plan/normalize";

export interface MyServiceRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceType: string | null;
  serviceSubtype: string | null;
  contractDate: string | null;
  startedAt: string | null;
  contractStatus: string;
  /** 마지막 제출 보고의 현재 공정단계명/진행률. */
  lastStage: string | null;
  lastPct: number | null;
  stageIndex: number | null;
  stageTotal: number | null;
  lastReportDate: string | null;
  lastReportSeq: number | null;
  completed: boolean;
  /** 실무자 성명(관리자 제외, 역할순). 카드 수행인력 표시용. */
  workerNames: string[];
}

export interface ServiceReportListRow {
  reportId: string;
  contractId: string | null;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  meetingLabel: string | null;
  status: string;
  title: string | null;
  updatedAt: string;
}

export interface ReportStageInput {
  stageOrder: number;
  stageCode?: string | null;
  stageName: string;
  status: "pending" | "in_progress" | "done";
  progressPct?: number | null;
  plannedDate?: string | null;
  actualDate?: string | null;
}

export interface ReportStageRow extends ReportStageInput {
  rowId: string;
}

export type ReportSubjectKind = "contract" | "task";

export interface ServiceReportDetail {
  reportId: string;
  subjectKind: ReportSubjectKind;
  contractId: string | null;
  taskId: string | null;
  deptId: string;
  deptName: string | null;
  authorName: string | null;     // 원 작성자(감독 헤더 표시용)
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  meetingLabel: string | null;
  status: string;
  title: string | null;
  progressText: string | null;   // 추진내역 (이번 기간)
  planText: string | null;       // 추진계획 (다음 기간)
  reviewerComment: string | null; // 부서장 의견(감독)
  reviewerCommentKind: string | null; // 의견 분류(amend|supplement|correction)
  reviewStatus: string | null;    // pending|rejected|confirmed|merged
  execStatus: string | null;      // null|directed|re_reported
  directorResponse: string | null; // 임원 지시에 대한 부서장 답변
  reReportCount: number;          // 재보고 횟수(1 제한)
  summaryText: string | null;     // AI 추진내역 요약
  execDirective: { kind: string; message: string | null } | null; // 최신 임원 지시
  meetingSeq: number | null;      // 같은 subject·회의종류에서 이 보고의 회차
  currentStageName: string | null;
  currentStagePct: number | null;
  stages: ReportStageRow[];
  /** 이 보고 시점까지(report_date ≤ 해당 보고)의 누적 공정 상태 — 과거 보고 표시용 시드. */
  asOfStages: { stageOrder: number; status: ReportStageRow["status"]; progressPct: number; plannedDate: string | null; actualDate: string | null }[];
}

export interface ReporterContext {
  employeeId: string | null;
  name: string | null;
  positionName: string | null;
  deptId: string | null;
  deptName: string | null;
}

export interface SaveReportInput {
  reportId?: string;
  subjectKind: ReportSubjectKind;
  subjectId: string;
  deptId?: string | null;
  periodStart: string;
  periodEnd: string;
  reportDate?: string | null;
  meetingLabel?: string | null;
  title?: string | null;
  status?: "draft" | "submitted";
  progressText?: string | null;
  planText?: string | null;
  reviewerComment?: string | null;
  /** 감독(부서장) 저장 여부 — true 면 review_status 를 pending 으로 리셋하지 않음. */
  fromReview?: boolean;
  currentStageName?: string | null;
  currentStagePct?: number | null;
  stages: ReportStageInput[];
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function str(value: unknown): string | null {
  return value != null ? String(value) : null;
}

/** 로그인 사용자 ↔ 조직 인원(보고자/부서) 매핑. */
export async function getReporterContext(userId: string): Promise<ReporterContext> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT e.employee_id, e.name, p.position_name, e.dept_id, d.dept_name
       FROM employee_profiles e
       LEFT JOIN positions p ON p.position_id = e.position_id
       LEFT JOIN departments d ON d.dept_id = e.dept_id
      WHERE e.user_id = $1
      LIMIT 1`,
    [userId]
  );
  const rows = rowsToObjects(result);
  if (!rows.length) {
    return { employeeId: null, name: null, positionName: null, deptId: null, deptName: null };
  }
  const row = rows[0];
  return {
    employeeId: str(row.employee_id),
    name: str(row.name),
    positionName: str(row.position_name),
    deptId: str(row.dept_id),
    deptName: str(row.dept_name),
  };
}

// 용역 카드 공통 SELECT 컬럼 / LATERAL / GROUP BY (listMyServices·listDeptServices 공유).
const SERVICE_CARD_COLS = `c.contract_id, c.contract_title, cp.company_name AS counterparty_name,
        c.service_type, c.service_subtype, c.contract_date, c.started_at, c.contract_status,
        cur.stage_name AS last_stage, cur.progress_pct AS last_pct,
        cnt.idx AS stage_index, cnt.total AS stage_total, cnt.done AS stage_done,
        lr.rdate AS last_report_date, rc.seq AS last_report_seq, wk.names AS worker_names`;

const SERVICE_CARD_LATERALS = `
   LEFT JOIN LATERAL (
     SELECT s.stage_name, s.progress_pct, s.stage_order
       FROM contract_process_stages s
      WHERE s.contract_id = c.contract_id AND s.status <> 'pending'
      ORDER BY (s.status = 'in_progress') DESC, s.stage_order DESC
      LIMIT 1
   ) cur ON true
   LEFT JOIN LATERAL (
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE s2.stage_order <= cur.stage_order)::int AS idx,
            count(*) FILTER (WHERE s2.status = 'done')::int AS done
       FROM contract_process_stages s2 WHERE s2.contract_id = c.contract_id
   ) cnt ON true
   LEFT JOIN LATERAL (
     SELECT COALESCE(NULLIF(r.report_date, ''), r.period_end) AS rdate
       FROM work_plan_reports r
      WHERE r.contract_id = c.contract_id AND r.status = 'submitted'
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC
      LIMIT 1
   ) lr ON true
   LEFT JOIN LATERAL (
     SELECT count(*)::int AS seq FROM work_plan_reports r3 WHERE r3.contract_id = c.contract_id AND r3.status = 'submitted'
   ) rc ON true
   LEFT JOIN LATERAL (
     SELECT array_agg(e2.name ORDER BY sp2.role_label) AS names
       FROM service_participants sp2 JOIN employee_profiles e2 ON e2.employee_id = sp2.employee_id
      WHERE sp2.contract_id = c.contract_id AND sp2.role_label NOT ILIKE '%관리자%'
   ) wk ON true`;

const SERVICE_CARD_GROUP = `GROUP BY c.contract_id, c.contract_title, cp.company_name, c.service_type, c.service_subtype,
           c.contract_date, c.started_at, c.contract_status, cur.stage_name, cur.progress_pct,
           cnt.idx, cnt.total, cnt.done, lr.rdate, rc.seq, wk.names`;

const SERVICE_CARD_ORDER = `ORDER BY COALESCE(NULLIF(c.contract_date, ''), c.started_at) DESC NULLS LAST, c.contract_title ASC`;

function mapServiceRow(row: Record<string, unknown>): MyServiceRow {
  return {
    contractId: String(row.contract_id ?? ""),
    contractTitle: String(row.contract_title ?? ""),
    counterpartyName: String(row.counterparty_name ?? ""),
    serviceType: str(row.service_type),
    serviceSubtype: str(row.service_subtype),
    contractDate: str(row.contract_date),
    startedAt: str(row.started_at),
    contractStatus: String(row.contract_status ?? ""),
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
 * 진행용역 = 로그인 사용자가 수행인력으로 매핑된 계약들 + 현재 공정단계/진행률.
 * 현재 단계 = 누적 공정표(contract_process_stages)에서 진행중(최상위) → 없으면 완료(최상위).
 * (보고서 period_end 가 입력 순서와 어긋나도 견고하도록 보고 대신 공정표 누적 상태를 사용)
 */
export async function listMyServices(userId: string): Promise<MyServiceRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT ${SERVICE_CARD_COLS}
       FROM service_participants sp
       JOIN employee_profiles e ON e.employee_id = sp.employee_id
       JOIN contracts c ON c.contract_id = sp.contract_id
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       ${SERVICE_CARD_LATERALS}
      WHERE e.user_id = $1
      ${SERVICE_CARD_GROUP}
      ${SERVICE_CARD_ORDER}`,
    [userId]
  );
  return rowsToObjects(result).map(mapServiceRow);
}

/** 부서 감독: 한 부서(owning_dept_id)가 수행하는 모든 용역 카드. listMyServices 와 동일 컬럼. */
export async function listDeptServices(deptId: string): Promise<MyServiceRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT ${SERVICE_CARD_COLS}
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       ${SERVICE_CARD_LATERALS}
      WHERE c.owning_dept_id = $1 AND c.deleted_at IS NULL
      ${SERVICE_CARD_GROUP}
      ${SERVICE_CARD_ORDER}`,
    [deptId]
  );
  return rowsToObjects(result).map(mapServiceRow);
}

/** 수행인력 필터용 — 부서원 목록. */
export async function listDeptMembers(deptId: string): Promise<{ employeeId: string; name: string }[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT employee_id, name FROM employee_profiles
      WHERE dept_id = $1 AND status = 'active'
      ORDER BY name ASC`,
    [deptId]
  );
  return rowsToObjects(result).map((row) => ({ employeeId: String(row.employee_id ?? ""), name: String(row.name ?? "") }));
}

/** 보고 Log = 특정 용역의 보고 목록(회의일자 최신순; 회차 산정 기준). */
export async function listServiceReports(contractId: string): Promise<ServiceReportListRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT report_id, contract_id, period_start, period_end, report_date, meeting_label,
            status, title, updated_at
       FROM work_plan_reports
      WHERE contract_id = $1
      ORDER BY COALESCE(NULLIF(report_date, ''), period_end) DESC, updated_at DESC`,
    [contractId]
  );
  return rowsToObjects(result).map((row) => ({
    reportId: String(row.report_id ?? ""),
    contractId: str(row.contract_id),
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: str(row.report_date),
    meetingLabel: str(row.meeting_label),
    status: String(row.status ?? "draft"),
    title: str(row.title),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

export async function getServiceReport(reportId: string): Promise<ServiceReportDetail | null> {
  const db = await getDb();
  const reportResult = await db.exec(
    `SELECT r.report_id, r.contract_id, r.task_id, r.dept_id, d.dept_name, u.name AS author_name,
            r.period_start, r.period_end, r.report_date, r.meeting_label, r.status, r.title,
            r.reviewer_comment, r.reviewer_comment_kind, r.review_status,
            r.exec_status, r.director_response, r.re_report_count, r.summary_text, r.created_at
       FROM work_plan_reports r
       LEFT JOIN departments d ON d.dept_id = r.dept_id
       LEFT JOIN users u ON u.user_id = r.author_user_id
      WHERE r.report_id = $1
      LIMIT 1`,
    [reportId]
  );
  const reportRows = rowsToObjects(reportResult);
  if (!reportRows.length) return null;
  const row = reportRows[0];

  // 이 보고 시점까지(회의일자 ≤ 이 보고, 동률은 created_at)의 보고들의 공정 델타를 순서대로 병합 →
  // 과거 보고 열람 시 그 시점 이후 진행분이 새어 나오지 않도록 한다.
  const subjKind: ReportSubjectKind = row.task_id != null ? "task" : "contract";
  const subjCol = subjKind === "task" ? "task_id" : "contract_id";
  const subjId = subjKind === "task" ? String(row.task_id) : String(row.contract_id);
  const okey = (str(row.report_date) || String(row.period_end ?? "")) ?? "";
  const createdAt = String(row.created_at ?? "");
  const asOfResult = await db.exec(
    `SELECT rs.stage_order, rs.status, rs.progress_pct, rs.planned_date, rs.actual_date
       FROM work_plan_report_stages rs
       JOIN work_plan_reports r ON r.report_id = rs.report_id
      WHERE r.${subjCol} = $1
        AND ( COALESCE(NULLIF(r.report_date, ''), r.period_end) < $2
              OR ( COALESCE(NULLIF(r.report_date, ''), r.period_end) = $2 AND r.created_at <= $3 ) )
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) ASC, r.created_at ASC, rs.stage_order ASC`,
    [subjId, okey, createdAt]
  );
  const asOfMap = new Map<number, { stageOrder: number; status: ReportStageRow["status"]; progressPct: number; plannedDate: string | null; actualDate: string | null }>();
  for (const s of rowsToObjects(asOfResult)) {
    const order = Number(s.stage_order ?? 0);
    asOfMap.set(order, {
      stageOrder: order,
      status: String(s.status ?? "in_progress") as ReportStageRow["status"],
      progressPct: s.progress_pct != null ? Number(s.progress_pct) : 0,
      plannedDate: str(s.planned_date),
      actualDate: str(s.actual_date),
    });
  }

  const itemResult = await db.exec(
    `SELECT progress_text, plan_text, progress_stage, progress_pct
       FROM work_plan_items
      WHERE report_id = $1
      ORDER BY display_order ASC
      LIMIT 1`,
    [reportId]
  );
  const item = rowsToObjects(itemResult)[0] ?? {};

  const stageResult = await db.exec(
    `SELECT row_id, stage_order, stage_code, stage_name, status, progress_pct, planned_date, actual_date
       FROM work_plan_report_stages
      WHERE report_id = $1
      ORDER BY stage_order ASC`,
    [reportId]
  );

  // 회차 = 같은 subject·회의종류에서 회의일자 ≤ 이 보고(동률은 created_at) 인 제출/임시 보고 수.
  const meetingLabel = str(row.meeting_label) || "";
  const seqResult = await db.exec(
    `SELECT count(*)::int AS seq
       FROM work_plan_reports r
      WHERE r.${subjCol} = $1
        AND COALESCE(r.meeting_label, '') = $2
        AND ( COALESCE(NULLIF(r.report_date, ''), r.period_end) < $3
              OR ( COALESCE(NULLIF(r.report_date, ''), r.period_end) = $3 AND r.created_at <= $4 ) )`,
    [subjId, meetingLabel, okey, createdAt]
  );
  const meetingSeq = Number(rowsToObjects(seqResult)[0]?.seq ?? 0) || null;

  // 최신 임원 지시(open) — execResponse(감독 임원지시) 표시용.
  const dirResult = await db.exec(
    `SELECT kind, message FROM work_plan_directives
      WHERE report_id = $1 AND level = 'exec'
      ORDER BY created_at DESC LIMIT 1`,
    [reportId]
  );
  const dirRow = rowsToObjects(dirResult)[0];
  const execDirective = dirRow ? { kind: String(dirRow.kind ?? ""), message: str(dirRow.message) } : null;

  return {
    reportId: String(row.report_id ?? ""),
    subjectKind: (row.task_id != null ? "task" : "contract") as ReportSubjectKind,
    contractId: str(row.contract_id),
    taskId: str(row.task_id),
    deptId: String(row.dept_id ?? ""),
    deptName: str(row.dept_name),
    authorName: str(row.author_name),
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: str(row.report_date),
    meetingLabel: str(row.meeting_label),
    status: String(row.status ?? "draft"),
    title: str(row.title),
    progressText: str(item.progress_text),
    planText: str(item.plan_text),
    reviewerComment: str(row.reviewer_comment),
    reviewerCommentKind: str(row.reviewer_comment_kind),
    reviewStatus: str(row.review_status),
    execStatus: str(row.exec_status),
    directorResponse: str(row.director_response),
    reReportCount: Number(row.re_report_count ?? 0),
    summaryText: str(row.summary_text),
    execDirective,
    meetingSeq,
    currentStageName: str(item.progress_stage),
    currentStagePct: item.progress_pct != null ? Number(item.progress_pct) : null,
    stages: rowsToObjects(stageResult).map((s) => ({
      rowId: String(s.row_id ?? ""),
      stageOrder: Number(s.stage_order ?? 0),
      stageCode: str(s.stage_code),
      stageName: String(s.stage_name ?? ""),
      status: (String(s.status ?? "in_progress") as ReportStageRow["status"]),
      progressPct: s.progress_pct != null ? Number(s.progress_pct) : null,
      plannedDate: str(s.planned_date),
      actualDate: str(s.actual_date),
    })),
    asOfStages: Array.from(asOfMap.values()).sort((a, b) => a.stageOrder - b.stageOrder),
  };
}

/**
 * 보고 저장(용역/Task 공통): report 헤더 + 단일 work_plan_item(추진내역) + report_stages(공정 진행 델타).
 * 제출 시 report_stages 를 대상(계약/Task) 공정표에 반영한다. 계약 보고는 추가로 정규화(추진경과/수행인력 집계)한다.
 */
export async function saveReport(actorUserId: string, input: SaveReportInput): Promise<string> {
  if (!input.subjectId) throw new Error(input.subjectKind === "task" ? "Task를 선택하세요." : "용역(계약)을 선택하세요.");
  if (!input.periodStart || !input.periodEnd) throw new Error("보고 기간을 입력하세요.");

  const isTask = input.subjectKind === "task";
  const db = await getDb();

  // 부서: 입력값 → 대상 수행부서(owning_dept_id) → 보고자 소속 순으로 결정.
  let deptId = input.deptId?.trim() || "";
  let subjectTitle: string | null = null;
  if (isTask) {
    const r = await db.exec("SELECT task_name, owning_dept_id FROM work_tasks WHERE task_id = $1 LIMIT 1", [input.subjectId]);
    const row = rowsToObjects(r)[0];
    subjectTitle = str(row?.task_name);
    if (!deptId) {
      const ctx = await getReporterContext(actorUserId);
      deptId = str(row?.owning_dept_id) || ctx.deptId || "";
    }
  } else {
    const r = await db.exec("SELECT contract_title, owning_dept_id FROM contracts WHERE contract_id = $1 LIMIT 1", [input.subjectId]);
    const row = rowsToObjects(r)[0];
    subjectTitle = str(row?.contract_title);
    if (!deptId) {
      const ctx = await getReporterContext(actorUserId);
      deptId = str(row?.owning_dept_id) || ctx.deptId || "";
    }
  }
  if (!deptId) throw new Error("보고 부서를 확인할 수 없습니다. 수행부서를 먼저 지정하세요.");

  const contractId = isTask ? null : input.subjectId;
  const taskId = isTask ? input.subjectId : null;
  const reportId = input.reportId?.trim() || id("wpr");
  const isNew = !input.reportId;
  const now = new Date().toISOString();
  const status = input.status ?? "draft";

  await withDbWrite(async (wdb) => {
    if (isNew) {
      await wdb.run(
        `INSERT INTO work_plan_reports
           (report_id, dept_id, contract_id, task_id, report_period, period_start, period_end, report_date,
            meeting_type, meeting_label, report_kind, status, title, reviewer_comment, author_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'weekly', $5, $6, $7, 'weekly', $8, 'staff_input', $9, $10, $11, $12, $13, $13)`,
        [reportId, deptId, contractId, taskId, input.periodStart, input.periodEnd, input.reportDate || null,
         input.meetingLabel || null, status, input.title || null, input.reviewerComment ?? null, actorUserId, now]
      );
    } else {
      // 작성자(실무자) 재제출 시 review_status 를 pending 으로 리셋(반려 목록에서 빠짐). 감독 저장은 유지.
      const resetReview = status === "submitted" && !input.fromReview;
      await wdb.run(
        `UPDATE work_plan_reports SET
           dept_id = $2, contract_id = $3, task_id = $4, period_start = $5, period_end = $6, report_date = $7,
           meeting_label = $8, status = $9, title = $10, reviewer_comment = COALESCE($11, reviewer_comment),
           review_status = CASE WHEN $13 THEN 'pending' ELSE review_status END, updated_at = $12
         WHERE report_id = $1`,
        [reportId, deptId, contractId, taskId, input.periodStart, input.periodEnd, input.reportDate || null,
         input.meetingLabel || null, status, input.title || null, input.reviewerComment ?? null, now, resetReview]
      );
      await wdb.run("DELETE FROM work_plan_items WHERE report_id = $1", [reportId]);
      await wdb.run("DELETE FROM work_plan_report_stages WHERE report_id = $1", [reportId]);
    }

    // 단일 추진내역 항목(용역/Task 단위).
    await wdb.run(
      `INSERT INTO work_plan_items
         (item_id, report_id, display_order, subject_kind, contract_id, subject_label,
          progress_text, plan_text, progress_stage, progress_pct, item_status, author_user_id,
          created_at, updated_at)
       VALUES ($1, $2, 10, $3, $4, $5, $6, $7, $8, $9, 'submitted', $10, $11, $11)`,
      [id("wpi"), reportId, input.subjectKind, contractId, subjectTitle, input.progressText || null,
       input.planText || null, input.currentStageName || null,
       input.currentStagePct != null ? Number(input.currentStagePct) : null, actorUserId, now]
    );

    // 공정 진행 델타.
    for (const s of input.stages) {
      const name = (s.stageName ?? "").trim();
      if (!name) continue;
      await wdb.run(
        `INSERT INTO work_plan_report_stages
           (row_id, report_id, stage_order, stage_code, stage_name, status, progress_pct, planned_date, actual_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [id("wprs"), reportId, s.stageOrder, s.stageCode || null, name, s.status,
         s.status === "done" ? 100 : Number(s.progressPct ?? 0), s.plannedDate || null, s.actualDate || null, now]
      );
    }

    // 제출 시 대상 공정표에 진행 델타 반영.
    if (status === "submitted") {
      const stageTable = isTask ? "work_task_process_stages" : "contract_process_stages";
      const keyCol = isTask ? "task_id" : "contract_id";
      for (const s of input.stages) {
        if (!s.stageName?.trim()) continue;
        await wdb.run(
          `UPDATE ${stageTable}
              SET status = $3,
                  progress_pct = $4,
                  planned_date = COALESCE($7, planned_date),
                  actual_date = CASE WHEN $3 = 'done' THEN COALESCE($5, actual_date) ELSE actual_date END,
                  updated_at = $6
            WHERE ${keyCol} = $1 AND stage_order = $2`,
          [input.subjectId, s.stageOrder, s.status, s.status === "done" ? 100 : Number(s.progressPct ?? 0),
           s.actualDate || input.reportDate || input.periodEnd || null, now, s.plannedDate || null]
        );
      }
    }
  });

  // 정규화(추진경과/수행인력 집계)는 계약 보고에만 적용.
  if (status === "submitted" && !isTask) {
    await normalizeReport(reportId);
  }

  return reportId;
}

/** 재보고/머징 목록 태그용 보고 행. */
export interface ReviewReportRow {
  reportId: string;
  subjectKind: ReportSubjectKind;
  subjectId: string;
  subjectLabel: string | null;
  serviceType: string | null;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  meetingLabel: string | null;
  meetingSeq: number | null;
  authorName: string | null;
  deptName: string | null;
  reviewerComment: string | null;
  reviewerCommentKind: string | null;
}

const REVIEW_ROW_SELECT = `
  SELECT r.report_id, r.contract_id, r.task_id, r.period_start, r.period_end, r.report_date, r.meeting_label,
         r.reviewer_comment, r.reviewer_comment_kind, u.name AS author_name, d.dept_name,
         c.contract_title, c.service_type, wt.task_name, wtc.category_name,
         (SELECT count(*)::int FROM work_plan_reports r2
           WHERE COALESCE(r2.contract_id, '') = COALESCE(r.contract_id, '')
             AND COALESCE(r2.task_id, '') = COALESCE(r.task_id, '')
             AND COALESCE(r2.meeting_label, '') = COALESCE(r.meeting_label, '')
             AND COALESCE(NULLIF(r2.report_date, ''), r2.period_end) <= COALESCE(NULLIF(r.report_date, ''), r.period_end)) AS seq
    FROM work_plan_reports r
    LEFT JOIN users u ON u.user_id = r.author_user_id
    LEFT JOIN departments d ON d.dept_id = r.dept_id
    LEFT JOIN contracts c ON c.contract_id = r.contract_id
    LEFT JOIN work_tasks wt ON wt.task_id = r.task_id
    LEFT JOIN work_task_categories wtc ON wtc.category_id = wt.category_id`;

function mapReviewRow(row: Record<string, unknown>): ReviewReportRow {
  const isTask = row.task_id != null;
  return {
    reportId: String(row.report_id ?? ""),
    subjectKind: isTask ? "task" : "contract",
    subjectId: isTask ? String(row.task_id) : String(row.contract_id ?? ""),
    subjectLabel: isTask ? str(row.task_name) : str(row.contract_title),
    serviceType: isTask ? str(row.category_name) : str(row.service_type),
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    reportDate: str(row.report_date),
    meetingLabel: str(row.meeting_label),
    meetingSeq: row.seq != null ? Number(row.seq) : null,
    authorName: str(row.author_name),
    deptName: str(row.dept_name),
    reviewerComment: str(row.reviewer_comment),
    reviewerCommentKind: str(row.reviewer_comment_kind),
  };
}

/** 임원 검토 카드(통합 완료 보고 / 임원지시 / 재보고). */
export interface ExecReportCard {
  reportId: string;
  subjectKind: ReportSubjectKind;
  subjectId: string;
  subjectLabel: string | null;
  subtitle: string | null;
  serviceType: string | null;
  subjectDate: string | null;
  progressStage: string | null;
  progressPct: number | null;
  workerNames: string[];
  summaryText: string | null;
  meetingLabel: string | null;
  meetingSeq: number | null;
  execStatus: string | null;
  directorResponse: string | null;
}

const EXEC_CARD_SELECT = `
  SELECT r.report_id, r.contract_id, r.task_id, r.report_date, r.period_end, r.meeting_label,
         r.summary_text, r.exec_status, r.director_response,
         COALESCE(c.contract_title, wt.task_name) AS subject_label,
         COALESCE(cf.company_name, wtc.category_name) AS subtitle,
         COALESCE(c.service_type, wtc.category_name) AS service_type,
         COALESCE(c.contract_date, wt.started_at) AS subject_date,
         it.progress_stage, it.progress_pct, wk.names AS worker_names,
         (SELECT count(*)::int FROM work_plan_reports r2
            WHERE COALESCE(r2.contract_id, '') = COALESCE(r.contract_id, '')
              AND COALESCE(r2.task_id, '') = COALESCE(r.task_id, '')
              AND COALESCE(r2.meeting_label, '') = COALESCE(r.meeting_label, '')
              AND COALESCE(NULLIF(r2.report_date, ''), r2.period_end) <= COALESCE(NULLIF(r.report_date, ''), r.period_end)) AS seq
    FROM work_plan_reports r
    LEFT JOIN contracts c ON c.contract_id = r.contract_id
    LEFT JOIN facilities cf ON cf.facility_id = c.counterparty_facility_id
    LEFT JOIN work_tasks wt ON wt.task_id = r.task_id
    LEFT JOIN work_task_categories wtc ON wtc.category_id = wt.category_id
    LEFT JOIN LATERAL (SELECT progress_stage, progress_pct FROM work_plan_items WHERE report_id = r.report_id ORDER BY display_order ASC LIMIT 1) it ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(z.name) AS names FROM (
        SELECT e.name FROM service_participants sp JOIN employee_profiles e ON e.employee_id = sp.employee_id
          WHERE sp.contract_id = r.contract_id AND sp.role_label NOT ILIKE '%관리자%'
        UNION ALL
        SELECT e.name FROM work_task_participants wp JOIN employee_profiles e ON e.employee_id = wp.employee_id
          WHERE wp.task_id = r.task_id AND wp.role_label NOT ILIKE '%관리자%'
      ) z
    ) wk ON true`;

function mapExecCard(row: Record<string, unknown>): ExecReportCard {
  const isTask = row.task_id != null;
  return {
    reportId: String(row.report_id ?? ""),
    subjectKind: isTask ? "task" : "contract",
    subjectId: isTask ? String(row.task_id) : String(row.contract_id ?? ""),
    subjectLabel: str(row.subject_label),
    subtitle: str(row.subtitle),
    serviceType: str(row.service_type),
    subjectDate: str(row.subject_date),
    progressStage: str(row.progress_stage),
    progressPct: row.progress_pct != null ? Number(row.progress_pct) : null,
    workerNames: Array.isArray(row.worker_names) ? (row.worker_names as unknown[]).map((n) => String(n)) : [],
    summaryText: str(row.summary_text),
    meetingLabel: str(row.meeting_label),
    meetingSeq: row.seq != null ? Number(row.seq) : null,
    execStatus: str(row.exec_status),
    directorResponse: str(row.director_response),
  };
}

/** 임원 카드 — filter: 'merged'(통합완료) | 'directed'(임원지시) | 're_reported'(재보고). */
export async function listExecCards(deptId: string, filter: "merged" | "directed" | "re_reported"): Promise<ExecReportCard[]> {
  const db = await getDb();
  const where = filter === "merged" ? "r.review_status = 'merged'" : `r.exec_status = '${filter}'`;
  const result = await db.exec(
    `${EXEC_CARD_SELECT}
      WHERE r.dept_id = $1 AND ${where}
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC`,
    [deptId]
  );
  return rowsToObjects(result).map(mapExecCard);
}

/** 재보고 대상 = 로그인 작성자에게 반려된 보고(부서장 의견 첨부). */
export async function listReboundReports(userId: string): Promise<ReviewReportRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `${REVIEW_ROW_SELECT}
      WHERE r.author_user_id = $1 AND r.review_status = 'rejected'
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC`,
    [userId]
  );
  return rowsToObjects(result).map(mapReviewRow);
}

/** Merging 대상 = 부서장이 확인한(confirmed) 부서 보고. */
export async function listConfirmedReports(deptId: string): Promise<ReviewReportRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `${REVIEW_ROW_SELECT}
      WHERE r.dept_id = $1 AND r.review_status = 'confirmed'
      ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC`,
    [deptId]
  );
  return rowsToObjects(result).map(mapReviewRow);
}

/** 부서장 검토 처리: 반려(rejected) | 확인(confirmed) + 의견·분류 저장. */
export async function setReportReview(
  reportId: string,
  input: { action: "reject" | "confirm"; reviewerComment?: string | null; reviewerCommentKind?: string | null }
): Promise<void> {
  if (!reportId) throw new Error("reportId가 필요합니다.");
  const reviewStatus = input.action === "reject" ? "rejected" : "confirmed";
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE work_plan_reports
          SET review_status = $2,
              reviewer_comment = COALESCE($3, reviewer_comment),
              reviewer_comment_kind = COALESCE($4, reviewer_comment_kind),
              updated_at = $5
        WHERE report_id = $1`,
      [reportId, reviewStatus, input.reviewerComment ?? null, input.reviewerCommentKind ?? null, now]
    );
  });
}

/** 임원 지시 하달 — work_plan_directives(level=exec) 기록 + exec_status='directed'. */
export async function setExecDirective(
  actorUserId: string,
  reportId: string,
  input: { kind: string; message?: string | null; contractId?: string | null }
): Promise<void> {
  if (!reportId) throw new Error("reportId가 필요합니다.");
  const directiveId = id("wpd");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_plan_directives
         (directive_id, report_id, contract_id, level, kind, message, issued_by, status, created_at)
       VALUES ($1, $2, $3, 'exec', $4, $5, $6, 'open', $7)`,
      [directiveId, reportId, input.contractId || null, input.kind, input.message || null, actorUserId, now]
    );
    await db.run("UPDATE work_plan_reports SET exec_status = 'directed', updated_at = $1 WHERE report_id = $2", [now, reportId]);
  });
}

/** 부서장 재보고 — 임원 지시에 대한 답변 저장 + exec_status='re_reported'(재보고 1회 제한). */
export async function submitReReport(reportId: string, directorResponse: string | null): Promise<void> {
  if (!reportId) throw new Error("reportId가 필요합니다.");
  const db = await getDb();
  const r = await db.exec("SELECT re_report_count FROM work_plan_reports WHERE report_id = $1 LIMIT 1", [reportId]);
  const count = Number(rowsToObjects(r)[0]?.re_report_count ?? 0);
  if (count >= 1) throw new Error("재보고는 1회만 가능합니다.");
  const now = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `UPDATE work_plan_reports
          SET director_response = $1, exec_status = 're_reported', re_report_count = re_report_count + 1, updated_at = $2
        WHERE report_id = $3`,
      [directorResponse ?? null, now, reportId]
    );
    await wdb.run("UPDATE work_plan_directives SET status = 'acknowledged', acknowledged_at = $1 WHERE report_id = $2 AND level = 'exec' AND status = 'open'", [now, reportId]);
  });
}

/**
 * 특정 용역(계약)에 대해 작성된 업무보고 전체 삭제.
 * 계약·수행인력·공정표 원본은 보존하고, work_plan_reports(및 cascade 항목/공정 델타)만 제거한다.
 */
export async function deleteServiceReports(contractId: string): Promise<number> {
  if (!contractId) throw new Error("contractId가 필요합니다.");
  const db = await getDb();
  const r = await db.exec("SELECT COUNT(*)::int AS n FROM work_plan_reports WHERE contract_id = $1", [contractId]);
  const n = Number(rowsToObjects(r)[0]?.n ?? 0);
  await withDbWrite(async (wdb) => {
    await wdb.run("DELETE FROM work_plan_reports WHERE contract_id = $1", [contractId]);
  });
  return n;
}
