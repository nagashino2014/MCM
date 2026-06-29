import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  SALES_ACTIVITY_TYPE_LABELS,
  type SalesActivity,
  type SalesActivityContact,
  type SalesActivityFilter,
  type SalesActivityInput,
  type SalesActivityType,
  type SalesProject,
  type SalesProjectFilter,
  type SalesProjectInput,
  type SalesProjectKpi,
  type SalesProjectMember,
  type SalesEmployeeOption,
} from "./types";

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
    expectedAmount: num(row.expected_amount),
    priority: (String(row.priority ?? "normal") as SalesProject["priority"]),
    status: (String(row.status ?? "open") as SalesProject["status"]),
    openedAt: text(row.opened_at),
    closedAt: text(row.closed_at),
    memo: text(row.memo),
    createdBy: text(row.created_by),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const PROJECT_SELECT = `
  SELECT p.project_id, p.facility_id, f.company_name AS facility_name, p.title, p.stage,
         p.owner_employee_id, e.name AS owner_employee_name, p.owner_dept_id, p.contract_id,
         p.expected_amount, p.priority, p.status, p.opened_at, p.closed_at, p.memo,
         p.created_by, p.created_at, p.updated_at
    FROM sales_projects p
    LEFT JOIN facilities f ON f.facility_id = p.facility_id
    LEFT JOIN employee_profiles e ON e.employee_id = p.owner_employee_id`;

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
  return rowsToObjects(await db.exec(sql, params)).map(mapProject);
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
      `SELECT m.id, m.project_id, m.employee_id, e.name AS employee_name, m.role_label, m.created_at
         FROM sales_project_members m
         LEFT JOIN employee_profiles e ON e.employee_id = m.employee_id
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
    roleLabel: String(row.role_label ?? "담당"),
    createdAt: String(row.created_at ?? ""),
  }));
}

export async function createSalesProject(input: SalesProjectInput, userId: string | null): Promise<string> {
  const now = new Date().toISOString();
  const projectId = id("sproj");
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO sales_projects
         (project_id, facility_id, title, stage, owner_employee_id, owner_dept_id, contract_id,
          expected_amount, priority, status, opened_at, closed_at, memo, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [
        projectId,
        input.facilityId,
        input.title.trim(),
        input.stage ?? "lead",
        input.ownerEmployeeId ?? null,
        input.ownerDeptId ?? null,
        input.contractId ?? null,
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
         contract_id = $7, expected_amount = $8, priority = $9, status = $10,
         opened_at = $11, closed_at = $12, memo = $13, updated_at = $14
       WHERE project_id = $1`,
      [
        projectId,
        input.facilityId,
        input.title.trim(),
        input.stage ?? "lead",
        input.ownerEmployeeId ?? null,
        input.ownerDeptId ?? null,
        input.contractId ?? null,
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

// ── 활동(타임라인) ───────────────────────────────────────────

function mapActivity(row: Record<string, unknown>): SalesActivity {
  return {
    activityId: String(row.activity_id ?? ""),
    projectId: String(row.project_id ?? ""),
    activityType: (String(row.activity_type ?? "other") as SalesActivityType),
    status: (String(row.status ?? "done") as SalesActivity["status"]),
    scheduledAt: text(row.scheduled_at),
    occurredAt: text(row.occurred_at),
    place: text(row.place),
    summary: text(row.summary),
    quoteAmount: num(row.quote_amount),
    bidAmount: num(row.bid_amount),
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
      `SELECT a.activity_id, a.project_id, a.activity_type, a.status, a.scheduled_at, a.occurred_at,
              a.place, a.summary, a.quote_amount, a.bid_amount, a.author_employee_id,
              e.name AS author_name, a.created_at, a.updated_at
         FROM sales_activities a
         LEFT JOIN employee_profiles e ON e.employee_id = a.author_employee_id
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(a.occurred_at, a.scheduled_at, a.created_at) DESC, a.created_at DESC`,
      params
    )
  ).map(mapActivity);

  // 만난 사람(연락처 마스터) 일괄 로드 후 활동별로 묶는다(N+1 회피).
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
    const byActivity = new Map<string, SalesActivityContact[]>();
    for (const c of contactRows) {
      const aid = String(c.activity_id ?? "");
      const list = byActivity.get(aid) ?? [];
      list.push({ personId: Number(c.person_id ?? 0), personName: text(c.person_name), title: text(c.title) });
      byActivity.set(aid, list);
    }
    for (const r of rows) r.contacts = byActivity.get(r.activityId) ?? [];
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
         (activity_id, project_id, activity_type, status, scheduled_at, occurred_at, place, summary,
          quote_amount, bid_amount, author_employee_id, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [
        activityId,
        projectId,
        input.activityType,
        input.status ?? "done",
        input.scheduledAt ?? null,
        input.occurredAt ?? (input.status === "planned" ? null : now),
        text(input.place),
        text(input.summary),
        input.quoteAmount ?? null,
        input.bidAmount ?? null,
        input.authorEmployeeId ?? null,
        userId,
        now,
      ]
    );
    await replaceActivityContacts(db, activityId, input.contactPersonIds ?? []);
    await db.run("UPDATE sales_projects SET updated_at = $2 WHERE project_id = $1", [projectId, now]);
  });
  return activityId;
}

export async function updateActivity(activityId: string, input: SalesActivityInput): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE sales_activities SET
         activity_type = $2, status = $3, scheduled_at = $4, occurred_at = $5, place = $6,
         summary = $7, quote_amount = $8, bid_amount = $9, author_employee_id = $10, updated_at = $11
       WHERE activity_id = $1`,
      [
        activityId,
        input.activityType,
        input.status ?? "done",
        input.scheduledAt ?? null,
        input.occurredAt ?? null,
        text(input.place),
        text(input.summary),
        input.quoteAmount ?? null,
        input.bidAmount ?? null,
        input.authorEmployeeId ?? null,
        now,
      ]
    );
    if (input.contactPersonIds) {
      await replaceActivityContacts(db, activityId, input.contactPersonIds);
    }
  });
}

export async function deleteActivity(activityId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM sales_activities WHERE activity_id = $1", [activityId]);
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

// ── KPI(파생 집계) ───────────────────────────────────────────

export async function computeProjectKpi(projectId: string): Promise<SalesProjectKpi> {
  const db = await getDb();

  const activityCounts = Object.fromEntries(
    Object.keys(SALES_ACTIVITY_TYPE_LABELS).map((k) => [k, 0])
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
