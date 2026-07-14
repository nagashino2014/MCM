import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  ACTIVITY_TYPE_META,
  type ActivityAssigneeRole,
  type ActivityBid,
  type ActivityQuote,
  type SalesActivity,
  type SalesActivityAssignee,
  type SalesActivityContact,
  type SalesActivityFilter,
  type SalesActivityInput,
  type SalesActivityType,
  type SalesBidResult,
  type SalesProject,
  type SalesProjectFilter,
  type SalesProjectInput,
  type SalesProjectKpi,
  type SalesProjectMember,
  type SalesStage,
  type SalesEmployeeOption,
} from "./types";

function jsonArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// KST(UTC+9) 기준 날짜 YYYY-MM-DD. bid_end/scheduled_at은 joinIso로 저장된
// 타임존 없는 KST 벽시계('2026-07-24T18:00:00')라, UTC now와 직접 비교하면
// 하루 경계가 어긋난다 → 날짜 문자열 경계로 비교(시각·서버 타임존 무관).
const kstDay = (offsetDays = 0): string =>
  new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);

function mapProject(row: Record<string, unknown>): SalesProject {
  return {
    projectId: String(row.project_id ?? ""),
    facilityId: String(row.facility_id ?? ""),
    facilityName: text(row.facility_name),
    title: String(row.title ?? ""),
    stage: (String(row.stage ?? "lead") as SalesProject["stage"]),
    ownerEmployeeId: text(row.owner_employee_id),
    ownerEmployeeName: text(row.owner_employee_name),
    ownerDeptId: text(row.owner_dept_id),
    contractId: text(row.contract_id),
    serviceCategory: text(row.service_category) as SalesProject["serviceCategory"],
    serviceSubcategory: text(row.service_subcategory) as SalesProject["serviceSubcategory"],
    expectedAmount: num(row.expected_amount),
    priority: (String(row.priority ?? "normal") as SalesProject["priority"]),
    status: (String(row.status ?? "open") as SalesProject["status"]),
    openedAt: text(row.opened_at),
    closedAt: text(row.closed_at),
    memo: text(row.memo),
    createdBy: text(row.created_by),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    leadMemberId: text(row.lead_member_id),
    leadMemberName: text(row.lead_member_name),
    activityTypes: [], // attachStepTypes에서 진행/완료 단계만 채운다
  };
}

const PROJECT_SELECT = `
  SELECT p.project_id, p.facility_id, f.company_name AS facility_name, p.title, p.stage,
         p.owner_employee_id, e.name AS owner_employee_name, p.owner_dept_id, p.contract_id,
         p.service_category, p.service_subcategory,
         p.expected_amount, p.priority, p.status, p.opened_at, p.closed_at, p.memo,
         p.created_by, p.created_at, p.updated_at,
         lm.employee_id AS lead_member_id, lm.name AS lead_member_name
    FROM sales_projects p
    LEFT JOIN facilities f ON f.facility_id = p.facility_id
    LEFT JOIN employee_profiles e ON e.employee_id = p.owner_employee_id
    LEFT JOIN LATERAL (
      SELECT m.employee_id, e2.name
        FROM sales_project_members m
        LEFT JOIN employee_profiles e2 ON e2.employee_id = m.employee_id
       WHERE m.project_id = p.project_id
       ORDER BY CASE WHEN m.role_label = '정' THEN 0 ELSE 1 END, m.id ASC
       LIMIT 1
    ) lm ON true`;

// 스케쥴 업무단계 진행/완료 판정. 리스트 '업무 단계' 태그는 done|active만 표시(예정 제외).
//  - 견적: quotes에 (견적가+제출일시) 입력된 항목 존재 → done
//  - 투찰: bids에 (투찰가+투찰일시) 입력된 항목 존재 → done
//  - 결과: bid_result 낙찰/탈락/사업장거절/사업추진중단 → done (미정·재투찰은 미완)
//  - 그 외(전화/메일/방문/현설/제안): 경과(progress_note) 입력 → done
//  - active: 시작일시(scheduled_at)가 경과했으나 아직 미완
function activityStepState(a: Record<string, unknown>, nowKst: string): "done" | "active" | "planned" {
  const t = String(a.activity_type ?? "");
  let done = false;
  if (t === "quote") {
    done = jsonArray<ActivityQuote>(a.quotes).some((q) => q.amount != null && !!q.submittedAt);
  } else if (t === "bid") {
    done = jsonArray<ActivityBid>(a.bids).some((b) => b.amount != null && !!b.biddedAt);
  } else if (t === "result") {
    const br = String(a.bid_result ?? "");
    done = br === "won_bid" || br === "lost_bid" || br === "facility_declined" || br === "project_halted";
  } else {
    done = !!String(a.progress_note ?? "").trim();
  }
  if (done) return "done";
  const started = !!a.scheduled_at && String(a.scheduled_at) < nowKst;
  return started ? "active" : "planned";
}

