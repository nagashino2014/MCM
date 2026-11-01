import { createHash, randomUUID } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "../db";
import { encryptSecret, decryptSecret } from "../scraper/secret-crypto";
import { collectOfficialDocuments, officialDate, officialDocumentHash } from "./official-sources-connectors";
import type { OfficialFetcher } from "./official-sources-fetch";
import { OFFICIAL_PROVIDERS, OFFICIAL_STATE_LABELS, EMPTY_OFFICIAL_PERMISSIONS, OfficialSourceError, defaultOfficialConfig, emptyOfficialState, officialProvider, officialSourceState, officialFingerprint, validateOfficialUpdate } from "./official-sources-policy";
import type { OfficialCollectResult, OfficialDocumentInput, OfficialDocumentType, OfficialEvidence, OfficialPermissions, OfficialProviderDefinition, OfficialProviderId, OfficialSourceConfig, OfficialSourceStoredState, OfficialSourceView } from "./official-sources-types";

type Row = Record<string, unknown>;
type Source = { row: Row; provider: OfficialProviderDefinition; state: OfficialSourceStoredState; config: OfficialSourceConfig };
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const iso = (v: unknown): string | null => v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`;
async function query(db: PgDatabase, sql: string, values: unknown[] = []): Promise<Row[]> { return rowsToObjects(await db.exec(sql, values)); }
const sourceId = (providerId: string) => `official_${providerId}`;
const endpointId = (providerId: string) => `official_endpoint_${providerId}`;
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map((v) => JSON.parse(canonical(v))) : Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])) : value ?? null);
function decode(row: Row, provider: OfficialProviderDefinition): Source {
  const stored = object(row.official_config);
  return { row, provider, state: { ...emptyOfficialState(), ...stored, permissions: { ...EMPTY_OFFICIAL_PERMISSIONS, ...object(stored.permissions) } } as OfficialSourceStoredState, config: Object.keys(object(row.api_config)).length ? object(row.api_config) as OfficialSourceConfig : defaultOfficialConfig(provider) };
}
async function readSource(db: PgDatabase, provider: OfficialProviderDefinition, lock = false): Promise<Source> {
  const rows = await query(db, `SELECT s.*, e.api_config FROM scraper_sources s LEFT JOIN scraper_endpoints e ON e.endpoint_id = $2 WHERE s.official_provider = $1 ${lock ? "FOR UPDATE OF s" : ""}`, [provider.id, endpointId(provider.id)]);
  return decode(rows[0] ?? {}, provider);
}
function view(source: Source): OfficialSourceView {
  const { provider, state, config, row } = source, hasSecret = Boolean(row.auth_secret_enc), status = officialSourceState(provider, state, config, hasSecret);
  return { providerId: provider.id, sourceId: typeof row.source_id === "string" ? row.source_id : null, name: provider.name, documentType: provider.documentType, homeUrl: provider.homeUrl, referenceUrls: provider.referenceUrls, requiresSecret: provider.requiresSecret, hasSecret, referenceOnly: provider.referenceOnly, enabled: state.enabled, state: status, stateLabel: OFFICIAL_STATE_LABELS[status], permissions: state.permissions, config, configVersion: state.configVersion, verifiedAt: state.verifiedAt, lastAttemptAt: state.lastAttemptAt, lastSuccessAt: state.lastSuccessAt, lastError: state.lastError, nextDueAt: state.nextDueAt, intervalHours: provider.intervalHours, note: provider.note };
}
export async function listOfficialSources(): Promise<OfficialSourceView[]> {
  const db = await getDb();
  const rows = await query(db, `SELECT s.*, e.api_config FROM scraper_sources s LEFT JOIN scraper_endpoints e ON e.endpoint_id = 'official_endpoint_' || s.official_provider WHERE s.official_provider IS NOT NULL`);
  return OFFICIAL_PROVIDERS.map((provider) => view(decode(rows.find((row) => row.official_provider === provider.id) ?? {}, provider)));
}

/** 기존 소스/엔드포인트와 암호화 저장소를 재사용하되 구형 custom 배치는 실행하지 않는다. */
export async function updateOfficialSource(raw: unknown, actorId: string): Promise<OfficialSourceView> {
  const update = validateOfficialUpdate(raw), provider = officialProvider(update.providerId), now = new Date().toISOString();
  return withDbWrite(async (db) => {
    // 없는 행도 직렬화한다. 설정을 덮어쓰는 동시 저장은 409로 돌려준다.
    await db.exec("SELECT pg_advisory_xact_lock(hashtext($1))", [`official:${provider.id}`]);
    const previous = await readSource(db, provider, true);
    if (previous.state.configVersion !== update.expectedVersion) throw new OfficialSourceError("다른 사용자가 설정을 변경했습니다. 새로고침 후 다시 저장하세요.", 409);
    const oldRights = previous.state.permissions;
    const comparableRights = ({ reviewedAt: _at, reviewedBy: _by, ...rights }: OfficialPermissions) => rights;
    const rightsChanged = canonical(comparableRights(oldRights)) !== canonical(update.permissions);
    const secretChanged = update.authSecret === null ? Boolean(previous.row.auth_secret_enc) : Boolean(update.authSecret);
    const configChanged = canonical(previous.config) !== canonical(update.config);
    const permissions: OfficialPermissions = { ...update.permissions, reviewedAt: rightsChanged ? now : oldRights.reviewedAt, reviewedBy: rightsChanged ? actorId : oldRights.reviewedBy };
    let encrypted = previous.row.auth_secret_enc ?? null;
    if (update.authSecret === null) encrypted = null;
    else if (update.authSecret) { try { encrypted = encryptSecret(update.authSecret); } catch { throw new OfficialSourceError("서버의 인증키 암호화 설정이 필요합니다.", 503); } }
    const changed = rightsChanged || secretChanged || configChanged;
    const state: OfficialSourceStoredState = { ...previous.state, enabled: update.enabled, permissions, configVersion: previous.state.configVersion + 1, leaseToken: null, leaseUntil: null,
      ...(changed ? { verifiedAt: null, verifiedFingerprint: null, lastError: null } : {}), nextDueAt: update.enabled && !changed && previous.state.verifiedAt ? now : null };
    await db.exec(`INSERT INTO scraper_sources(source_id,slug,name,base_url,purpose,enabled,created_at,updated_at,updated_by,auth_secret_enc,official_provider,official_config)
      VALUES($1,$2,$3,$4,'intel',0,$5,$5,$6,$7,$8,$9::jsonb)
      ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name,base_url=EXCLUDED.base_url,enabled=0,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by,auth_secret_enc=EXCLUDED.auth_secret_enc,official_config=EXCLUDED.official_config`,
    [sourceId(provider.id), `official-${provider.id}`, provider.name, provider.homeUrl, now, actorId, encrypted, provider.id, JSON.stringify(state)]);
    await db.exec(`INSERT INTO scraper_endpoints(endpoint_id,source_id,name,api_config,field_mapping,sink_config,enabled,created_at,updated_at)
      VALUES($1,$2,$3,$4::jsonb,'{}','{"managedBy":"official_sources"}',0,$5,$5)
      ON CONFLICT(endpoint_id) DO UPDATE SET api_config=EXCLUDED.api_config,enabled=0,updated_at=EXCLUDED.updated_at`, [endpointId(provider.id), sourceId(provider.id), provider.name, JSON.stringify(update.config), now]);
    return view(await readSource(db, provider));
  });
}

async function writeState(db: PgDatabase, source: Source, state: OfficialSourceStoredState): Promise<void> {
  await db.exec("UPDATE scraper_sources SET official_config=$2::jsonb, updated_at=$3 WHERE source_id=$1", [source.row.source_id, JSON.stringify(state), new Date().toISOString()]);
}
function emptyResult(provider: OfficialProviderDefinition, state: OfficialCollectResult["state"], status: OfficialCollectResult["status"], error?: string): OfficialCollectResult {
  return { providerId: provider.id, status, state, scanned: 0, inserted: 0, changed: 0, signalIds: [], revisionIds: [], ...(error ? { error } : {}) };
}
function mayCollect(source: Source): boolean {
  return !source.provider.referenceOnly && source.state.permissions.collectionAllowed && source.state.permissions.storageAllowed && (!source.provider.requiresSecret || Boolean(source.row.auth_secret_enc))
    && (source.provider.id !== "kosis" || Boolean(source.config.series?.length)) && (source.provider.id !== "law" || Boolean(source.config.laws?.length));
}

/** 각 문서는 현재 버전과 비교한다. A→B→A 정정은 새 버전, A→A 재시도는 같은 버전이다. */
async function persistDocument(db: PgDatabase, source: Source, doc: OfficialDocumentInput, now: string, rights: OfficialPermissions, createSignal: boolean): Promise<{ revisionId: string; signalId: string | null; inserted: boolean; changed: boolean }> {
  let rows = await query(db, `SELECT d.*, r.content_hash, r.rights_snapshot FROM intel_source_documents d LEFT JOIN intel_source_document_revisions r ON r.revision_id=d.current_revision_id WHERE d.source_id=$1 AND d.external_id=$2 FOR UPDATE OF d`, [source.row.source_id, doc.externalId]);
  const inserted = !rows.length, documentId = String(rows[0]?.document_id ?? id("idoc"));
  if (inserted) await db.exec(`INSERT INTO intel_source_documents(document_id,source_id,external_id,document_type,title,url,published_at,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [documentId, source.row.source_id, doc.externalId, doc.documentType, doc.title, doc.url, doc.publishedAt, now]);
  const hash = officialDocumentHash(doc);
  const changed = inserted || rows[0]?.content_hash !== hash || canonical(object(rows[0]?.rights_snapshot)) !== canonical(rights);
  let revisionId = String(rows[0]?.current_revision_id ?? ""), signalId = typeof rows[0]?.signal_id === "string" ? rows[0].signal_id : null;
  if (changed) {
    revisionId = id("irev");
    const structured = { ...doc.structuredData, evidence: { title: doc.title, url: doc.url, publishedAt: doc.publishedAt, documentType: doc.documentType, industries: doc.industries, companyName: doc.companyName ?? null } };
    await db.exec(`INSERT INTO intel_source_document_revisions(revision_id,document_id,content_hash,normalized_text,structured_data,rights_snapshot,fetched_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [revisionId, documentId, hash, doc.normalizedText, JSON.stringify(structured), JSON.stringify(rights), now]);
    if (doc.documentType === "statistic") {
      const data = doc.structuredData;
      await db.exec(`INSERT INTO intel_indicator_observations(observation_id,revision_id,series_key,period,unit,value,raw_value,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [id("iobs"), revisionId, data.seriesKey, data.period, data.unit ?? null, typeof data.value === "number" ? data.value : null, String(data.rawValue ?? ""), JSON.stringify({ lastChangedAt: data.lastChangedAt, provisional: data.provisional }), now]);
    }
  }
  // 매출·제품 소개 자체를 설비 프로젝트로 오인하지 않는다. 아직 검증되지 않은 영업 후보이다.
  if (createSignal && !signalId && doc.documentType === "company_event" && doc.companyName && /투자|증설|신설|착공|준공|공장\s*건설/.test(doc.title)) {
    signalId = id("isig");
    const signalType = /증설/.test(doc.title) ? "expansion" : /신설|착공|공장\s*건설/.test(doc.title) ? "new_site" : "investment";
    const existing = await query(db, `INSERT INTO intel_signals(signal_id,source,external_id,company_name,report_name,signal_type,signal_grade,disclosed_at,url,raw_json,summary,match_status,match_type,status,industry,industry_relevance,relevance_note,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'monitoring',$7,$8,$9,$10,'unmatched','direct','new',$11,'direct','공식 발표 기반 검토 후보. 사업장·시점·서비스 수요는 담당자 확인 필요.',$12,$12)
      ON CONFLICT(source,external_id) DO UPDATE SET updated_at=EXCLUDED.updated_at RETURNING signal_id`, [signalId, `official:${source.provider.id}`, doc.externalId, doc.companyName, doc.title, signalType, doc.publishedAt?.slice(0, 10) ?? null, doc.url, JSON.stringify({ documentId, revisionId }), doc.title, doc.industries[0] ?? null, now]);
    signalId = String(existing[0].signal_id);
  }
  if (createSignal && signalId && changed) await db.exec("UPDATE intel_signals SET report_name=$2,summary=$2,url=$3,disclosed_at=$4,raw_json=$5,updated_at=$6 WHERE signal_id=$1 AND source=$7", [signalId, doc.title, doc.url, doc.publishedAt?.slice(0, 10) ?? null, JSON.stringify({ documentId, revisionId }), now, `official:${source.provider.id}`]);
  await db.exec(`UPDATE intel_source_documents SET title=$2,url=$3,published_at=$4,last_seen_at=$5,current_revision_id=$6,signal_id=COALESCE($7,signal_id),status='available' WHERE document_id=$1`, [documentId, doc.title, doc.url, doc.publishedAt, now, revisionId, signalId]);
  return { revisionId, signalId, inserted, changed };
}

