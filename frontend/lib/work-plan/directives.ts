import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const DIRECTIVE_KINDS = [
  { value: "supplement_request", label: "보완 요구" },
  { value: "expedite", label: "진행 촉구" },
  { value: "additional_report", label: "추가보고 지시" },
  { value: "opinion", label: "의견" },
  { value: "confirm", label: "확인" },
] as const;

export interface DirectiveRow {
  directiveId: string;
  contractId: string | null;
  contractTitle: string | null;
  level: string;
  kind: string;
  message: string | null;
  status: string;
  createdAt: string;
}

export interface DirectiveInput {
  contractId?: string | null;
  level?: string;
  kind: string;
  message?: string | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/** 한 부서의 용역에 내려진 지시 이력 (계약의 owning_dept_id 로 귀속). */
export async function listDirectivesByDept(deptId: string, level?: string): Promise<DirectiveRow[]> {
  const db = await getDb();
  const params: unknown[] = [deptId];
  let levelSql = "";
  if (level) {
    params.push(level);
    levelSql = ` AND d.level = $${params.length}`;
  }
  const result = await db.exec(
    `SELECT d.directive_id, d.contract_id, c.contract_title, d.level, d.kind, d.message, d.status, d.created_at
       FROM work_plan_directives d
       JOIN contracts c ON c.contract_id = d.contract_id
      WHERE c.owning_dept_id = $1${levelSql}
      ORDER BY d.created_at DESC`,
    params
  );
  return rowsToObjects(result).map((row) => ({
    directiveId: String(row.directive_id ?? ""),
    contractId: row.contract_id != null ? String(row.contract_id) : null,
    contractTitle: row.contract_title != null ? String(row.contract_title) : null,
    level: String(row.level ?? "exec"),
    kind: String(row.kind ?? "opinion"),
    message: row.message != null ? String(row.message) : null,
    status: String(row.status ?? "open"),
    createdAt: String(row.created_at ?? ""),
  }));
}

export async function createDirective(actorUserId: string, input: DirectiveInput): Promise<string> {
  const directiveId = id("wpd");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO work_plan_directives
         (directive_id, contract_id, level, kind, message, issued_by, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
      [directiveId, input.contractId || null, input.level || "exec", input.kind, input.message || null, actorUserId, now]
    );
  });
  return directiveId;
}

export async function updateDirectiveStatus(issueActorUserId: string, directiveId: string, status: string): Promise<void> {
  const now = new Date().toISOString();
  const col = status === "resolved" ? "resolved_at" : "acknowledged_at";
  await withDbWrite(async (db) => {
    await db.run(`UPDATE work_plan_directives SET status = $1, ${col} = $2 WHERE directive_id = $3`, [status, now, directiveId]);
  });
}
