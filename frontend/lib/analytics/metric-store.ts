import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { parseMetricDefinition, validateDefinition, type MetricItem } from "@/lib/analytics/metric-types";

/*
 * 지표 정의 저장소(서버 전용, 117 metric_definitions) — CRUD. 실행은 metric-engine.ts.
 * ⚠ 클라이언트 import 금지(pg).
 */

function mapRow(r: Record<string, unknown>): MetricItem | null {
  const definition = parseMetricDefinition(r.definition);
  if (!definition) return null;
  const vis = String(r.visibility ?? "admin");
  return {
    metricKey: String(r.metric_key ?? ""),
    label: String(r.label ?? ""),
    description: r.description != null ? String(r.description) : null,
    definition,
    visibility: vis === "all" || vis === "owner" ? vis : "admin",
    active: Number(r.active ?? 1) === 1,
    version: Number(r.version ?? 1),
    updatedAt: r.updated_at != null ? String(r.updated_at) : undefined,
  };
}

export async function listMetrics(activeOnly = false): Promise<MetricItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM metric_definitions ${activeOnly ? "WHERE active = 1" : ""} ORDER BY metric_key`)
  );
  return rows.map(mapRow).filter((x): x is MetricItem => x != null);
}

export async function getMetric(metricKey: string): Promise<MetricItem | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM metric_definitions WHERE metric_key = $1", [metricKey]));
  return rows.length ? mapRow(rows[0]) : null;
}

/** 지표 저장(upsert) — 정의 검증 후. 정의가 바뀌면 version 증가. */
export async function saveMetric(item: Omit<MetricItem, "version" | "updatedAt">, actorUserId: string | null): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(item.metricKey)) throw new Error("지표 키는 영문 소문자·숫자·_ 만 가능합니다.");
  if (!item.label.trim()) throw new Error("지표 이름이 비어 있습니다.");
  const err = validateDefinition(item.definition);
  if (err) throw new Error(err);
  const prior = await getMetric(item.metricKey);
  const changed = !prior || JSON.stringify(prior.definition) !== JSON.stringify(item.definition);
  const nextVersion = prior ? (changed ? prior.version + 1 : prior.version) : 1;
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO metric_definitions (metric_key, label, description, definition, visibility, created_by, version, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (metric_key) DO UPDATE SET
         label = EXCLUDED.label, description = EXCLUDED.description, definition = EXCLUDED.definition,
         visibility = EXCLUDED.visibility, version = EXCLUDED.version, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at`,
      [
        item.metricKey,
        item.label.trim(),
        item.description,
        JSON.stringify(item.definition),
        item.visibility,
        actorUserId,
        nextVersion,
        item.active ? 1 : 0,
        now,
      ]
    );
  });
}

export async function deleteMetric(metricKey: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM metric_definitions WHERE metric_key = $1", [metricKey]);
  });
}