// 프로젝트별 '진행 또는 완료된' 업무단계 집합을 계산해 activityTypes에 채운다(예정 제외).
async function attachStepTypes(
  db: Awaited<ReturnType<typeof getDb>>,
  projects: SalesProject[]
): Promise<void> {
  const ids = projects.map((p) => p.projectId).filter(Boolean);
  if (!ids.length) return;
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = rowsToObjects(
    await db.exec(
      `SELECT project_id, activity_type, scheduled_at, progress_note, quotes, bids, bid_result
         FROM sales_activities WHERE project_id IN (${ph})`,
      ids
    )
  );
  // scheduled_at은 KST 벽시계(joinIso)라 시작일시 경과 비교도 KST now로.
  const nowKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19);
  const byPid = new Map<string, Set<SalesActivityType>>();
  for (const a of rows) {
    if (activityStepState(a, nowKst) === "planned") continue;
    const pid = String(a.project_id ?? "");
    if (!pid) continue;
    if (!byPid.has(pid)) byPid.set(pid, new Set());
    byPid.get(pid)!.add(String(a.activity_type) as SalesActivityType);
  }
  for (const p of projects) {
    p.activityTypes = Array.from(byPid.get(p.projectId) ?? []);
  }
}

export async function listSalesProjects(filter: SalesProjectFilter = {}): Promise<SalesProject[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.facilityId) { params.push(filter.facilityId); where.push(`p.facility_id = $${params.length}`); }
  if (filter.stage) { params.push(filter.stage); where.push(`p.stage = $${params.length}`); }
  if (filter.ownerEmployeeId) { params.push(filter.ownerEmployeeId); where.push(`p.owner_employee_id = $${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`p.status = $${params.length}`); }
  if (filter.q) { params.push(`%${filter.q}%`); where.push(`(p.title ILIKE $${params.length} OR f.company_name ILIKE $${params.length})`); }

  const db = await getDb();
  const sql = `${PROJECT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY p.updated_at DESC`;
  const projects = rowsToObjects(await db.exec(sql, params)).map(mapProject);
  await attachStepTypes(db, projects);
  return projects;
}

export async function getSalesProject(projectId: string): Promise<SalesProject | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${PROJECT_SELECT} WHERE p.project_id = $1 LIMIT 1`, [projectId]));
  if (!rows.length) return null;
  const project = mapProject(rows[0]);
  project.members = await listProjectMembers(projectId);
  return project;
}

