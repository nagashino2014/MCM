/**
 * 나의 결재선 프리셋(AX-P0) — 자주 쓰는 결재선+참조/열람 묶음을 이름 붙여 저장/재사용.
 * approval_line_presets(084). line jsonb = { steps:[{stepType,assigneeUserId,assigneeName,assigneePosition}],
 *   watchers:[{userId,name,kind}] }. 소유자(owner_user_id) 본인 것만 조회/삭제한다.
 * 설계: docs/e-approval-differentiation-blueprint.md §9-1.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export interface LinePresetStep {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName: string | null;
  assigneePosition: string | null;
}
export interface LinePresetWatcher {
  userId: string;
  name: string | null;
  kind: "ref" | "view";
}
export interface LinePreset {
  presetId: string;
  name: string;
  steps: LinePresetStep[];
  watchers: LinePresetWatcher[];
}

function parseLine(raw: unknown): { steps: LinePresetStep[]; watchers: LinePresetWatcher[] } {
  let obj: Record<string, unknown> = {};
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object") obj = v as Record<string, unknown>;
  } catch {
    // 무시
  }
  const steps = Array.isArray(obj.steps)
    ? (obj.steps as Record<string, unknown>[]).map((s) => ({
        stepType: s.stepType === "agree" ? ("agree" as const) : ("approve" as const),
        assigneeUserId: String(s.assigneeUserId ?? ""),
        assigneeName: s.assigneeName != null ? String(s.assigneeName) : null,
        assigneePosition: s.assigneePosition != null ? String(s.assigneePosition) : null,
      })).filter((s) => s.assigneeUserId)
    : [];
  const watchers = Array.isArray(obj.watchers)
    ? (obj.watchers as Record<string, unknown>[]).map((w) => ({
        userId: String(w.userId ?? ""),
        name: w.name != null ? String(w.name) : null,
        kind: w.kind === "view" ? ("view" as const) : ("ref" as const),
      })).filter((w) => w.userId)
    : [];
  return { steps, watchers };
}

export async function listLinePresets(ownerUserId: string): Promise<LinePreset[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT preset_id, name, line FROM approval_line_presets WHERE owner_user_id = $1 ORDER BY updated_at DESC`, [ownerUserId])
  );
  return rows.map((r) => {
    const { steps, watchers } = parseLine(r.line);
    return { presetId: String(r.preset_id), name: String(r.name ?? ""), steps, watchers };
  });
}

export async function saveLinePreset(params: {
  ownerUserId: string;
  name: string;
  steps: LinePresetStep[];
  watchers: LinePresetWatcher[];
}): Promise<string> {
  const presetId = "alpr-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO approval_line_presets (preset_id, owner_user_id, name, line, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $5)`,
      [presetId, params.ownerUserId, params.name.trim() || "결재선", JSON.stringify({ steps: params.steps, watchers: params.watchers }), now]
    );
  });
  return presetId;
}

export async function deleteLinePreset(ownerUserId: string, presetId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM approval_line_presets WHERE preset_id = $1 AND owner_user_id = $2`, [presetId, ownerUserId]);
  });
}
