import { randomUUID } from "node:crypto";
import { audit, formatProposals, RULE_VERSION, type Snapshot, type Proposal } from "./rules";

export interface Database {
  exec(sql: string, params?: unknown[]): Promise<{ columns: string[]; values: unknown[][] }[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
}
export async function rows<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.exec(sql, params);
  if (!result[0]) return [];
  return result[0].values.map(v => Object.fromEntries(result[0].columns.map((c, i) => [c, v[i]])) as T);
}
export type Transaction = <T>(fn: (db: Database) => Promise<T>) => Promise<T>;
export interface RunOptions { sources: string[]; limit?: number }
export async function createRun(db: Database, userId: string, mode: "audit" | "enrich", options: RunOptions, facilityIds?: string[]): Promise<string> {
  const runId = randomUUID();
  await db.run("INSERT INTO facility_quality_runs(run_id,requested_by,rule_version,mode,options) VALUES($1,$2,$3,$4,$5::jsonb)", [runId, userId, RULE_VERSION, mode, JSON.stringify(options)]);
  // 한 SELECT로 고정한다. 이후 마스터 수정이나 페이지 이동이 대상 집합을 바꾸지 않는다.
  await db.run(`WITH candidates AS (SELECT facility_id,facility_quality_snapshot(f) || jsonb_build_object('is_closed', EXISTS (
      SELECT 1 FROM facility_history_events h WHERE h.facility_id=f.facility_id AND (h.event_type='closure' OR h.event_types LIKE '%"closure"%')
    )) AS snapshot FROM facilities f WHERE deleted_at IS NULL AND ($2::text[] IS NULL OR facility_id=ANY($2))),
    sampled AS (SELECT *,row_number() OVER(PARTITION BY
      COALESCE(NULLIF(btrim(snapshot->>'business_registration_no'),''),NULLIF(btrim(snapshot->>'site_business_registration_no'),'')) IS NULL,
      snapshot->>'company_name' ~ '공장|사업장|지점|사업소',snapshot->>'is_closed',
      NULLIF(btrim(snapshot->>'representative_name'),'') IS NULL
      ORDER BY md5(facility_id)) AS rank FROM candidates)
    INSERT INTO facility_quality_items(run_id,facility_id,snapshot)
    SELECT $1,facility_id,snapshot FROM sampled ORDER BY rank,md5(facility_id) LIMIT $3`, [runId, facilityIds ?? null, options.limit ?? null]);
  return runId;
}
export async function saveProposals(db: Database, runId: string, snapshot: Snapshot, candidates: Proposal[]): Promise<void> {
  if (!candidates.length) return;
  // 二重配送でも候補は増殖しない。外部ページ全体やAPIキーは保存しない。
  const data = candidates.map(p => ({ candidate_id: randomUUID(), field: p.field, value: p.value, source: p.source,
    source_url: p.url, evidence: p.evidence, match_level: p.match, recommended: p.recommended }));
  await db.run(`INSERT INTO facility_enrichment_candidates(candidate_id,run_id,facility_id,field,old_value,value,source,source_url,evidence,snapshot,match_level,recommended)
    SELECT x.candidate_id,$1,$2,x.field,$3::jsonb->>x.field,x.value,x.source,x.source_url,x.evidence,$3::jsonb,x.match_level,x.recommended
    FROM jsonb_to_recordset($4::jsonb) AS x(candidate_id text,field text,value text,source text,source_url text,evidence jsonb,match_level text,recommended boolean)
    ON CONFLICT(run_id,facility_id,field,source,value) DO NOTHING`, [runId, snapshot.facility_id, JSON.stringify(snapshot), JSON.stringify(data)]);
}
export async function auditItem(db: Database, runId: string, snapshot: Snapshot): Promise<void> {
  await saveProposals(db, runId, snapshot, formatProposals(snapshot));
  await db.run("UPDATE facility_quality_items SET diagnosis=$3::jsonb,updated_at=now() WHERE run_id=$1 AND facility_id=$2", [runId, snapshot.facility_id, JSON.stringify(audit(snapshot))]);
}
export async function runSummary(db: Database, runId: string) {
  const run = (await rows(db, "SELECT * FROM facility_quality_runs WHERE run_id=$1", [runId]))[0];
  if (!run) throw Object.assign(new Error("점검 작업을 찾을 수 없습니다"), { status: 404 });
  const counts = await rows(db, "SELECT status,count(*)::int AS count FROM facility_quality_items WHERE run_id=$1 GROUP BY status", [runId]);
  const fields = await rows(db, `SELECT d.key AS field,d.value->>'status' AS status,count(*)::int AS count
    FROM facility_quality_items i CROSS JOIN LATERAL jsonb_each(i.diagnosis) d WHERE run_id=$1 AND d.key<>'secondary' GROUP BY d.key,d.value->>'status'`, [runId]);
  const candidates = await rows(db, "SELECT status,count(*)::int AS count FROM facility_enrichment_candidates WHERE run_id=$1 GROUP BY status", [runId]);
  return { run, counts, fields, candidates };
}