export async function listProjectMembers(projectId: string): Promise<SalesProjectMember[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.id, m.project_id, m.employee_id, e.name AS employee_name,
              p.position_name, e.photo_public_path, m.role_label, m.created_at
         FROM sales_project_members m
         LEFT JOIN employee_profiles e ON e.employee_id = m.employee_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE m.project_id = $1
        ORDER BY m.id ASC`,
      [projectId]
    )
  );
  return rows.map((row) => ({
    id: Number(row.id ?? 0),
    projectId: String(row.project_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    employeeName: text(row.employee_name),
    positionName: text(row.position_name),
    photoPath: text(row.photo_public_path),
    roleLabel: String(row.role_label ?? "담당"),
    createdAt: String(row.created_at ?? ""),
  }));
}

// ── 과거이력(사업장 단위 영업 건 이력) ────────────────────────
export interface SalesProjectHistoryItem {
  projectId: string;
  title: string;
  stage: SalesStage;
  serviceCategory: SalesProject["serviceCategory"];
  serviceSubcategory: SalesProject["serviceSubcategory"];
  startDate: string | null;
  endDate: string | null;
  members: { employeeName: string | null; positionName: string | null; photoPath: string | null }[];
  summary: string | null;
  bidAmount: number | null;
  outcome: SalesBidResult | null;
}

export async function listFacilityProjectHistory(facilityId: string): Promise<SalesProjectHistoryItem[]> {
  const db = await getDb();
  const projects = rowsToObjects(
    await db.exec(`${PROJECT_SELECT} WHERE p.facility_id = $1 ORDER BY p.created_at DESC`, [facilityId])
  ).map(mapProject);

  const items: SalesProjectHistoryItem[] = [];
  for (const p of projects) {
    const acts = rowsToObjects(
      await db.exec(
        `SELECT activity_type, scheduled_at, ended_at, occurred_at, bid_result, bids, summary
           FROM sales_activities WHERE project_id = $1`,
        [p.projectId]
      )
    );
    const dates: string[] = [];
    let bidAmount: number | null = null;
    let outcome: SalesBidResult | null = null;
    let summary = p.memo;
    for (const a of acts) {
      const s = text(a.scheduled_at) ?? text(a.occurred_at);
      const e = text(a.ended_at);
      if (s) dates.push(s.slice(0, 10));
      if (e) dates.push(e.slice(0, 10));
      if (String(a.activity_type) === "bid") {
        const bids = jsonArray<ActivityBid>(a.bids);
        const last = bids[bids.length - 1];
        if (last && last.amount != null) bidAmount = last.amount;
      }
      if (String(a.activity_type) === "result") outcome = text(a.bid_result) as SalesBidResult | null;
      if (!summary) { const sm = text(a.summary); if (sm) summary = sm; }
    }
    dates.sort();
    const members = await listProjectMembers(p.projectId);
    items.push({
      projectId: p.projectId,
      title: p.title,
      stage: p.stage,
      serviceCategory: p.serviceCategory,
      serviceSubcategory: p.serviceSubcategory,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      members: members.map((m) => ({ employeeName: m.employeeName, positionName: m.positionName, photoPath: m.photoPath })),
      summary,
      bidAmount,
      outcome,
    });
  }
  return items;
}

// ── 경과 보고 대상(기간 경과 + 경과 미입력 스케쥴) ──────────────
export interface PendingProgressReport {
  projectId: string;
  title: string;
  facilityId: string;
  facilityName: string | null;
  members: SalesProjectMember[];
  activities: SalesActivity[];
}

export async function listPendingProgressReports(): Promise<PendingProgressReport[]> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const idRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT project_id FROM sales_activities
         WHERE COALESCE(ended_at, scheduled_at) IS NOT NULL
           AND COALESCE(ended_at, scheduled_at) < $1
           AND COALESCE(NULLIF(TRIM(progress_note), ''), NULL) IS NULL`,
      [nowIso]
    )
  );
  const reports: PendingProgressReport[] = [];
  for (const r of idRows) {
    const pid = String(r.project_id ?? "");
    if (!pid) continue;
    const project = await getSalesProject(pid);
    if (!project) continue;
    const acts = await listActivities(pid);
    const pending = acts.filter((a) => {
      const end = a.endedAt ?? a.scheduledAt;
      return !!end && end < nowIso && !(a.progressNote && a.progressNote.trim());
    });
    if (!pending.length) continue;
    reports.push({
      projectId: pid,
      title: project.title,
      facilityId: project.facilityId,
      facilityName: project.facilityName,
      members: project.members ?? [],
      activities: pending,
    });
  }
  return reports;
}

// ── 투찰 마감 임박(진행중 영업건 사업장의 발주) ──────────────────
export interface UpcomingBid {
  facilityId: string;
  facilityName: string | null;
  projectId: string;
  projectTitle: string;
  orderType: string | null;
  bidEnd: string;
  estimatedPrice: number | null;
}

export async function listUpcomingBids(days = 14): Promise<UpcomingBid[]> {
  const db = await getDb();
  // 오늘(KST) ~ days일 후까지. bid_end는 'YYYY-MM-DDT..'라 날짜 경계로 당일 포함.
  const startDay = kstDay(0);
  const endDay = kstDay(days + 1);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.project_id, p.title, p.facility_id, f.company_name AS facility_name,
              o.order_type, o.bid_end, o.estimated_price
         FROM sales_projects p
         JOIN facility_order_info o ON o.facility_id = p.facility_id
         LEFT JOIN facilities f ON f.facility_id = p.facility_id
        WHERE p.stage NOT IN ('won','lost','hold')
          AND o.bid_end IS NOT NULL AND TRIM(o.bid_end) <> ''
          AND o.bid_end >= $1 AND o.bid_end < $2
        ORDER BY o.bid_end ASC`,
      [startDay, endDay]
    )
  );
  return rows.map((r) => ({
    facilityId: String(r.facility_id ?? ""),
    facilityName: text(r.facility_name),
    projectId: String(r.project_id ?? ""),
    projectTitle: String(r.title ?? ""),
    orderType: text(r.order_type),
    bidEnd: String(r.bid_end ?? ""),
    estimatedPrice: num(r.estimated_price),
  }));
}

// ── 다가오는 일정(예정 스케쥴) ─────────────────────────────────
export interface UpcomingActivity {
  activityId: string;
  projectId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: SalesActivityType;
  scheduledAt: string;
  endedAt: string | null;
  summary: string | null;
}

export async function listUpcomingActivities(days = 14): Promise<MonthActivity[]> {
  const db = await getDb();
  // 오늘(KST) ~ days일 후까지. scheduled_at도 KST 벽시계라 날짜 경계로 당일 포함.
  const startDay = kstDay(0);
  const endDay = kstDay(days + 1);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.activity_id, a.project_id, a.activity_type, a.scheduled_at, a.ended_at, a.summary,
              p.title, f.company_name AS facility_name,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', cp.id, 'personName', cp.person_name, 'title', cp.title,
                         'departmentName', cd.department_name,
                         'mobilePhone', cp.mobile_phone, 'officePhone', cp.office_phone)
                       ORDER BY cp.person_name)
                  FROM sales_activity_contacts ac
                  JOIN facility_contact_people cp ON cp.id = ac.person_id
                  LEFT JOIN facility_contact_departments cd ON cd.id = cp.department_id
                 WHERE ac.activity_id = a.activity_id
              ), '[]'::json) AS contacts
         FROM sales_activities a
         JOIN sales_projects p ON p.project_id = a.project_id
         LEFT JOIN facilities f ON f.facility_id = p.facility_id
        WHERE a.status <> 'canceled'
          AND a.scheduled_at IS NOT NULL
          AND a.scheduled_at >= $1 AND a.scheduled_at < $2
        ORDER BY a.scheduled_at ASC`,
      [startDay, endDay]
    )
  );
  return rows.map((r) => ({
    activityId: String(r.activity_id ?? ""),
    projectId: String(r.project_id ?? ""),
    projectTitle: String(r.title ?? ""),
    facilityName: text(r.facility_name),
    activityType: String(r.activity_type ?? "visit") as SalesActivityType,
    scheduledAt: String(r.scheduled_at ?? ""),
    endedAt: text(r.ended_at),
    summary: text(r.summary),
    contacts: jsonArray<ActivityContactPerson>(r.contacts),
  }));
}

