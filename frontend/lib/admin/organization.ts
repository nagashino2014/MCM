import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export interface DepartmentRow {
  deptId: string;
  deptName: string;
  deptKind: string;
  parentDeptId: string | null;
  displayOrder: number;
  accentColor: string | null;
  isActive: boolean;
}

export interface PositionRow {
  positionId: string;
  positionName: string;
  rankOrder: number;
  isActive: boolean;
}

export interface OrganizationEmployeeRow {
  employeeId: string;
  userId: string | null;
  name: string;
  deptId: string | null;
  positionId: string | null;
  positionName: string | null;
  positionRankOrder: number | null;
  email: string | null;
  status: "active" | "inactive";
}

export interface OrganizationSnapshot {
  departments: DepartmentRow[];
  positions: PositionRow[];
  departmentPositions: Array<{ deptId: string; positionId: string; displayOrder: number }>;
  employees: OrganizationEmployeeRow[];
}

export interface DepartmentInput {
  deptId?: string;
  deptName: string;
  deptKind: string;
  parentDeptId?: string | null;
  displayOrder?: number;
  accentColor?: string | null;
  isActive?: boolean;
  positionIds?: string[];
}

function boolInt(value: unknown): boolean {
  return Number(value ?? 0) === 1 || value === true;
}

function cleanId(prefix: string, value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${prefix}-${base || crypto.randomBytes(4).toString("hex")}`;
}

export async function listOrganizationSnapshot(): Promise<OrganizationSnapshot> {
  const db = await getDb();
  const [departmentsResult, positionsResult, departmentPositionsResult, employeesResult] =
    await Promise.all([
      db.exec(
        "SELECT dept_id, dept_name, dept_kind, parent_dept_id, display_order, accent_color, is_active FROM departments ORDER BY display_order ASC, dept_name ASC"
      ),
      db.exec(
        "SELECT position_id, position_name, rank_order, is_active FROM positions ORDER BY rank_order DESC, position_name ASC"
      ),
      db.exec(
        "SELECT dept_id, position_id, display_order FROM department_positions ORDER BY dept_id ASC, display_order DESC"
      ),
      db.exec(
        `SELECT e.employee_id, e.user_id, e.employee_no, e.name, e.dept_id, e.position_id, p.position_name, p.rank_order,
                e.email, e.status, e.hired_at, e.gender, (e.birth_date IS NOT NULL) AS has_birth_date, e.photo_public_path
           FROM employee_profiles e
           LEFT JOIN positions p ON p.position_id = e.position_id
          ORDER BY p.rank_order DESC NULLS LAST, e.name ASC`
      ),
    ]);

  return {
    departments: rowsToObjects(departmentsResult).map((row) => ({
      deptId: String(row.dept_id ?? ""),
      deptName: String(row.dept_name ?? ""),
      deptKind: String(row.dept_kind ?? "division"),
      parentDeptId: row.parent_dept_id != null ? String(row.parent_dept_id) : null,
      displayOrder: Number(row.display_order ?? 100),
      accentColor: row.accent_color != null ? String(row.accent_color) : null,
      isActive: boolInt(row.is_active),
    })),
    positions: rowsToObjects(positionsResult).map((row) => ({
      positionId: String(row.position_id ?? ""),
      positionName: String(row.position_name ?? ""),
      rankOrder: Number(row.rank_order ?? 0),
      isActive: boolInt(row.is_active),
    })),
    departmentPositions: rowsToObjects(departmentPositionsResult).map((row) => ({
      deptId: String(row.dept_id ?? ""),
      positionId: String(row.position_id ?? ""),
      displayOrder: Number(row.display_order ?? 100),
    })),
    employees: rowsToObjects(employeesResult).map((row) => ({
      employeeId: String(row.employee_id ?? ""),
      userId: row.user_id != null ? String(row.user_id) : null,
      employeeNo: row.employee_no != null ? String(row.employee_no) : null,
      name: String(row.name ?? ""),
      deptId: row.dept_id != null ? String(row.dept_id) : null,
      positionId: row.position_id != null ? String(row.position_id) : null,
      positionName: row.position_name != null ? String(row.position_name) : null,
      positionRankOrder: row.rank_order != null ? Number(row.rank_order) : null,
      email: row.email != null ? String(row.email) : null,
      status: (String(row.status ?? "active") as "active" | "inactive"),
      hiredAt: row.hired_at != null ? String(row.hired_at) : null,
      gender: row.gender != null ? (String(row.gender) as "male" | "female") : null,
      hasBirthDate: Boolean(row.has_birth_date),
      photoPath: row.photo_public_path != null ? String(row.photo_public_path) : null,
    })),
  };
}

export async function saveDepartment(input: DepartmentInput): Promise<DepartmentRow> {
  const deptName = input.deptName.trim();
  if (!deptName) throw new Error("부서명이 필요합니다.");
  const deptId = input.deptId?.trim() || cleanId("dept", deptName);
  const now = new Date().toISOString();
  const saved = await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO departments (dept_id, dept_name, dept_kind, parent_dept_id, display_order, accent_color, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (dept_id) DO UPDATE SET
         dept_name = EXCLUDED.dept_name,
         dept_kind = EXCLUDED.dept_kind,
         parent_dept_id = EXCLUDED.parent_dept_id,
         display_order = EXCLUDED.display_order,
         accent_color = EXCLUDED.accent_color,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [
        deptId,
        deptName,
        input.deptKind || "division",
        input.parentDeptId || null,
        input.displayOrder ?? 100,
        input.accentColor || null,
        input.isActive === false ? 0 : 1,
        now,
      ]
    );

    if (input.positionIds) {
      await db.run("DELETE FROM department_positions WHERE dept_id = $1", [deptId]);
      for (const [index, positionId] of input.positionIds.entries()) {
        await db.run(
          "INSERT INTO department_positions (dept_id, position_id, display_order) VALUES ($1, $2, $3) ON CONFLICT (dept_id, position_id) DO UPDATE SET display_order = EXCLUDED.display_order",
          [deptId, positionId, 1000 - index]
        );
      }
    }

    return {
      deptId,
      deptName,
      deptKind: input.deptKind || "division",
      parentDeptId: input.parentDeptId || null,
      displayOrder: input.displayOrder ?? 100,
      accentColor: input.accentColor || null,
      isActive: input.isActive !== false,
    } satisfies DepartmentRow;
  });
  return saved;
}

export async function savePosition(input: {
  positionId?: string;
  positionName: string;
  rankOrder?: number;
  isActive?: boolean;
}): Promise<PositionRow> {
  const positionName = input.positionName.trim();
  if (!positionName) throw new Error("직급명이 필요합니다.");
  const positionId = input.positionId?.trim() || cleanId("pos", positionName);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO positions (position_id, position_name, rank_order, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (position_id) DO UPDATE SET
         position_name = EXCLUDED.position_name,
         rank_order = EXCLUDED.rank_order,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [positionId, positionName, input.rankOrder ?? 10, input.isActive === false ? 0 : 1, now]
    );
  });
  return {
    positionId,
    positionName,
    rankOrder: input.rankOrder ?? 10,
    isActive: input.isActive !== false,
  };
}

export async function deletePosition(positionId: string): Promise<void> {
  if (!positionId) throw new Error("positionId가 필요합니다.");
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM positions WHERE position_id = $1", [positionId]);
  });
}
