import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export interface StageTemplateRow {
  stageOrder: number;
  stageCode: string;
  stageName: string;
}

export interface ContractStageRow {
  stageId: string;
  stageOrder: number;
  stageCode: string | null;
  stageName: string;
  status: "pending" | "in_progress" | "done";
  plannedDate: string | null;
  actualDate: string | null;
  progressPct: number;
  progressUnitPct: number;
  note: string | null;
}

export interface ContractStageInput {
  stageOrder: number;
  stageCode?: string | null;
  stageName: string;
  status?: string;
  plannedDate?: string | null;
  actualDate?: string | null;
  progressPct?: number | null;
  progressUnitPct?: number | null;
  note?: string | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listStageTemplates(serviceType: string): Promise<StageTemplateRow[]> {
  const db = await getDb();
  const result = await db.exec(
    "SELECT stage_order, stage_code, stage_name FROM process_stage_templates WHERE service_type = $1 AND is_active = 1 ORDER BY stage_order ASC",
    [serviceType]
  );
  return rowsToObjects(result).map((row) => ({
    stageOrder: Number(row.stage_order ?? 0),
    stageCode: String(row.stage_code ?? ""),
    stageName: String(row.stage_name ?? ""),
  }));
}

export async function listContractStages(contractId: string): Promise<ContractStageRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT stage_id, stage_order, stage_code, stage_name, status, planned_date, actual_date, progress_pct, progress_unit_pct, note
       FROM contract_process_stages
      WHERE contract_id = $1
      ORDER BY stage_order ASC`,
    [contractId]
  );
  return rowsToObjects(result).map((row) => ({
    stageId: String(row.stage_id ?? ""),
    stageOrder: Number(row.stage_order ?? 0),
    stageCode: row.stage_code != null ? String(row.stage_code) : null,
    stageName: String(row.stage_name ?? ""),
    status: (String(row.status ?? "pending") as ContractStageRow["status"]),
    plannedDate: row.planned_date != null ? String(row.planned_date) : null,
    actualDate: row.actual_date != null ? String(row.actual_date) : null,
    progressPct: Number(row.progress_pct ?? 0),
    progressUnitPct: Number(row.progress_unit_pct ?? 10),
    note: row.note != null ? String(row.note) : null,
  }));
}

/** 계약 공정표 전체 교체 (계약별 가감/순서/진행 반영). */
export async function saveContractStages(
  contractId: string,
  stages: ContractStageInput[]
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM contract_process_stages WHERE contract_id = $1", [contractId]);
    for (const [index, s] of stages.entries()) {
      const name = (s.stageName ?? "").trim();
      if (!name) continue;
      await db.run(
        `INSERT INTO contract_process_stages
           (stage_id, contract_id, stage_order, stage_code, stage_name, status, planned_date, actual_date, progress_pct, progress_unit_pct, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [
          id("cps"),
          contractId,
          s.stageOrder ?? index + 1,
          s.stageCode || null,
          name,
          s.status || "pending",
          s.plannedDate || null,
          s.actualDate || null,
          Number(s.progressPct ?? 0),
          Number(s.progressUnitPct ?? 10),
          s.note || null,
          now,
        ]
      );
    }
  });
}