/** fetcher는 테스트 주입점이다. HTTP API는 사용자에게 이 인자를 노출하지 않는다. */
export async function collectOfficialSource(providerId: OfficialProviderId, options: { automatic?: boolean; fetcher?: OfficialFetcher } = {}): Promise<OfficialCollectResult> {
  const provider = officialProvider(providerId), token = id("olease"), now = new Date();
  const acquired = await withDbWrite(async (db) => {
    const source = await readSource(db, provider, true), state = officialSourceState(provider, source.state, source.config, Boolean(source.row.auth_secret_enc));
    if (!source.row.source_id || !mayCollect(source) || (options.automatic && (!source.state.enabled || !source.state.verifiedAt))) return { result: emptyResult(provider, state, "waiting", OFFICIAL_STATE_LABELS[state]) };
    if (source.state.leaseUntil && Date.parse(source.state.leaseUntil) > now.valueOf()) return { result: emptyResult(provider, state, "busy") };
    if (options.automatic && source.state.nextDueAt && Date.parse(source.state.nextDueAt) > now.valueOf()) return { result: emptyResult(provider, state, "waiting") };
    source.state = { ...source.state, leaseToken: token, leaseUntil: new Date(now.valueOf() + 15 * 60_000).toISOString(), lastAttemptAt: now.toISOString() };
    await writeState(db, source, source.state);
    return { source };
  });
  if (acquired.result) return acquired.result;
  const source = acquired.source!;
  try {
    const secret = decryptSecret(source.row.auth_secret_enc as string | null);
    if (provider.requiresSecret && !secret) throw new OfficialSourceError("저장된 인증키를 사용할 수 없습니다. 인증키와 서버 암호화 설정을 확인하세요.", 503);
    const documents = await collectOfficialDocuments(provider, source.config, secret, options.fetcher);
    if (!documents.length) throw new OfficialSourceError("설정 범위에서 검증할 수 있는 자료를 찾지 못했습니다.", 502);
    return await withDbWrite(async (db) => {
      const current = await readSource(db, provider, true);
      if (current.state.leaseToken !== token || current.state.configVersion !== source.state.configVersion || !mayCollect(current)) return emptyResult(provider, officialSourceState(provider, current.state, current.config, Boolean(current.row.auth_secret_enc)), "waiting", "수집 중 설정이 변경되어 결과를 저장하지 않았습니다.");
      const fetchedAt = new Date().toISOString(), result = emptyResult(provider, current.state.enabled ? "active" : "paused", "no_change");
      result.scanned = documents.length;
      for (const doc of documents) {
        const saved = await persistDocument(db, current, doc, fetchedAt, current.state.permissions, current.state.permissions.aiAllowed && current.state.permissions.internalReportAllowed);
        if (saved.inserted) result.inserted += 1;
        else if (saved.changed) result.changed += 1;
        if (saved.changed) result.revisionIds.push(saved.revisionId);
        if (saved.signalId && saved.changed) result.signalIds.push(saved.signalId);
      }
      result.status = result.inserted || result.changed ? "collected" : "no_change";
      await writeState(db, current, { ...current.state, leaseToken: null, leaseUntil: null, verifiedAt: fetchedAt, verifiedFingerprint: officialFingerprint(current.config, current.state.permissions, current.state.configVersion), lastSuccessAt: fetchedAt, lastError: null, nextDueAt: current.state.enabled ? new Date(Date.now() + provider.intervalHours * 3600_000).toISOString() : null });
      return result;
    });
  } catch (error) {
    // 응답 원문·URL query·키가 포함될 수 있는 일반 네트워크/DB 오류는 외부로 보내지 않는다.
    const message = error instanceof OfficialSourceError ? error.message : "공식 정보원 수집을 완료하지 못했습니다. 연결 상태와 설정을 확인하세요.";
    await withDbWrite(async (db) => {
      const current = await readSource(db, provider, true);
      if (current.state.leaseToken === token) await writeState(db, current, { ...current.state, leaseToken: null, leaseUntil: null, lastError: message, nextDueAt: current.state.enabled && current.state.verifiedAt ? new Date(Date.now() + 3600_000).toISOString() : null });
    });
    return emptyResult(provider, "error", "failed", message);
  }
}

