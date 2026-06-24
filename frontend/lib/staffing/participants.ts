import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export interface ServiceParticipantRow {
  participationId: string;
  employeeId: string;
  employeeName: string;
  positionName: string | null;
  deptId: string | null;
  deptName: string | null;
  roleLabel: string;
  fieldLabel: string | null;
  source: string;
}

export interface ServiceParticipantInput {
  employeeId: string;
  roleLabel: string;
  fieldLabel?: string | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listContractParticipants(
  contractId: string
): Promise<ServiceParticipantRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT sp.participation_id, sp.employee_id, e.name AS employee_name,
            p.position_name, e.dept_id, d.dept_name, sp.role_label, sp.field_label, sp.source
       FROM service_participants sp
       JOIN employee_profiles e ON e.employee_id = sp.employee_id
       LEFT JOIN positions p ON p.position_id = e.position_id
       LEFT JOIN departments d ON d.dept_id = e.dept_id
      WHERE sp.contract_id = $1
      ORDER BY p.rank_order DESC NULLS LAST, e.name ASC`,
    [contractId]
  );
  return rowsToObjects(result).map((row) => ({
    participationId: String(row.participation_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    employeeName: String(row.employee_name ?? ""),
    positionName: row.position_name != null ? String(row.position_name) : null,
    deptId: row.dept_id != null ? String(row.dept_id) : null,
    deptName: row.dept_name != null ? String(row.dept_name) : null,
    roleLabel: String(row.role_label ?? "실무"),
    fieldLabel: row.field_label != null ? String(row.field_label) : null,
    source: String(row.source ?? "manual"),
  }));
}

/**
 * 계약의 수기(manual) 수행인력을 전체 교체한다.
 * 업무보고 자동 집계(source='work_plan')로 들어온 행은 건드리지 않는다.
 */
export async function saveContractParticipants(
  contractId: string,
  items: ServiceParticipantInput[]
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      "DELETE FROM service_participants WHERE contract_id = $1 AND source = 'manual'",
      [contractId]
    );
    for (const item of items) {
      if (!item.employeeId) continue;
      await db.run(
        `INSERT INTO service_participants
           (participation_id, contract_id, employee_id, role_label, field_label, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', $6, $6)
         ON CONFLICT (contract_id, employee_id, role_label) DO UPDATE SET
           field_label = EXCLUDED.field_label,
           source = 'manual',
           updated_at = EXCLUDED.updated_at`,
        [id("sp"), contractId, item.employeeId, item.roleLabel || "실무", item.fieldLabel || null, now]
      );
    }
  });
}
