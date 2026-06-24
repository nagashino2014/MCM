import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ServiceParticipantRow, ServiceParticipantInput } from "@/lib/staffing/participants";

// Task 수행인력은 service_participants 와 동일 형태(키만 task_id)를 반환한다.
function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listTaskParticipants(taskId: string): Promise<ServiceParticipantRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT sp.participation_id, sp.employee_id, e.name AS employee_name,
            p.position_name, e.dept_id, d.dept_name, sp.role_label, sp.field_label, sp.source
       FROM work_task_participants sp
       JOIN employee_profiles e ON e.employee_id = sp.employee_id
       LEFT JOIN positions p ON p.position_id = e.position_id
       LEFT JOIN departments d ON d.dept_id = e.dept_id
      WHERE sp.task_id = $1
      ORDER BY p.rank_order DESC NULLS LAST, e.name ASC`,
    [taskId]
  );
  return rowsToObjects(result).map((row) => ({
    participationId: String(row.participation_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    employeeName: String(row.employee_name ?? ""),
    positionName: row.position_name != null ? String(row.position_name) : null,
    deptId: row.dept_id != null ? String(row.dept_id) : null,
    deptName: row.dept_name != null ? String(row.dept_name) : null,
    roleLabel: String(row.role_label ?? "실무자1"),
    fieldLabel: row.field_label != null ? String(row.field_label) : null,
    source: String(row.source ?? "manual"),
  }));
}

export async function saveTaskParticipants(taskId: string, items: ServiceParticipantInput[]): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM work_task_participants WHERE task_id = $1 AND source = 'manual'", [taskId]);
    for (const item of items) {
      if (!item.employeeId) continue;
      await db.run(
        `INSERT INTO work_task_participants
           (participation_id, task_id, employee_id, role_label, field_label, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', $6, $6)
         ON CONFLICT (task_id, employee_id, role_label) DO UPDATE SET
           field_label = EXCLUDED.field_label,
           source = 'manual',
           updated_at = EXCLUDED.updated_at`,
        [id("wtp"), taskId, item.employeeId, item.roleLabel || "실무자1", item.fieldLabel || null, now]
      );
    }
  });
}
