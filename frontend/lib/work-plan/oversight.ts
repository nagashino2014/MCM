import { getDb, rowsToObjects } from "@/lib/db";

/** 공정표 한 단계 — 발표모드 가로 타임라인용. */
export interface OversightStage {
  name: string;
  status: "pending" | "in_progress" | "done";
  pct: number;
}

export interface OversightCard {
  kind: "contract" | "task";
  subjectId: string;          // contractId | taskId (통합 키)
  contractId: string | null;  // 이슈 패널 등 계약 전용 기능용
  taskId: string | null;
  title: string;
  subtitle: string | null;    // 발주처 · 용역분류 | 업무분류
  counterpartyName: string | null; // 발주처(용역만) — 발표모드 분리 표기용
  categoryLabel: string | null;    // 용역분류 | 업무분류
  stageTotal: number;
  stageDone: number;
  currentStage: string | null;
  currentPct: number | null;
  issueOpen: number;
  latestProgress: string | null;
  /** 최근 보고의 AI 추진내역 요약(발표모드용) — 없으면 latestProgress 폴백. */
  summaryText: string | null;
  participantNames: string | null;
  /** 공정 단계 전체(순서대로) — 발표모드 가로 공정표. */
  stages: OversightStage[];
}

/** 공정 단계를 대상 id 별로 묶어 반환. (계약·Task 공통 형태) */
function groupStages(rows: Record<string, unknown>[], keyColumn: string): Map<string, OversightStage[]> {
  const map = new Map<string, OversightStage[]>();
  for (const row of rows) {
    const key = String(row[keyColumn] ?? "");
    if (!key) continue;
    const list = map.get(key) ?? [];
    const status = String(row.status ?? "pending");
    list.push({
      name: String(row.stage_name ?? ""),
      status: status === "done" || status === "in_progress" ? status : "pending",
      pct: Number(row.progress_pct ?? 0),
    });
    map.set(key, list);
  }
  return map;
}

/** 발표 회차 = 부서 · 회의종류(주간회의/간부간담회) · 보고기간 조합. */
export interface OversightSessionKey {
  meetingLabel: string;
  periodStart: string;
  periodEnd: string;
}

export interface OversightSession extends OversightSessionKey {
  reportDate: string | null;
  reportCount: number;
  year: number;
  week: number; // 보고기간 시작일 기준 ISO 주차
}