export async function nextOfficialCollectionDue(): Promise<string | null> {
  const sources = await collectionSources();
  const due = sources.map((s) => s.state.leaseUntil && s.state.leaseUntil > s.state.nextDueAt! ? s.state.leaseUntil : s.state.nextDueAt!).sort();
  return due[0] ?? null;
}
async function collectionSources(): Promise<Source[]> {
  const db = await getDb(), rows = await query(db, `SELECT s.*,e.api_config FROM scraper_sources s LEFT JOIN scraper_endpoints e ON e.endpoint_id='official_endpoint_'||s.official_provider WHERE s.official_provider IS NOT NULL`);
  return rows.flatMap((row) => { const provider = OFFICIAL_PROVIDERS.find(p => p.id === row.official_provider); if (!provider) return []; const source = decode(row, provider); return source.state.enabled && source.state.verifiedAt && source.state.nextDueAt && mayCollect(source) ? [source] : []; });
}
export async function collectDueOfficialSources(options: { limit?: number } = {}): Promise<{ results: OfficialCollectResult[] }> {
  const now = Date.now(), sources = (await collectionSources()).filter((s) => Date.parse(s.state.nextDueAt!) <= now && (!s.state.leaseUntil || Date.parse(s.state.leaseUntil) <= now)).sort((a, b) => a.state.nextDueAt!.localeCompare(b.state.nextDueAt!)).slice(0, Math.max(1, Math.min(8, options.limit ?? 4)));
  const results: OfficialCollectResult[] = [];
  for (const source of sources) results.push(await collectOfficialSource(source.provider.id, { automatic: true }));
  return { results };
}