/** 일정에 연결된 사업장 담당자(만난 사람) — 모바일 일정 시트의 확인·즉시 통화용. */
export interface ActivityContactPerson {
  id: number;
  personName: string;
  title: string | null;
  departmentName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
}

export interface MonthActivity extends UpcomingActivity {
  contacts: ActivityContactPerson[];
}

/** 월 단위 일정 조회(모바일 캘린더용) — month='YYYY-MM'. scheduled_at 은 KST 벽시계 문자열. */
export async function listActivitiesByMonth(month: string): Promise<MonthActivity[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.activity_id, a.project_id, a.activity_type, a.scheduled_at, a.ended_at, a.summary,
              p.title, f.company_name AS facility_name,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', cp.id, 'personName', cp.person_name, 'title', cp.title,
                         'departmentName', cd.department_name,
                         'mobilePhone', cp.mobile_phone, 'officePhone', cp.office_phone)
                       ORDER BY cp.person_name)
                  FROM sales_activity_contacts ac
                  JOIN facility_contact_people cp ON cp.id = ac.person_id
                  LEFT JOIN facility_contact_departments cd ON cd.id = cp.department_id
                 WHERE ac.activity_id = a.activity_id
              ), '[]'::json) AS contacts
         FROM sales_activities a
         JOIN sales_projects p ON p.project_id = a.project_id
         LEFT JOIN facilities f ON f.facility_id = p.facility_id
        WHERE a.status <> 'canceled'
          AND a.scheduled_at IS NOT NULL
          AND substr(a.scheduled_at, 1, 7) = $1
        ORDER BY a.scheduled_at ASC`,
      [month]
    )
  );
  return rows.map((r) => ({
    activityId: String(r.activity_id ?? ""),
    projectId: String(r.project_id ?? ""),
    projectTitle: String(r.title ?? ""),
    facilityName: text(r.facility_name),
    activityType: String(r.activity_type ?? "visit") as SalesActivityType,
    scheduledAt: String(r.scheduled_at ?? ""),
    endedAt: text(r.ended_at),
    summary: text(r.summary),
    contacts: jsonArray<ActivityContactPerson>(r.contacts),
  }));
}

// ── 담당자 정보 관리(facility_contact_people 전사 횡단) ──────────
export interface SalesContact {
  id: number;
  facilityId: string;
  facilityName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  duties: string | null;
  status: string; // active | inactive
  deptType: string | null; // contract(계약) | env(환경)
  appointedAt: string | null;
  transferredAt: string | null;
  resignedAt: string | null;
  updatedAt: string;
}

export async function listSalesContacts(
  filter?: { engagement?: ("contract" | "sales")[] }
): Promise<SalesContact[]> {
  const db = await getDb();
  // 소속 사업장 기준 관계 필터(OR) — 판정 조건은 listFacilities.engagement 와 동일
  // (용역 진행 중 = billing 완료 현황과 같은 미완료 판정).
  const engConds: string[] = [];
  if (filter?.engagement?.includes("contract")) {
    engConds.push(`EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.counterparty_facility_id = p.facility_id
        AND c.deleted_at IS NULL AND c.contract_terminated_at IS NULL
        AND NULLIF(c.permit_issued_at, '') IS NULL
        AND COALESCE((SELECT m.invoice_issued FROM contract_payment_milestones m
                       WHERE m.contract_id = c.contract_id
                       ORDER BY m.stage_order DESC LIMIT 1), 0) = 0)`);
  }
  if (filter?.engagement?.includes("sales")) {
    engConds.push(`EXISTS (
      SELECT 1 FROM sales_projects sp
      WHERE sp.facility_id = p.facility_id
        AND sp.status = 'open' AND sp.stage NOT IN ('won','lost','hold'))`);
  }
  const engWhere = engConds.length ? `WHERE (${engConds.join(" OR ")})` : "";
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.id, p.facility_id, f.company_name AS facility_name,
              p.department_id, d.department_name,
              p.person_name, p.title, p.office_phone, p.mobile_phone, p.email,
              p.duties, p.status, p.dept_type,
              p.appointed_at, p.transferred_at, p.resigned_at, p.updated_at
         FROM facility_contact_people p
         LEFT JOIN facilities f ON f.facility_id = p.facility_id
         LEFT JOIN facility_contact_departments d ON d.id = p.department_id
        ${engWhere}
        ORDER BY (p.status = 'active') DESC, f.company_name ASC, p.person_name ASC
        LIMIT 2000`
    )
  );
  return rows.map((r) => ({
    id: Number(r.id ?? 0),
    facilityId: String(r.facility_id ?? ""),
    facilityName: text(r.facility_name),
    departmentId: r.department_id != null ? Number(r.department_id) : null,
    departmentName: text(r.department_name),
    personName: String(r.person_name ?? ""),
    title: text(r.title),
    officePhone: text(r.office_phone),
    mobilePhone: text(r.mobile_phone),
    email: text(r.email),
    duties: text(r.duties),
    status: String(r.status ?? "active"),
    deptType: text(r.dept_type),
    appointedAt: text(r.appointed_at),
    transferredAt: text(r.transferred_at),
    resignedAt: text(r.resigned_at),
    updatedAt: String(r.updated_at ?? ""),
  }));
}

