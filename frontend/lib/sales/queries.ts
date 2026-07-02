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

// ── 진행 단계 자동 분류 ──────────────────────────────────────
// 리드→컨택→입찰→수주/실주를 스케쥴 진행에 따라 자동 판정. (제안·보류는 추후 정의)
function computeStage(rows: Array<Record<string, unknown>>): SalesStage {
  const result = rows.find((r) => String(r.activity_type) === "result");
  if (result) {
    const br = String(result.bid_result ?? "");
    if (br === "won_bid") return "won";
    if (br === "lost_bid") return "lost";
  }
  if (rows.some((r) => String(r.activity_type) === "bid")) return "bidding";
  const contactTypes = new Set(["visit", "site_briefing", "quote", "proposal_meeting"]);
  if (rows.some((r) => contactTypes.has(String(r.activity_type)))) return "contact";
  return "lead";
}

async function recomputeProjectStage(
  db: { run: (sql: string, p?: unknown[]) => Promise<unknown>; exec: (sql: string, p?: unknown[]) => Promise<Array<{ columns: string[]; values: unknown[][] }>> },
  projectId: string,
  now: string
): Promise<void> {
  const rows = rowsToObjects(await db.exec("SELECT activity_type, bid_result FROM sales_activities WHERE project_id = $1", [projectId]));
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
