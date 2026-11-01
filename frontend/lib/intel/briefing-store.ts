import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { assertBriefingCapability, assertBriefingDocumentOwner, briefingVisibilitySql, getBriefingCapabilities } from "./briefing-access";
import { briefingError, latestDueBriefingSlot, nextBriefingSlot, normalizeBriefingProfile } from "./briefing-schedule";
import type { BriefingProfile, BriefingProfileInput, BriefingRun } from "./briefing-types";

export const briefingId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
export const iso = (v: unknown): string => v instanceof Date ? v.toISOString() : String(v ?? "");
export function json<T>(v: unknown): T { return (typeof v === "string" ? JSON.parse(v) : v) as T; }
export async function briefingAudit(db: PgDatabase, action: string, userId: string | null, profileId: string | null, runId: string | null, detail: unknown = {}): Promise<void> {
  await db.run("INSERT INTO intel_briefing_audit(action,actor_user_id,profile_id,run_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)", [action, userId, profileId, runId, JSON.stringify(detail)]);
}
function profileRow(row: Record<string, unknown>, userId?: string): BriefingProfile {
  return { ...json<BriefingProfileInput>(row.config), profileId: String(row.profile_id), ownerUserId: String(row.owner_user_id), name: String(row.name), enabled: row.enabled === true, version: Number(row.version), nextRunAt: row.next_run_at ? iso(row.next_run_at) : null, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), canManage: userId === String(row.owner_user_id) };
}
export async function assertBriefingUser(userId: string, permission = "sales.view"): Promise<void> {
  await assertBriefingCapability(userId, permission === "sales.edit" || permission === "intel.briefing.create" ? "create" : permission === "intel.briefing.share" ? "share" : "view");
}
export async function listBriefingProfiles(userId: string): Promise<BriefingProfile[]> {
  await assertBriefingUser(userId);
  const db = await getDb();
  const caps = await getBriefingCapabilities(userId);
  return rowsToObjects(await db.exec(`SELECT p.* FROM intel_briefing_profiles p WHERE p.owner_user_id=$1 OR EXISTS(SELECT 1 FROM intel_briefing_recipients r WHERE r.profile_id=p.profile_id AND r.user_id=$1) ORDER BY p.updated_at DESC`, [userId])).map(r => profileRow(r, caps.canCreate ? userId : undefined));
}
export async function getBriefingProfile(profileId: string, userId: string, manage = false): Promise<BriefingProfile> {
  await assertBriefingUser(userId, manage ? "sales.edit" : "sales.view");
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT p.* FROM intel_briefing_profiles p WHERE p.profile_id=$1 AND (p.owner_user_id=$2 ${manage ? "" : "OR EXISTS(SELECT 1 FROM intel_briefing_recipients r WHERE r.profile_id=p.profile_id AND r.user_id=$2)"})`, [profileId, userId]));
  if (!rows.length) throw briefingError("프로필을 찾을 수 없거나 접근 권한이 없습니다.", 404);
  return profileRow(rows[0], (await getBriefingCapabilities(userId)).canCreate ? userId : undefined);
}
export async function loadBriefingProfile(profileId: string, db?: PgDatabase): Promise<BriefingProfile | null> {
  const conn = db ?? await getDb(); const rows = rowsToObjects(await conn.exec("SELECT * FROM intel_briefing_profiles WHERE profile_id=$1", [profileId]));
  return rows[0] ? profileRow(rows[0]) : null;
}
async function validateRecipients(config: BriefingProfileInput): Promise<void> {
  for (const recipient of config.recipients) await assertBriefingUser(recipient.userId);
}
async function refreshWakeup(): Promise<void> {
  try { const { refreshBriefingWakeup } = await import("./briefing-scheduler"); await refreshBriefingWakeup(); }
  catch (error) { console.error("[briefing] 실행 캐시 갱신 실패 — 다음 복구 틱에서 다시 확인", error); }
}
export async function saveBriefingProfile(userId: string, input: unknown, profileId?: string): Promise<BriefingProfile> {
  await assertBriefingUser(userId, "sales.edit");
  const previous = profileId ? await getBriefingProfile(profileId, userId, true) : null;
  const patch = (input ?? {}) as Partial<BriefingProfile>;
  if (previous && (patch.version !== previous.version || patch.updatedAt !== previous.updatedAt)) throw briefingError("다른 작업에서 설정이 변경되었습니다. 새로고침 후 다시 저장하세요.", 409);
  const config = normalizeBriefingProfile(previous ? { ...previous, ...patch, filters: { ...previous.filters, ...patch.filters }, schedule: { ...previous.schedule, ...patch.schedule } } : input, userId);
  await validateRecipients(config);
  const pid = profileId ?? briefingId("ibp");
  const normalizedPrevious = previous ? normalizeBriefingProfile(previous, userId) : null;
  const changedCriteria = normalizedPrevious && (JSON.stringify(normalizedPrevious.filters) !== JSON.stringify(config.filters) || JSON.stringify(normalizedPrevious.requiredSources) !== JSON.stringify(config.requiredSources));
  const version = previous ? previous.version + (changedCriteria ? 1 : 0) : 1;
  const next = config.enabled ? (previous?.enabled && JSON.stringify(normalizedPrevious?.schedule) === JSON.stringify(config.schedule) ? previous.nextRunAt ?? nextBriefingSlot(config.schedule) : nextBriefingSlot(config.schedule)) : null;
  await withDbWrite(async db => {
    if (previous) {
      const locked = rowsToObjects(await db.exec("SELECT updated_at FROM intel_briefing_profiles WHERE profile_id=$1 FOR UPDATE", [pid]))[0];
      if (!locked || iso(locked.updated_at) !== previous.updatedAt) throw briefingError("설정이 변경되었습니다. 다시 조회하세요.", 409);
      await db.run("UPDATE intel_briefing_profiles SET name=$2,enabled=$3,version=$4,config=$5::jsonb,next_run_at=$6,updated_at=GREATEST(now(),updated_at+interval '1 millisecond') WHERE profile_id=$1", [pid, config.name, config.enabled, version, JSON.stringify(config), next]);
    } else await db.run("INSERT INTO intel_briefing_profiles(profile_id,owner_user_id,name,enabled,version,config,next_run_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)", [pid, userId, config.name, config.enabled, version, JSON.stringify(config), next]);
    await db.run("DELETE FROM intel_briefing_recipients WHERE profile_id=$1", [pid]);
    for (const r of config.recipients) await db.run("INSERT INTO intel_briefing_recipients(profile_id,user_id,channels) VALUES($1,$2,$3::jsonb)", [pid, r.userId, JSON.stringify(r.channels)]);
    if (previous && !config.enabled) await db.run("UPDATE intel_briefing_runs SET status='canceled',lease_token=NULL,lease_until=NULL,error='프로필 일시중지',updated_at=now() WHERE profile_id=$1 AND trigger='scheduled' AND status IN ('queued','waiting_sources','running','ready')", [pid]);
    await briefingAudit(db, previous ? "profile.update" : "profile.create", userId, pid, null, { version, enabled: config.enabled, criteriaChanged: !!changedCriteria });
  });
  await refreshWakeup(); return getBriefingProfile(pid, userId);
}
export function mapBriefingRun(row: Record<string, unknown>): BriefingRun {
  return { runId: String(row.run_id), profileId: String(row.profile_id), profileName: String(row.profile_name ?? json<BriefingProfileInput>(row.config_snapshot).name), trigger: String(row.trigger) as BriefingRun["trigger"], scheduledFor: iso(row.scheduled_for), status: String(row.status) as BriefingRun["status"], attempt: Number(row.attempt), error: row.error ? String(row.error) : null, briefingId: row.briefing_id ? String(row.briefing_id) : null, snapshotId: row.snapshot_id ? String(row.snapshot_id) : null, profileVersion: Number(row.profile_version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
export async function queueManualBriefing(profileId: string, userId: string, requestKey: string): Promise<BriefingRun> {
  const profile = await getBriefingProfile(profileId, userId, true);
  if (!/^[\w-]{8,100}$/.test(requestKey)) throw briefingError("재실행 방지 요청키가 필요합니다.");
  const row = await withDbWrite(async db => {
    const inserted = rowsToObjects(await db.exec(`INSERT INTO intel_briefing_runs(run_id,profile_id,trigger,request_key,scheduled_for,profile_version,config_snapshot,requested_by) VALUES($1,$2,'manual',$3,now(),$4,$5::jsonb,$6) ON CONFLICT(profile_id,request_key) WHERE trigger='manual' DO NOTHING RETURNING *`, [briefingId("ibr"), profileId, requestKey, profile.version, JSON.stringify(profile), userId]));
    if (inserted.length) await briefingAudit(db, "run.request", userId, profileId, String(inserted[0].run_id));
    return inserted[0] ?? rowsToObjects(await db.exec("SELECT * FROM intel_briefing_runs WHERE profile_id=$1 AND trigger='manual' AND request_key=$2", [profileId, requestKey]))[0];
  });
  await refreshWakeup(); return mapBriefingRun(row);
}
export async function queueDueBriefings(now = new Date()): Promise<number> {
  return withDbWrite(async db => {
    const due = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_profiles WHERE enabled=true AND next_run_at <= $1 ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 100", [now.toISOString()]));
    let count = 0;
    for (const row of due) {
      const p = profileRow(row); const slot = latestDueBriefingSlot(p.schedule, p.nextRunAt!, now);
      if (!slot) continue;
      await db.run(`INSERT INTO intel_briefing_runs(run_id,profile_id,trigger,scheduled_for,profile_version,config_snapshot) VALUES($1,$2,'scheduled',$3,$4,$5::jsonb) ON CONFLICT(profile_id,scheduled_for) WHERE trigger='scheduled' DO NOTHING`, [briefingId("ibr"), p.profileId, slot, p.version, JSON.stringify(p)]);
      await db.run("UPDATE intel_briefing_profiles SET next_run_at=$2 WHERE profile_id=$1", [p.profileId, nextBriefingSlot(p.schedule, now)]); count++;
    }
    return count;
  });
}
export async function listBriefingRuns(userId: string, profileId?: string): Promise<BriefingRun[]> {
  await assertBriefingUser(userId);
  const db = await getDb();
  return rowsToObjects(await db.exec(`SELECT r.*,p.name AS profile_name FROM intel_briefing_runs r JOIN intel_briefing_profiles p USING(profile_id) WHERE (p.owner_user_id=$1 OR EXISTS(SELECT 1 FROM intel_briefing_recipients pr WHERE pr.profile_id=p.profile_id AND pr.user_id=$1)) AND ($2::text IS NULL OR r.profile_id=$2) ORDER BY r.created_at DESC LIMIT 100`, [userId, profileId ?? null])).map(mapBriefingRun);
}
export async function getBriefingRun(runId: string, userId: string): Promise<BriefingRun> {
  const db = await getDb(); const row = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_runs WHERE run_id=$1", [runId]))[0];
  if (!row) throw briefingError("실행 이력을 찾을 수 없습니다.", 404);
  await getBriefingProfile(String(row.profile_id), userId); return mapBriefingRun(row);
}
/** 수동·정기 보고서 모두 소유자와 명시적 수신자에게만 개방한다. */
export async function assertBriefingAccess(id: string, userId: string, manage = false): Promise<{ restricted: boolean; profileId: string | null }> {
  await assertBriefingUser(userId, manage ? "sales.edit" : "sales.view");
  const db = await getDb();
  if (manage) await assertBriefingDocumentOwner(id, userId, "create");
  const row = rowsToObjects(await db.exec(`SELECT to_jsonb(b)->>'access_scope' AS access_scope,to_jsonb(b)->>'profile_id' AS profile_id,to_jsonb(b)->>'snapshot_id' AS snapshot_id FROM intel_rag_briefings b WHERE briefing_id=$1 AND ${briefingVisibilitySql("b", "$2")}`, [id, userId]))[0];
  if (!row) throw briefingError("브리핑을 찾을 수 없습니다.", 404);
  if (row.access_scope !== "restricted") return { restricted: false, profileId: null };
  if (row.snapshot_id) await assertBriefingSnapshotRights(String(row.snapshot_id));
  return { restricted: true, profileId: String(row.profile_id) };
}
/** 권리가 회수된 문서는 과거 생성 결과·파생 프로젝트 경로에서도 다시 발송하지 않는다. */
export async function assertBriefingSnapshotRights(snapshotId: string): Promise<void> {
  const db = await getDb();
  const snapshots = rowsToObjects(await db.exec("SELECT payload FROM intel_briefing_snapshots WHERE snapshot_id=$1", [snapshotId]));
  if (!snapshots.length) throw briefingError("근거 스냅샷이 없습니다.", 409);
  const items = json<{ items: Array<{ id: string; kind: string; revision: string }> }>(snapshots[0].payload).items;
  await assertBriefingEvidenceRights(items);
}
export async function assertBriefingEvidenceRights(items: Array<{ id: string; kind: string; revision: string }>): Promise<void> {
  const db = await getDb();
  const documentIds = items.filter(i => i.kind === "official").map(i => i.id.slice(9));
  const revisionIds = items.filter(i => i.kind === "official").map(i => i.revision);
  const projectIds = items.filter(i => i.kind === "project").map(i => i.id.slice(8));
  const missing = rowsToObjects(await db.exec(`SELECT id FROM unnest($1::text[]) id WHERE NOT EXISTS(SELECT 1 FROM intel_source_documents d WHERE d.document_id=id)
    UNION ALL SELECT id FROM unnest($2::text[]) id WHERE NOT EXISTS(SELECT 1 FROM intel_source_document_revisions r WHERE r.revision_id=id AND r.rights_snapshot->>'aiAllowed'='true' AND r.rights_snapshot->>'internalReportAllowed'='true' AND r.rights_snapshot->>'storageAllowed'='true')`, [documentIds,revisionIds]));
  const orphaned = rowsToObjects(await db.exec("SELECT ps.project_id FROM intel_project_signals ps JOIN intel_signals s ON s.signal_id=ps.signal_id WHERE ps.project_id=ANY($1::text[]) AND s.source LIKE 'official:%' AND NOT EXISTS(SELECT 1 FROM intel_source_documents d WHERE d.signal_id=s.signal_id) LIMIT 1",[projectIds]));
  const invalid = rowsToObjects(await db.exec(`SELECT d.document_id FROM intel_source_documents d JOIN scraper_sources s ON s.source_id=d.source_id LEFT JOIN intel_source_document_revisions r ON r.revision_id=d.current_revision_id
    WHERE s.official_provider IS NOT NULL AND (d.document_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM intel_project_signals ps WHERE ps.project_id=ANY($2::text[]) AND ps.signal_id=d.signal_id))
    AND (d.status<>'available' OR COALESCE(s.official_config->>'enabled','false')<>'true' OR s.official_config->>'verifiedAt' IS NULL OR COALESCE(s.official_config->'permissions'->>'aiAllowed','false')<>'true' OR COALESCE(s.official_config->'permissions'->>'internalReportAllowed','false')<>'true' OR COALESCE(s.official_config->'permissions'->>'storageAllowed','false')<>'true' OR COALESCE(r.rights_snapshot->>'aiAllowed','false')<>'true' OR COALESCE(r.rights_snapshot->>'internalReportAllowed','false')<>'true' OR COALESCE(r.rights_snapshot->>'storageAllowed','false')<>'true') LIMIT 1`, [documentIds, projectIds]));
  if (invalid.length || missing.length || orphaned.length) throw briefingError("보고서 근거 자료의 이용 허용이 변경되어 조회·발송을 보류했습니다.", 403);
}