export async function createSalesProject(input: SalesProjectInput, userId: string | null): Promise<string> {
  const now = new Date().toISOString();
  const projectId = id("sproj");
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO sales_projects
         (project_id, facility_id, title, stage, owner_employee_id, owner_dept_id, contract_id,
          service_category, service_subcategory,
          expected_amount, priority, status, opened_at, closed_at, memo, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
      [
        projectId,
        input.facilityId,
        input.title.trim(),
        input.stage ?? "lead",
        input.ownerEmployeeId ?? null,
        input.ownerDeptId ?? null,
        input.contractId ?? null,
        input.serviceCategory ?? null,
        input.serviceSubcategory ?? null,
        input.expectedAmount ?? null,
        input.priority ?? "normal",
        input.status ?? "open",
        input.openedAt ?? now.slice(0, 10),
        input.closedAt ?? null,
        text(input.memo),
        userId,
        now,
      ]
    );
  });
  return projectId;
}

export async function updateSalesProject(projectId: string, input: SalesProjectInput): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE sales_projects SET
         facility_id = $2, title = $3, stage = $4, owner_employee_id = $5, owner_dept_id = $6,
         contract_id = $7, service_category = $8, service_subcategory = $9,
         expected_amount = $10, priority = $11, status = $12,
         opened_at = $13, closed_at = $14, memo = $15, updated_at = $16
       WHERE project_id = $1`,
      [
        projectId,
        input.facilityId,
        input.title.trim(),
        input.stage ?? "lead",
        input.ownerEmployeeId ?? null,
        input.ownerDeptId ?? null,
        input.contractId ?? null,
        input.serviceCategory ?? null,
        input.serviceSubcategory ?? null,
        input.expectedAmount ?? null,
        input.priority ?? "normal",
        input.status ?? "open",
        input.openedAt ?? null,
        input.closedAt ?? null,
        text(input.memo),
        now,
      ]
    );
  });
}

export async function deleteSalesProject(projectId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM sales_projects WHERE project_id = $1", [projectId]);
  });
}

/** 관계자 전체 교체. */
export async function setProjectMembers(
  projectId: string,
  members: Array<{ employeeId: string; roleLabel?: string }>
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM sales_project_members WHERE project_id = $1", [projectId]);
    const seen = new Set<string>();
    for (const m of members) {
      const empId = (m.employeeId ?? "").trim();
      if (!empId) continue;
      const role = (m.roleLabel ?? "담당").trim() || "담당";
      const key = `${empId}::${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await db.run(
        `INSERT INTO sales_project_members (project_id, employee_id, role_label, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, employee_id, role_label) DO NOTHING`,
        [projectId, empId, role, now]
      );
    }
  });
}

