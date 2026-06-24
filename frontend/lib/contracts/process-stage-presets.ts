import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { saveContractStages, type ContractStageInput } from "@/lib/contracts/process-stages";

export interface PresetItemRow {
  itemId: string;
  stageOrder: number;
  stageCode: string | null;
  stageName: string;
  progressUnitPct: number;
}

export interface PresetRow {
  presetId: string;
  presetName: string;
  serviceType: string | null;
  displayOrder: number;
  items: PresetItemRow[];
}

export interface PresetItemInput {
  stageOrder: number;
  stageCode?: string | null;
  stageName: string;
  progressUnitPct?: number | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function mapItem(row: Record<string, unknown>): PresetItemRow {
  return {
    itemId: String(row.item_id ?? ""),
    stageOrder: Number(row.stage_order ?? 0),
    stageCode: row.stage_code != null ? String(row.stage_code) : null,
    stageName: String(row.stage_name ?? ""),
    progressUnitPct: Number(row.progress_unit_pct ?? 10),
  };
}

/** 모든 활성 프리셋 + 단계 항목. 공정표 설정 모달의 선택 목록. */
export async function listPresets(): Promise<PresetRow[]> {
  const db = await getDb();
  const presetResult = await db.exec(
    `SELECT preset_id, preset_name, service_type, display_order
       FROM process_stage_presets
      WHERE is_active = 1
      ORDER BY display_order ASC, preset_name ASC`
  );
  const presets = rowsToObjects(presetResult);
  if (!presets.length) return [];

  const itemsResult = await db.exec(
    `SELECT item_id, preset_id, stage_order, stage_code, stage_name, progress_unit_pct
       FROM process_stage_preset_items
      WHERE is_active = 1
      ORDER BY stage_order ASC`
  );
  const itemsByPreset = new Map<string, PresetItemRow[]>();
  for (const row of rowsToObjects(itemsResult)) {
    const presetId = String(row.preset_id ?? "");
    const list = itemsByPreset.get(presetId) ?? [];
    list.push(mapItem(row));
    itemsByPreset.set(presetId, list);
  }

  return presets.map((row) => ({
    presetId: String(row.preset_id ?? ""),
    presetName: String(row.preset_name ?? ""),
    serviceType: row.service_type != null ? String(row.service_type) : null,
    displayOrder: Number(row.display_order ?? 100),
    items: itemsByPreset.get(String(row.preset_id ?? "")) ?? [],
  }));
}

export async function getPresetItems(presetId: string): Promise<PresetItemRow[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT item_id, stage_order, stage_code, stage_name, progress_unit_pct
       FROM process_stage_preset_items
      WHERE preset_id = $1 AND is_active = 1
      ORDER BY stage_order ASC`,
    [presetId]
  );
  return rowsToObjects(result).map(mapItem);
}

/** 프리셋 생성/교체(upsert). 엑셀 일괄 import 도 이 함수를 재사용한다. */
export async function savePreset(input: {
  presetId?: string;
  presetName: string;
  serviceType?: string | null;
  displayOrder?: number | null;
  items: PresetItemInput[];
}): Promise<string> {
  const presetId = input.presetId?.trim() || id("psp");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO process_stage_presets (preset_id, preset_name, service_type, is_active, display_order, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $5)
       ON CONFLICT (preset_id) DO UPDATE SET
         preset_name = EXCLUDED.preset_name,
         service_type = EXCLUDED.service_type,
         display_order = EXCLUDED.display_order,
         updated_at = EXCLUDED.updated_at`,
      [presetId, input.presetName.trim() || "새 프리셋", input.serviceType || null, input.displayOrder ?? 100, now]
    );
    await db.run("DELETE FROM process_stage_preset_items WHERE preset_id = $1", [presetId]);
    for (const [index, item] of input.items.entries()) {
      const name = (item.stageName ?? "").trim();
      if (!name) continue;
      await db.run(
        `INSERT INTO process_stage_preset_items
           (item_id, preset_id, stage_order, stage_code, stage_name, progress_unit_pct, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)`,
        [id("pspi"), presetId, item.stageOrder ?? index + 1, item.stageCode || null, name, Number(item.progressUnitPct ?? 10), now]
      );
    }
  });
  return presetId;
}

/** 프리셋을 계약 공정표로 적용한다(단위 포함). 기존 계약 공정표는 교체된다. */
export async function applyPresetToContract(contractId: string, presetId: string): Promise<void> {
  const items = await getPresetItems(presetId);
  const stages: ContractStageInput[] = items.map((it) => ({
    stageOrder: it.stageOrder,
    stageCode: it.stageCode,
    stageName: it.stageName,
    status: "pending",
    progressPct: 0,
    progressUnitPct: it.progressUnitPct,
  }));
  await saveContractStages(contractId, stages);
}
