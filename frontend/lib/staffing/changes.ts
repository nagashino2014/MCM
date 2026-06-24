import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const CHANGE_KINDS = [
  { value: "join", label: "합류" },
  { value: "leave", label: "이탈" },
  { value: "role_change", label: "역할 변경" },
  { value: "replace", label: "교체" },
] as const;

export interface ChangeRow {
  changeId: string;
  employeeId: string;
  employeeName: string;
  changeKind: string;
  effectiveOn: string;
  roleLabelBefore: string | null;
  roleLabelAfter: string | null;
  replacedEmployeeId: string | null;
  replacedEmployeeName: string | null;
  reason: string | null;
  recordedAt: string;
}

export interface ChangeInput {
  employeeId: string;
  changeKind: string;
  effectiveOn: string;
  roleLabelBefore?: string | null;
  roleLabelAfter?: string | null;
  replacedEmployeeId?: string | null;
  reason?: string | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listContractChanges(contractId: string): Promise<ChangeRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT ch.change_id, ch.employee_id, e.name AS employee_name, ch.change_kind, ch.effective_on,
            ch.role_label_before, ch.role_label_after, ch.replaced_employee_id,
            re.name AS replaced_name, ch.reason, ch.recorded_at
       FROM service_participation_changes ch
       JOIN employee_profiles e ON e.employee_id = ch.employee_id
       LEFT JOIN employee_profiles re ON re.employee_id = ch.replaced_employee_id
      WHERE ch.contract_id = $1
      ORDER BY ch.effective_on DESC, ch.recorded_at DESC`,
    [contractId]
  );
  return rowsToObjects(result).map((row) => ({
    changeId: String(row.change_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    employeeName: String(row.employee_name ?? ""),
    changeKind: String(row.change_kind ?? "join"),
    effectiveOn: String(row.effective_on ?? ""),
    roleLabelBefore: row.role_label_before != null ? String(row.role_label_before) : null,
    roleLabelAfter: row.role_label_after != null ? String(row.role_label_after) : null,
    replacedEmployeeId: row.replaced_employee_id != null ? String(row.replaced_employee_id) : null,
    replacedEmployeeName: row.replaced_name != null ? String(row.replaced_name) : null,
    reason: row.reason != null ? String(row.reason) : null,
    recordedAt: String(row.recorded_at ?? ""),
  }));
}

export async function createChange(actorUserId: string, contractId: string, input: ChangeInput): Promise<string> {
  const changeId = id("spc");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO service_participation_changes
         (change_id, contract_id, employee_id, change_kind, effective_on, role_label_before, role_label_after, replaced_employee_id, reason, recorded_by, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        changeId,
        contractId,
        input.employeeId,
        input.changeKind,
        input.effectiveOn,
        input.roleLabelBefore || null,
        input.roleLabelAfter || null,
        input.replacedEmployeeId || null,
        input.reason || null,
        actorUserId,
        now,
      ]
    );
  });
  return changeId;
}

export async function deleteChange(changeId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM service_participation_changes WHERE change_id = $1", [changeId]);
  });
}