/** 영업건 관계자 선택용 활성 직원 목록(경량). 부서/직급 순. */
export async function listActiveEmployees(): Promise<SalesEmployeeOption[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.dept_id, d.dept_name, p.position_name
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE e.status = 'active'
        ORDER BY COALESCE(d.display_order, 999) ASC, COALESCE(p.rank_order, 0) DESC, e.name ASC`
    )
  );
  return rows.map((row) => ({
    employeeId: String(row.employee_id ?? ""),
    name: String(row.name ?? ""),
    deptId: text(row.dept_id),
    deptName: text(row.dept_name),
    positionName: text(row.position_name),
  }));
}

// ── 진행 단계 자동 분류 ──────────────────────────────────────
// 리드→컨택→입찰→수주/실주를 스케쥴 진행에 따라 자동 판정. (제안·보류는 추후 정의)
// 진행 단계 = 경과(progress_note)가 입력되어 '종료된' 스케쥴 기준으로 산정.
// 미래 예정 스케쥴(경과 미입력)은 단계 산정에서 제외한다.
//   G1 전화/메일 종료 → 컨택, G2 방문/현설 종료 → 제안, G3 견적/제안 종료 → 입찰, G4 투찰 종료 → 입찰(결과 대기).
//   영업 결과: 낙찰→수주, 탈락·거절·중단→실주.
function computeStage(rows: Array<Record<string, unknown>>): SalesStage {
  const result = rows.find((r) => String(r.activity_type) === "result");
  if (result) {
    const br = String(result.bid_result ?? "");
    if (br === "won_bid") return "won";
    if (br === "lost_bid" || br === "facility_declined" || br === "project_halted") return "lost";
    // rebid(재투찰)/미정은 아래 단계 산정으로 폴백
  }
  const G1 = new Set(["telemarketing", "email"]);
  const G2 = new Set(["visit", "site_briefing"]);
  const G3 = new Set(["quote", "proposal_meeting"]);
  let topDone = 0; // 경과 입력(종료)된 스케쥴 중 최고 그룹
  for (const r of rows) {
    const note = String(r.progress_note ?? "").trim();
    if (!note) continue; // 경과 미입력(예정/미종료) → 제외
    const t = String(r.activity_type);
    if (t === "bid") topDone = Math.max(topDone, 4);
    else if (G3.has(t)) topDone = Math.max(topDone, 3);
    else if (G2.has(t)) topDone = Math.max(topDone, 2);
    else if (G1.has(t)) topDone = Math.max(topDone, 1);
  }
  switch (topDone) {
    case 4:
    case 3:
      return "bidding";
    case 2:
      return "proposal";
    case 1:
      return "contact";
    default:
      return "lead";
  }
}

async function recomputeProjectStage(
  db: { run: (sql: string, p?: unknown[]) => Promise<unknown>; exec: (sql: string, p?: unknown[]) => Promise<Array<{ columns: string[]; values: unknown[][] }>> },
  projectId: string,
  now: string
): Promise<void> {
  const rows = rowsToObjects(await db.exec("SELECT activity_type, bid_result, progress_note FROM sales_activities WHERE project_id = $1", [projectId]));
  const stage = computeStage(rows);
  await db.run("UPDATE sales_projects SET stage = $2, updated_at = $3 WHERE project_id = $1", [projectId, stage, now]);
}

// ── 활동(타임라인) ───────────────────────────────────────────

function mapActivity(row: Record<string, unknown>): SalesActivity {
  return {
    activityId: String(row.activity_id ?? ""),
    projectId: String(row.project_id ?? ""),
    activityType: (String(row.activity_type ?? "visit") as SalesActivityType),
    status: (String(row.status ?? "done") as SalesActivity["status"]),
    scheduledAt: text(row.scheduled_at),
    endedAt: text(row.ended_at),
    occurredAt: text(row.occurred_at),
    place: text(row.place),
    summary: text(row.summary),
    progressNote: text(row.progress_note),
    quoteAmount: num(row.quote_amount),
    bidAmount: num(row.bid_amount),
    quotes: jsonArray<ActivityQuote>(row.quotes),
    bids: jsonArray<ActivityBid>(row.bids),
    bidResult: (text(row.bid_result) as SalesBidResult | null),
    color: text(row.color),
    authorEmployeeId: text(row.author_employee_id),
    authorName: text(row.author_name),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listActivities(projectId: string, filter: SalesActivityFilter = {}): Promise<SalesActivity[]> {
  const where: string[] = ["a.project_id = $1"];
  const params: unknown[] = [projectId];
  if (filter.activityType) { params.push(filter.activityType); where.push(`a.activity_type = $${params.length}`); }
  if (filter.authorEmployeeId) { params.push(filter.authorEmployeeId); where.push(`a.author_employee_id = $${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`a.status = $${params.length}`); }
  if (filter.year) {
    params.push(String(filter.year));
    where.push(`substr(COALESCE(a.occurred_at, a.scheduled_at, a.created_at), 1, 4) = $${params.length}`);
  }

  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.activity_id, a.project_id, a.activity_type, a.status, a.scheduled_at, a.ended_at, a.occurred_at,
              a.place, a.summary, a.progress_note, a.quote_amount, a.bid_amount, a.quotes, a.bids,
              a.bid_result, a.color, a.author_employee_id,
              e.name AS author_name, a.created_at, a.updated_at
         FROM sales_activities a
         LEFT JOIN employee_profiles e ON e.employee_id = a.author_employee_id
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(a.occurred_at, a.scheduled_at, a.created_at) DESC, a.created_at DESC`,
      params
    )
  ).map(mapActivity);

  // 만난 사람·담당인력 일괄 로드 후 활동별로 묶는다(N+1 회피).
  if (rows.length) {
    const ids = rows.map((r) => r.activityId);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const contactRows = rowsToObjects(
      await db.exec(
        `SELECT sac.activity_id, sac.person_id, p.person_name, p.title
           FROM sales_activity_contacts sac
           LEFT JOIN facility_contact_people p ON p.id = sac.person_id
          WHERE sac.activity_id IN (${placeholders})`,
        ids
      )
    );
    const byContact = new Map<string, SalesActivityContact[]>();
    for (const c of contactRows) {
      const aid = String(c.activity_id ?? "");
      const list = byContact.get(aid) ?? [];
      list.push({ personId: Number(c.person_id ?? 0), personName: text(c.person_name), title: text(c.title) });
      byContact.set(aid, list);
    }
    const assigneeRows = rowsToObjects(
      await db.exec(
        `SELECT saa.activity_id, saa.employee_id, saa.role_kind, e.name AS employee_name, e.photo_public_path
           FROM sales_activity_assignees saa
           LEFT JOIN employee_profiles e ON e.employee_id = saa.employee_id
          WHERE saa.activity_id IN (${placeholders})`,
        ids
      )
    );
    const byAssignee = new Map<string, SalesActivityAssignee[]>();
    for (const r of assigneeRows) {
      const aid = String(r.activity_id ?? "");
      const list = byAssignee.get(aid) ?? [];
      list.push({
        employeeId: String(r.employee_id ?? ""),
        employeeName: text(r.employee_name),
        photoPath: text(r.photo_public_path),
        roleKind: String(r.role_kind ?? "lead") as SalesActivityAssignee["roleKind"],
      });
      byAssignee.set(aid, list);
    }
    for (const r of rows) {
      r.contacts = byContact.get(r.activityId) ?? [];
      r.assignees = byAssignee.get(r.activityId) ?? [];
    }
  }
  return rows;
}

export async function createActivity(
  projectId: string,
  input: SalesActivityInput,
  userId: string | null
): Promise<string> {
  const now = new Date().toISOString();
  const activityId = id("sact");
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO sales_activities
         (activity_id, project_id, activity_type, status, scheduled_at, ended_at, occurred_at, place, summary,
          progress_note, quote_amount, bid_amount, quotes, bids, bid_result, color,
          author_employee_id, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$19)`,
      [
        activityId,
        projectId,
        input.activityType,
        input.status ?? "done",
        input.scheduledAt ?? null,
        input.endedAt ?? null,
        input.occurredAt ?? (input.status === "planned" ? null : now),
        text(input.place),
        text(input.summary),
        text(input.progressNote),
        input.quoteAmount ?? null,
        input.bidAmount ?? null,
        input.quotes ? JSON.stringify(input.quotes) : null,
        input.bids ? JSON.stringify(input.bids) : null,
        input.bidResult ?? null,
        input.color ?? null,
        input.authorEmployeeId ?? null,
        userId,
        now,
      ]
    );
    await replaceActivityContacts(db, activityId, input.contactPersonIds ?? []);
    await replaceActivityAssignees(db, activityId, input.assignees ?? [], now);
    await recomputeProjectStage(db, projectId, now);
  });
  return activityId;
}

