import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export interface EvaluationRow {
  contractId: string;
  contractTitle: string;
  employeeId: string;
  employeeName: string;
  roleLabel: string;
  participationPct: number;
  rating: number;
  ratingMemo: string | null;
  finalized: boolean;
}

export interface EvaluationInput {
  contractId: string;
  employeeId: string;
  participationPct?: number;
  rating?: number;
  ratingMemo?: string | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/** 부서 활성 계약 × 수행인력 행 + 해당 반기 평점(있으면). */
export async function listEvaluationBoard(deptId: string, year: number, half: string): Promise<EvaluationRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT c.contract_id, c.contract_title, sp.employee_id, e.name AS employee_name, sp.role_label,
            ev.participation_pct, ev.rating, ev.rating_memo, ev.finalized_at
       FROM contracts c
       JOIN service_participants sp ON sp.contract_id = c.contract_id
       JOIN employee_profiles e ON e.employee_id = sp.employee_id
       LEFT JOIN service_evaluations ev
              ON ev.contract_id = c.contract_id AND ev.employee_id = sp.employee_id
             AND ev.period_year = $2 AND ev.period_half = $3
      WHERE c.owning_dept_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.contract_title ASC, sp.role_label ASC, e.name ASC`,
    [deptId, year, half]
  );
  return rowsToObjects(result).map((row) => ({
    contractId: String(row.contract_id ?? ""),
    contractTitle: String(row.contract_title ?? ""),
    employeeId: String(row.employee_id ?? ""),
    employeeName: String(row.employee_name ?? ""),
    roleLabel: String(row.role_label ?? ""),
    participationPct: row.participation_pct != null ? Number(row.participation_pct) : 0,
    rating: row.rating != null ? Number(row.rating) : 0,
    ratingMemo: row.rating_memo != null ? String(row.rating_memo) : null,
    finalized: row.finalized_at != null,
  }));
}

export async function saveEvaluations(
  actorUserId: string,
  year: number,
  half: string,
  rows: EvaluationInput[]
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (const r of rows) {
      if (!r.contractId || !r.employeeId) continue;
      await db.run(
        `INSERT INTO service_evaluations
           (evaluation_id, contract_id, employee_id, period_year, period_half, participation_pct, rating, rating_memo, rated_by, rated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (contract_id, employee_id, period_year, period_half) DO UPDATE SET
           participation_pct = EXCLUDED.participation_pct,
           rating = EXCLUDED.rating,
           rating_memo = EXCLUDED.rating_memo,
           rated_by = EXCLUDED.rated_by,
           rated_at = EXCLUDED.rated_at`,
        [
          id("se"),
          r.contractId,
          r.employeeId,
          year,
          half,
          Number(r.participationPct ?? 0),
          Number(r.rating ?? 0),
          r.ratingMemo || null,
          actorUserId,
          now,
        ]
      );
    }
  });
}