export interface OfficialEvidenceOptions { from?: string; to?: string; asOf?: string; documentIds?: string[]; industries?: string[]; types?: OfficialDocumentType[]; limit?: number; offset?: number }
export async function listOfficialEvidence(options: OfficialEvidenceOptions = {}): Promise<{ evidence: OfficialEvidence[]; total: number; nextOffset: number | null }> {
  const db = await getDb(), limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 100))), offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const values: unknown[] = [options.asOf ?? new Date().toISOString()];
  let where = `d.status='available' AND s.official_provider IS NOT NULL
    AND s.official_config->>'enabled'='true' AND NULLIF(s.official_config->>'verifiedAt','') IS NOT NULL
    AND s.official_config->'permissions'->>'aiAllowed'='true' AND s.official_config->'permissions'->>'internalReportAllowed'='true'
    AND s.official_config->'permissions'->>'storageAllowed'='true' AND r.rights_snapshot->>'aiAllowed'='true' AND r.rights_snapshot->>'internalReportAllowed'='true' AND r.rights_snapshot->>'storageAllowed'='true'`;
  if (options.from) { values.push(options.from); where += ` AND r.fetched_at >= $${values.length}::timestamptz`; }
  if (options.to) { values.push(options.to); where += ` AND r.fetched_at <= $${values.length}::timestamptz`; }
  if (options.documentIds) { values.push(options.documentIds); where += ` AND d.document_id=ANY($${values.length}::text[])`; }
  if (options.industries?.length) { values.push(options.industries); where += ` AND (COALESCE(jsonb_array_length(r.structured_data->'evidence'->'industries'),0)=0 OR (r.structured_data->'evidence'->'industries') ?| $${values.length}::text[])`; }
  if (options.types?.length) { values.push(options.types); where += ` AND d.document_type=ANY($${values.length}::text[])`; }
  const fromSql = `FROM intel_source_documents d JOIN scraper_sources s ON s.source_id=d.source_id
    JOIN LATERAL (SELECT * FROM intel_source_document_revisions ir WHERE ir.document_id=d.document_id AND ir.fetched_at <= $1::timestamptz ORDER BY ir.fetched_at DESC,ir.revision_id DESC LIMIT 1) r ON true WHERE ${where}`;
  // 한 SQL snapshot에서 전체 건수와 현재 페이지를 함께 읽어 페이지 말미에도 total을 보존한다.
  const rows = await query(db, `WITH eligible AS (SELECT d.external_id,d.document_type,d.signal_id,s.official_provider,s.name AS source_name,r.* ${fromSql}), page AS (SELECT * FROM eligible ORDER BY fetched_at ASC,revision_id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}) SELECT (SELECT count(*) FROM eligible)::integer AS total,COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.fetched_at,page.revision_id) FILTER (WHERE page.revision_id IS NOT NULL),'[]'::jsonb) AS page FROM page`, [...values, limit, offset]);
  const total = Number(rows[0]?.total ?? 0), page = Array.isArray(rows[0]?.page) ? rows[0].page as Row[] : [];
  const evidence: OfficialEvidence[] = page.map((r) => {
    const data = object(r.structured_data), snap = object(data.evidence), { evidence: _e, ...structuredData } = data;
    return { documentId: String(r.document_id), revisionId: String(r.revision_id), providerId: String(r.official_provider), sourceName: String(r.source_name), externalId: String(r.external_id), documentType: r.document_type as OfficialDocumentType, title: String(snap.title ?? ""), url: String(snap.url ?? ""), publishedAt: iso(snap.publishedAt), normalizedText: String(r.normalized_text), structuredData, companyName: typeof snap.companyName === "string" ? snap.companyName : undefined, industries: Array.isArray(snap.industries) ? snap.industries.map(String) : [], fetchedAt: iso(r.fetched_at)!, signalId: typeof r.signal_id === "string" ? r.signal_id : null };
  });
  return { evidence, total, nextOffset: offset + evidence.length < total ? offset + evidence.length : null };
}