export async function updateActivity(activityId: string, input: SalesActivityInput): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE sales_activities SET
         activity_type = $2, status = $3, scheduled_at = $4, ended_at = $5, occurred_at = $6, place = $7,
         summary = $8, progress_note = $9, quote_amount = $10, bid_amount = $11,
         quotes = $12::jsonb, bids = $13::jsonb, bid_result = $14, color = $15,
         author_employee_id = $16, updated_at = $17
       WHERE activity_id = $1`,
      [
        activityId,
        input.activityType,
        input.status ?? "done",
        input.scheduledAt ?? null,
        input.endedAt ?? null,
        input.occurredAt ?? null,
        text(input.place),
        text(input.summary),
        text(input.progressNote),
        input.quoteAmount ?? null,
        input.bidAmount ?? null,
        input.quotes ? JSON.stringify(input.quotes) : null,
        input.bids ? JSON.stringify(input.bids) : null,
        input.bidResult ?? null,
        input.color ?? null,
        input.authorEmployeeId ?? null,
        now,
      ]
    );
    if (input.contactPersonIds) {
      await replaceActivityContacts(db, activityId, input.contactPersonIds);
    }
    if (input.assignees) {
      await replaceActivityAssignees(db, activityId, input.assignees, now);
    }
    const pr = rowsToObjects(await db.exec("SELECT project_id FROM sales_activities WHERE activity_id = $1", [activityId]));
    if (pr[0]?.project_id) await recomputeProjectStage(db, String(pr[0].project_id), now);
  });
}

/** 경과(progress_note)만 갱신 — 모바일 경과 입력용. 다른 필드는 건드리지 않고 단계만 재계산. */
export async function updateActivityProgress(activityId: string, progressNote: string): Promise<boolean> {
  const now = new Date().toISOString();
  let found = false;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec("SELECT project_id FROM sales_activities WHERE activity_id = $1", [activityId])
    );
    if (!rows.length) return;
    found = true;
    await db.run(
      `UPDATE sales_activities SET progress_note = $2, status = 'done', updated_at = $3 WHERE activity_id = $1`,
      [activityId, progressNote, now]
    );
    await recomputeProjectStage(db, String(rows[0].project_id), now);
  });
  return found;
}

export async function deleteActivity(activityId: string): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    const pr = rowsToObjects(await db.exec("SELECT project_id FROM sales_activities WHERE activity_id = $1", [activityId]));
    const projectId = pr[0]?.project_id ? String(pr[0].project_id) : null;
    await db.run("DELETE FROM sales_activities WHERE activity_id = $1", [activityId]);
    if (projectId) await recomputeProjectStage(db, projectId, now);
  });
}

async function replaceActivityContacts(
  db: { run: (sql: string, params?: unknown[]) => Promise<unknown> },
  activityId: string,
  personIds: number[]
): Promise<void> {
  await db.run("DELETE FROM sales_activity_contacts WHERE activity_id = $1", [activityId]);
  const seen = new Set<number>();
  for (const pid of personIds) {
    const n = Number(pid);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    await db.run(
      `INSERT INTO sales_activity_contacts (activity_id, person_id) VALUES ($1, $2)
       ON CONFLICT (activity_id, person_id) DO NOTHING`,
      [activityId, n]
    );
  }
}

async function replaceActivityAssignees(
  db: { run: (sql: string, params?: unknown[]) => Promise<unknown> },
  activityId: string,
  assignees: { employeeId: string; roleKind: ActivityAssigneeRole }[],
  now: string
): Promise<void> {
  await db.run("DELETE FROM sales_activity_assignees WHERE activity_id = $1", [activityId]);
  const seen = new Set<string>();
  for (const a of assignees) {
    const emp = (a.employeeId ?? "").trim();
    if (!emp || !a.roleKind) continue;
    const key = `${emp}::${a.roleKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.run(
      `INSERT INTO sales_activity_assignees (activity_id, employee_id, role_kind, created_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT (activity_id, employee_id, role_kind) DO NOTHING`,
      [activityId, emp, a.roleKind, now]
    );
  }
}