/** ISO 8601 주차(그 주 목요일이 속한 해의 몇 번째 주). */
function isoWeek(dateText: string): { year: number; week: number } {
  const d = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { year: 0, week: 0 };
  const day = d.getUTCDay() || 7; // 월=1 … 일=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // 그 주 목요일
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

/**
 * 한 부서의 발표 회차 목록(최신순). 발표 모드 진입 시 최신 회차를 기본 선택하고,
 * 과거 회의 자료도 이 목록에서 골라 다시 띄운다.
 */
export async function listOversightSessions(deptId: string): Promise<OversightSession[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT COALESCE(NULLIF(r.meeting_label, ''), '주간회의') AS meeting_label,
            r.period_start, r.period_end,
            MAX(COALESCE(NULLIF(r.report_date, ''), r.period_end)) AS report_date,
            COUNT(*)::int AS report_count
       FROM work_plan_reports r
      WHERE r.dept_id = $1 AND r.period_start <> '' AND r.period_end <> ''
      GROUP BY 1, r.period_start, r.period_end
      ORDER BY r.period_end DESC, r.period_start DESC, 1 ASC`,
    [deptId]
  );
  return rowsToObjects(result).map((row) => {
    const periodStart = String(row.period_start ?? "");
    const { year, week } = isoWeek(periodStart);
    return {
      meetingLabel: String(row.meeting_label ?? "주간회의"),
      periodStart,
      periodEnd: String(row.period_end ?? ""),
      reportDate: row.report_date != null ? String(row.report_date) : null,
      reportCount: Number(row.report_count ?? 0),
      year,
      week,
    };
  });
}

/**
 * 특정 회차에 보고된 대상(계약/Task)과 그 회차의 요약·공정 진행 상태.
 * 공정은 그 회차 시점까지의 보고 델타만 병합해 과거 회차를 그대로 재현한다.
 */
async function loadSessionOverlay(deptId: string, session: OversightSessionKey) {
  const db = await getDb();
  const reportResult = await db.exec(
    `SELECT DISTINCT ON (COALESCE(r.contract_id, r.task_id))
            r.report_id, r.contract_id, r.task_id, r.summary_text,
            COALESCE(NULLIF(r.report_date, ''), r.period_end) AS okey,
            (SELECT wi.progress_text FROM work_plan_items wi WHERE wi.report_id = r.report_id
              ORDER BY wi.display_order ASC LIMIT 1) AS progress_text
       FROM work_plan_reports r
      WHERE r.dept_id = $1
        AND COALESCE(NULLIF(r.meeting_label, ''), '주간회의') = $2
        AND r.period_start = $3 AND r.period_end = $4
        AND COALESCE(r.contract_id, r.task_id) IS NOT NULL
      ORDER BY COALESCE(r.contract_id, r.task_id), r.created_at DESC`,
    [deptId, session.meetingLabel, session.periodStart, session.periodEnd]
  );
  const rows = rowsToObjects(reportResult);
  const contractIds = rows.filter((r) => r.contract_id != null).map((r) => String(r.contract_id));
  const taskIds = rows.filter((r) => r.task_id != null).map((r) => String(r.task_id));

  const summaries = new Map<string, { summaryText: string | null; progressText: string | null }>();
  let cutoff = session.periodEnd;
  for (const row of rows) {
    const subjectId = String(row.contract_id ?? row.task_id ?? "");
    if (!subjectId) continue;
    summaries.set(subjectId, {
      summaryText: row.summary_text != null ? String(row.summary_text) : null,
      progressText: row.progress_text != null ? String(row.progress_text) : null,
    });
    const okey = String(row.okey ?? "");
    if (okey > cutoff) cutoff = okey;
  }

  // 회차 시점까지의 공정 델타(stage_order 별 최신값)를 대상별로 병합.
  const asOf = new Map<string, Map<number, { status: string; pct: number }>>();
  if (contractIds.length || taskIds.length) {
    const stageResult = await db.exec(
      `SELECT COALESCE(r.contract_id, r.task_id) AS subject_id, rs.stage_order, rs.status, rs.progress_pct
         FROM work_plan_report_stages rs
         JOIN work_plan_reports r ON r.report_id = rs.report_id
        WHERE (r.contract_id = ANY($1) OR r.task_id = ANY($2))
          AND COALESCE(NULLIF(r.report_date, ''), r.period_end) <= $3
        ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) ASC, r.created_at ASC, rs.stage_order ASC`,
      [contractIds, taskIds, cutoff]
    );
    for (const row of rowsToObjects(stageResult)) {
      const subjectId = String(row.subject_id ?? "");
      if (!subjectId) continue;
      const map = asOf.get(subjectId) ?? new Map<number, { status: string; pct: number }>();
      map.set(Number(row.stage_order ?? 0), {
        status: String(row.status ?? "pending"),
        pct: Number(row.progress_pct ?? 0),
      });
      asOf.set(subjectId, map);
    }
  }

  return { contractIds, taskIds, summaries, asOf };
}

/** 현재 공정표(단계명 기준)에 회차 시점 진행 상태를 덧씌운다. */
function applyAsOf(stages: OversightStage[], asOf: Map<number, { status: string; pct: number }> | undefined): OversightStage[] {
  if (!asOf || asOf.size === 0) return stages.map((s) => ({ ...s, status: "pending", pct: 0 }));
  return stages.map((stage, i) => {
    const delta = asOf.get(i + 1); // stage_order 는 1부터
    if (!delta) return { ...stage, status: "pending", pct: 0 };
    const status = delta.status === "done" || delta.status === "in_progress" ? delta.status : "pending";
    return { ...stage, status, pct: status === "done" ? 100 : delta.pct };
  });
}

/**
 * 한 부서(owning_dept_id)의 용역 + Task 진행 현황 카드.
 * 공정 진행/현재 단계, 미해결 이슈 수(용역만), 최근 보고 진행상황, 수행인력을 집계한다.
 * session 이 주어지면 그 회차에 보고된 대상만, 그 회차 시점의 요약·공정으로 구성한다.
 */
export async function listOversight(deptId: string, session?: OversightSessionKey): Promise<OversightCard[]> {
  const db = await getDb();
  const overlay = session ? await loadSessionOverlay(deptId, session) : null;
  // 회차 모드는 보고 대상 id 로, 상시 모드는 수행부서로 카드를 고른다.
  const contractWhere = overlay ? "c.contract_id = ANY($1)" : "c.owning_dept_id = $1";
  const contractParam: unknown[] = [overlay ? overlay.contractIds : deptId];
  const taskWhere = overlay ? "t.task_id = ANY($1)" : "t.owning_dept_id = $1";
  const taskParam: unknown[] = [overlay ? overlay.taskIds : deptId];

  // 용역(계약) 카드.
  const contractResult = await db.exec(
    `SELECT c.contract_id, c.contract_title, cp.company_name AS counterparty_name, c.service_type,
            (SELECT COUNT(*) FROM contract_process_stages s WHERE s.contract_id = c.contract_id) AS stage_total,
            (SELECT COUNT(*) FROM contract_process_stages s WHERE s.contract_id = c.contract_id AND s.status = 'done') AS stage_done,
            (SELECT s.stage_name FROM contract_process_stages s WHERE s.contract_id = c.contract_id AND s.status = 'in_progress' ORDER BY s.stage_order ASC LIMIT 1) AS current_stage,
            (SELECT s.progress_pct FROM contract_process_stages s WHERE s.contract_id = c.contract_id AND s.status = 'in_progress' ORDER BY s.stage_order ASC LIMIT 1) AS current_pct,
            (SELECT COUNT(*) FROM work_plan_issues i WHERE i.contract_id = c.contract_id AND i.status <> 'resolved') AS issue_open,
            (SELECT wi.progress_text FROM work_plan_items wi WHERE wi.contract_id = c.contract_id AND wi.progress_text IS NOT NULL ORDER BY wi.updated_at DESC LIMIT 1) AS latest_progress,
            (SELECT r.summary_text FROM work_plan_reports r WHERE r.contract_id = c.contract_id AND r.summary_text IS NOT NULL
              ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC LIMIT 1) AS latest_summary,
            (SELECT string_agg(e.name, ', ') FROM service_participants sp JOIN employee_profiles e ON e.employee_id = sp.employee_id WHERE sp.contract_id = c.contract_id) AS participant_names
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
      WHERE ${contractWhere} AND c.deleted_at IS NULL
      ORDER BY c.contract_title ASC`,
    contractParam
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
            (SELECT r.summary_text FROM work_plan_reports r WHERE r.task_id = t.task_id AND r.summary_text IS NOT NULL
              ORDER BY COALESCE(NULLIF(r.report_date, ''), r.period_end) DESC, r.created_at DESC LIMIT 1) AS latest_summary,
            (SELECT string_agg(e.name, ', ') FROM work_task_participants wtp JOIN employee_profiles e ON e.employee_id = wtp.employee_id WHERE wtp.task_id = t.task_id) AS participant_names
       FROM work_tasks t
       LEFT JOIN work_task_categories wc ON wc.category_id = t.category_id
      WHERE ${taskWhere} AND t.status <> 'archived'
      ORDER BY t.task_name ASC`,
    taskParam
  );

  // 공정 단계 전체(가로 공정표용) — 대상 계약/Task 를 한 번에 조회해 id 별로 묶는다.
  const contractStageResult = await db.exec(
    `SELECT s.contract_id, s.stage_name, s.status, s.progress_pct
       FROM contract_process_stages s
       JOIN contracts c ON c.contract_id = s.contract_id
      WHERE ${contractWhere} AND c.deleted_at IS NULL
      ORDER BY s.contract_id, s.stage_order ASC`,
    contractParam
  );
  const taskStageResult = await db.exec(
    `SELECT s.task_id, s.stage_name, s.status, s.progress_pct
       FROM work_task_process_stages s
       JOIN work_tasks t ON t.task_id = s.task_id
      WHERE ${taskWhere} AND t.status <> 'archived'
      ORDER BY s.task_id, s.stage_order ASC`,
    taskParam
  );
  const contractStages = groupStages(rowsToObjects(contractStageResult), "contract_id");
  const taskStages = groupStages(rowsToObjects(taskStageResult), "task_id");

  const contracts: OversightCard[] = rowsToObjects(contractResult).map((row) => ({
    kind: "contract",
    subjectId: String(row.contract_id ?? ""),
    contractId: String(row.contract_id ?? ""),
    taskId: null,
    title: String(row.contract_title ?? ""),
    subtitle: [row.counterparty_name != null ? String(row.counterparty_name) : null, row.service_type != null ? String(row.service_type) : null]
      .filter(Boolean)
      .join(" · ") || null,
    counterpartyName: row.counterparty_name != null ? String(row.counterparty_name) : null,
    categoryLabel: row.service_type != null ? String(row.service_type) : null,
    stageTotal: Number(row.stage_total ?? 0),
    stageDone: Number(row.stage_done ?? 0),
    currentStage: row.current_stage != null ? String(row.current_stage) : null,
    currentPct: row.current_pct != null ? Number(row.current_pct) : null,
    issueOpen: Number(row.issue_open ?? 0),
    latestProgress: row.latest_progress != null ? String(row.latest_progress) : null,
    summaryText: row.latest_summary != null ? String(row.latest_summary) : null,
    participantNames: row.participant_names != null ? String(row.participant_names) : null,
    stages: contractStages.get(String(row.contract_id ?? "")) ?? [],
  }));

  const tasks: OversightCard[] = rowsToObjects(taskResult).map((row) => ({
    kind: "task",
    subjectId: String(row.task_id ?? ""),
    contractId: null,
    taskId: String(row.task_id ?? ""),
    title: String(row.task_name ?? ""),
    subtitle: row.category_name != null ? String(row.category_name) : null,
    counterpartyName: null,
    categoryLabel: row.category_name != null ? String(row.category_name) : null,
    stageTotal: Number(row.stage_total ?? 0),
    stageDone: Number(row.stage_done ?? 0),
    currentStage: row.current_stage != null ? String(row.current_stage) : null,
    currentPct: row.current_pct != null ? Number(row.current_pct) : null,
    issueOpen: 0,
    latestProgress: row.latest_progress != null ? String(row.latest_progress) : null,
    summaryText: row.latest_summary != null ? String(row.latest_summary) : null,
    participantNames: row.participant_names != null ? String(row.participant_names) : null,
    stages: taskStages.get(String(row.task_id ?? "")) ?? [],
  }));

  const cards = [...contracts, ...tasks];
  if (!overlay) return cards;

  // 회차 모드: 요약·공정을 그 회차 시점 값으로 교체한다.
  return cards.map((card) => {
    const stages = applyAsOf(card.stages, overlay.asOf.get(card.subjectId));
    const reported = overlay.summaries.get(card.subjectId);
    const active = stages.find((s) => s.status === "in_progress");
    return {
      ...card,
      stages,
      stageDone: stages.filter((s) => s.status === "done").length,
      currentStage: active?.name ?? card.currentStage,
      currentPct: active ? active.pct : card.currentPct,
      summaryText: reported?.summaryText ?? null,
      latestProgress: reported?.progressText ?? null,
    };
  });
}
