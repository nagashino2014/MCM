import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getPresetItems } from "@/lib/contracts/process-stage-presets";
import type { ContractStageRow, ContractStageInput } from "@/lib/contracts/process-stages";

// Task 공정표는 contract_process_stages 와 동일 형태(키만 task_id)를 반환한다.
function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function listTaskStages(taskId: string): Promise<ContractStageRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT stage_id, stage_order, stage_code, stage_name, status, planned_date, actual_date, progress_pct, progress_unit_pct, note
       FROM work_task_process_stages
      WHERE task_id = $1
      ORDER BY stage_order ASC`,
    [taskId]
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

export async function saveTaskStages(taskId: string, stages: ContractStageInput[]): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM work_task_process_stages WHERE task_id = $1", [taskId]);
    for (const [index, s] of stages.entries()) {
      const name = (s.stageName ?? "").trim();
      if (!name) continue;
      await db.run(
        `INSERT INTO work_task_process_stages
           (stage_id, task_id, stage_order, stage_code, stage_name, status, planned_date, actual_date, progress_pct, progress_unit_pct, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [
          id("wtps"),
          taskId,
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

/** 프리셋을 Task 공정표로 적용(기존 교체). */
export async function applyPresetToTask(taskId: string, presetId: string): Promise<void> {
  const items = await getPresetItems(presetId);
  const stages: ContractStageInput[] = items.map((it) => ({
    stageOrder: it.stageOrder,
    stageCode: it.stageCode,
    stageName: it.stageName,
    status: "pending",
    progressPct: 0,
    progressUnitPct: it.progressUnitPct,
  }));
  await saveTaskStages(taskId, stages);
}