// ── KPI(파생 집계) ───────────────────────────────────────────

export async function computeProjectKpi(projectId: string): Promise<SalesProjectKpi> {
  const db = await getDb();

  const activityCounts = Object.fromEntries(
    Object.keys(ACTIVITY_TYPE_META).map((k) => [k, 0])
  ) as Record<SalesActivityType, number>;
  const countRows = rowsToObjects(
    await db.exec(
      `SELECT activity_type, count(*) AS cnt FROM sales_activities
        WHERE project_id = $1 AND status = 'done' GROUP BY activity_type`,
      [projectId]
    )
  );
  for (const r of countRows) {
    const t = String(r.activity_type ?? "") as SalesActivityType;
    if (t in activityCounts) activityCounts[t] = Number(r.cnt ?? 0);
  }

  const contactRows = rowsToObjects(
    await db.exec(
      `SELECT count(DISTINCT c.person_id) AS cnt
         FROM sales_activity_contacts c
         JOIN sales_activities a ON a.activity_id = c.activity_id
        WHERE a.project_id = $1`,
      [projectId]
    )
  );
  const contactCount = Number(contactRows[0]?.cnt ?? 0);

  const projRows = rowsToObjects(
    await db.exec("SELECT stage, contract_id FROM sales_projects WHERE project_id = $1 LIMIT 1", [projectId])
  );
  const stage = String(projRows[0]?.stage ?? "");
  const contractCount = projRows[0]?.contract_id != null ? 1 : 0;

  return {
    activityCounts,
    contactCount,
    isWon: stage === "won",
    contractCount,
    hasInvestmentPlan: false, // P4(DART/뉴스 발굴) 연동 전까지 false
  };
}