/** 기존 신호는 이미 보유한 식별·사건 메타데이터만 증거화한다. 원문 처리 권리를 추정하지 않는다. */
export async function ingestSignalEvidence(options: { signalIds: string[]; mode?: "live" | "initial_backfill" | "replay" }): Promise<{ signalIds: string[]; revisionIds: string[] }> {
  const signalIds = [...new Set(options.signalIds)].slice(0, 500);
  if (!signalIds.length) return { signalIds: [], revisionIds: [] };
  return withDbWrite(async (db) => {
    const signals = await query(db, "SELECT * FROM intel_signals WHERE signal_id=ANY($1::text[]) ORDER BY signal_id", [signalIds]);
    const result = { signalIds: [] as string[], revisionIds: [] as string[] }, now = new Date().toISOString();
    for (const signal of signals) {
      // 공식 수집기가 만든 문서는 그대로 사용한다.
      const existing = await query(db, "SELECT d.current_revision_id FROM intel_source_documents d JOIN scraper_sources s ON s.source_id=d.source_id WHERE d.signal_id=$1 AND s.official_provider IS NOT NULL", [signal.signal_id]);
      if (existing.length) { result.signalIds.push(String(signal.signal_id)); result.revisionIds.push(...existing.map((r) => String(r.current_revision_id)).filter(Boolean)); continue; }
      const legacy = String(signal.source), legacyId = `legacy_${createHash("sha256").update(legacy).digest("hex").slice(0, 24)}`;
      await db.exec(`INSERT INTO scraper_sources(source_id,slug,name,purpose,enabled,created_at,updated_at) VALUES($1,$2,$3,'intel',0,$4,$4) ON CONFLICT(source_id) DO NOTHING`, [legacyId, `evidence-${legacyId}`, `${legacy} 수집 증거`, now]);
      await db.exec("SELECT pg_advisory_xact_lock(hashtext($1))", [`signal-evidence:${signal.signal_id}`]);
      const source = decode({ source_id: legacyId }, officialProvider("kdi"));
      const doc: OfficialDocumentInput = { externalId: String(signal.signal_id), documentType: "company_event", title: String(signal.report_name ?? "공개 사건"), url: String(signal.url ?? ""), publishedAt: officialDate(String(signal.disclosed_at ?? "")), normalizedText: "", structuredData: { source: legacy, signalType: signal.signal_type, companyName: signal.company_name, amount: signal.amount ?? null, metadataOnly: true }, companyName: typeof signal.company_name === "string" ? signal.company_name : undefined, industries: typeof signal.industry === "string" ? [signal.industry] : [] };
      const saved = await persistDocument(db, source, doc, now, { ...EMPTY_OFFICIAL_PERMISSIONS }, false);
      await db.exec("UPDATE intel_source_documents SET signal_id=$2 WHERE source_id=$1 AND external_id=$2", [legacyId, signal.signal_id]);
      result.signalIds.push(String(signal.signal_id)); result.revisionIds.push(saved.revisionId);
    }
    return result;
  });
}
