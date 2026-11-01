import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { OFFICIAL_PROVIDERS, defaultOfficialConfig, emptyOfficialState } from "../lib/intel/official-sources-policy";
import { ingestSignalProjects } from "../lib/intel/project-intelligence";
import { localIntelligenceSourceUrl } from "./local-intelligence-environment.mjs";
import { invalidateImportedSignals, readImportedSignalStates } from "./local-intelligence-source-reconciliation";
import { explicitImportedSourceIds, importedSignalFingerprint, importedSignalRaw, mergeImportedSourceRows } from "./local-intelligence-import-payload";

type Row = Record<string, unknown>;
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const localId = (kind: string, value: string) => `${kind}_${hash(value).slice(0, 24)}`;
const str = (value: unknown): string | null => value == null || value === "" ? null : String(value);
const SOURCES = ["dart", "eiass", "press", "news", "gosi", "gosi_eum", "gosi_me"];
export interface LiveSourceOptions { days?: number; limit?: number; includeSourceSignalIds?: string[] }
export interface LiveSourceInspection { lookbackDays: number; limit: number; sourceTotal: number; sourceCounts: Record<string, number>; publishedFrom: string | null; publishedTo: string | null; sourceLogSummary: Row[]; truncated: boolean }
export interface LiveImportResult extends LiveSourceInspection { importId: string; importedAt: string; importedSignals: number; importedFacilities: number; changedSignals: number; invalidatedSignals: number; projectsCreated: number; availableSourceCounts: Record<string, number>; selectionStrategy: string }

function targetUrl(): URL {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "55439" || url.pathname !== "/intel_live" || decodeURIComponent(url.username) !== "mcm_intel_test" || url.search || url.hash) throw new Error("실제 자료 검증용 로컬 DB(mcm_intel_test@127.0.0.1:55439/intel_live)만 허용합니다.");
  return url;
}
async function frontendRoot(): Promise<string> {
  let current = path.resolve(process.cwd());
  for (let n = 0; n < 7; n++) {
    for (const candidate of [current, path.join(current, "frontend")]) {
      try { await access(path.join(candidate, "tests/fixtures/project-intelligence-base.sql")); return candidate; } catch { /* 다음 후보 확인 */ }
    }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  throw new Error("작업 트리 또는 frontend에서 실행해야 합니다.");
}
function bounds(options: LiveSourceOptions) {
  const days = options.days ?? 180, limit = options.limit ?? 2000;
  if (!Number.isSafeInteger(days) || days < 1 || days > 180 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("가져오기 범위는 최대 180일·2,000건입니다.");
  return { days, limit, cutoff: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, "") };
}
/** 업무 fixture의 INSERT는 한 줄도 실행하지 않고 빈 업무 스키마만 만든다. */
export async function initializeLocalIntelligenceLive(): Promise<{ initialized: boolean; schemaVersion: number; database: "intel_live"; actorUserId: "u1" }> {
  const url = targetUrl(), root = await frontendRoot(), adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString(), ssl: false });
  try {
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_live'")).rowCount) {
      try { await admin.query("CREATE DATABASE intel_live"); } catch (error) { if ((error as { code?: string }).code !== "42P04") throw error; }
    }
  } finally { await admin.end(); }
  const db = new Client({ connectionString: url.toString(), ssl: false });
  try {
    await db.connect(); await db.query("BEGIN"); await db.query("SELECT pg_advisory_xact_lock(hashtext('local-intelligence-live-init'))");
    const tables = (await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' AND schemaname NOT LIKE 'pg_temp%'")).rows.map((r: Row) => `${r.schemaname}.${r.tablename}`);
    if (tables.includes("public.local_intelligence_live_metadata")) {
      const state = (await db.query("SELECT schema_version,complete FROM local_intelligence_live_metadata WHERE singleton=true")).rows[0];
      if (!state?.complete || Number(state.schema_version) !== 1) throw new Error("기존 intel_live 버전을 확인하세요. 기존 자료는 변경하지 않았습니다.");
      await grantLocalBriefingAccess(db);
      await db.query("COMMIT"); return { initialized: false, schemaVersion: 1, database: "intel_live", actorUserId: "u1" };
    }
    if (tables.length) throw new Error("intel_live가 비어 있지 않아 초기화를 중단했습니다. 자동 삭제·덮어쓰기는 하지 않습니다.");
    const projectLines = (await readFile(path.join(root, "tests/fixtures/project-intelligence-base.sql"), "utf8")).split(/\r?\n/).filter(line => /^CREATE TABLE /.test(line) && !/^CREATE TABLE (scraper_sources|intel_source_documents|intel_source_document_revisions)\(/.test(line));
    if (!projectLines.some(line => line.startsWith("CREATE TABLE intel_signals("))) throw new Error("공개 수집 스키마 fixture를 확인하세요.");
    await db.query(projectLines.join("\n"));
    const sourceLines = (await readFile(path.join(root, "tests/fixtures/official-sources-base.sql"), "utf8")).split(/\r?\n/).filter(line => /^CREATE TABLE scraper_(sources|endpoints)\(/.test(line));
    if (sourceLines.length !== 2) throw new Error("수집기 스키마 fixture를 확인하세요.");
    await db.query(sourceLines.join("\n"));
    await db.query(`
      CREATE TABLE local_intelligence_live_metadata(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),schema_version integer NOT NULL,complete boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE local_intelligence_imports(import_id text PRIMARY KEY,started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,status text NOT NULL,lookback_days integer NOT NULL,limit_count integer NOT NULL,source_total integer,imported_signals integer NOT NULL DEFAULT 0,imported_facilities integer NOT NULL DEFAULT 0,projects_created integer NOT NULL DEFAULT 0,source_counts jsonb NOT NULL DEFAULT '{}',source_log_summary jsonb NOT NULL DEFAULT '[]',coverage jsonb NOT NULL DEFAULT '{}',error text);
      CREATE TABLE local_intelligence_signal_origins(source_signal_id text PRIMARY KEY,target_signal_id text NOT NULL UNIQUE REFERENCES intel_signals(signal_id),content_hash text NOT NULL,last_import_id text NOT NULL REFERENCES local_intelligence_imports(import_id),imported_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE local_intelligence_facility_origins(source_facility_id text PRIMARY KEY,target_facility_id text NOT NULL UNIQUE REFERENCES facilities(facility_id),content_hash text NOT NULL,last_import_id text NOT NULL REFERENCES local_intelligence_imports(import_id));
      ALTER TABLE users ADD COLUMN email text,ADD COLUMN name text,ADD COLUMN email_local text;
      ALTER TABLE departments ADD COLUMN display_order integer NOT NULL DEFAULT 0;
      CREATE TABLE positions(position_id text PRIMARY KEY,position_name text,rank_order integer);
      ALTER TABLE employee_profiles ADD COLUMN user_id text,ADD COLUMN position_id text REFERENCES positions(position_id),ADD COLUMN photo_public_path text;
      ALTER TABLE permission_template_grants ADD COLUMN created_at text;
      CREATE TABLE permissions(permission_key text PRIMARY KEY,module text,action text,description text,scopes_supported text,is_dangerous integer,created_at text);
      ALTER TABLE contracts ADD COLUMN contract_title text,ADD COLUMN status text DEFAULT 'active';
      ALTER TABLE intel_signals ADD COLUMN region text,ADD COLUMN raw_json jsonb,ADD COLUMN relevance_note text,ADD COLUMN match_type text,ADD COLUMN corp_code text,ADD COLUMN brn text,ADD COLUMN asset_class text,ADD COLUMN acquire_purpose text,ADD COLUMN counterparty text,ADD COLUMN agency text;
      CREATE TABLE intel_rag_briefings(briefing_id text PRIMARY KEY,question text NOT NULL,answer_md text,sources jsonb,filters jsonb,model text,status text,error text,created_by text,created_at text);
      CREATE TABLE intel_embeddings(signal_id text PRIMARY KEY,content text,model text,content_hash text,updated_at text);
      CREATE TABLE intel_collect_state(source text PRIMARY KEY,last_run_at text,last_cursor text,updated_at text);
      CREATE TABLE facility_contact_people(id bigserial PRIMARY KEY,facility_id text REFERENCES facilities(facility_id),person_name text,title text);
      CREATE TABLE alerts(id bigserial PRIMARY KEY,severity text,source text,code text,title text,body text,payload_json jsonb,created_at text);
      INSERT INTO departments(dept_id,dept_name) VALUES('d1','[시험용] 영업 검토'),('d2','[시험용] 수신 검토');
      INSERT INTO positions VALUES('live_reviewer','시험 실행자',1);
      INSERT INTO employee_profiles(employee_id,name,dept_id,user_id,position_id) VALUES('e1','[시험계정] 검토자','d1','u1','live_reviewer'),('e2','[시험계정] 수신자','d2','u2','live_reviewer');
      INSERT INTO users(user_id,role,dept_id,employee_id,email,name,email_local) VALUES('u1','member','d1','e1','u1@local.invalid','[시험계정] 검토자','u1'),('u2','member','d2','e2','u2@local.invalid','[시험계정] 수신자','u2');
      INSERT INTO permission_templates VALUES('local-reviewer',1);
      INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect) SELECT 'local-'||key,'local-reviewer',key,'all','allow' FROM unnest(ARRAY['sales.view','sales.edit','facility.edit','contract.view','ai.usage.view','ai.usage.manage']) key;
      INSERT INTO user_permission_assignments(assignment_id,user_id,template_id) VALUES('local-user-u1','u1','local-reviewer'),('local-user-u2','u2','local-reviewer');
    `);
    for (const file of ["319_official_intelligence_sources.sql", "320_project_intelligence.sql", "131_rag_briefing_share.sql", "132_scraper_run_logs.sql", "095_mail_core.sql", "096_mail_folders.sql", "098_mail_folders_sys_unique.sql", "321_scheduled_intelligence_briefings.sql", "215_ai_usage_log.sql", "216_ai_model_prices.sql", "217_ai_settings_budgets.sql", "218_ai_budget_alerts_kind.sql"]) {
      await db.query((await readFile(path.join(root, "../infra/aws", file), "utf8")).replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, ""));
    }
    const budget = Number(process.env.MCM_INTEL_LOCAL_AI_BUDGET_USD ?? 5);
    if (!Number.isFinite(budget) || budget <= 0 || budget > 100) throw new Error("로컬 AI 초기 예산은 0 초과 100달러 이하로 설정하세요.");
    await db.query("UPDATE ai_budgets SET enabled=1,monthly_limit_usd=$1,action='block_all',warn_pcts='{}',recipients='{}',label='로컬 실제 AI 검증' WHERE budget_id='budget-org'", [budget]);
    await db.query("INSERT INTO ai_settings(setting_key,setting_json,updated_at,updated_by) VALUES('single_call_alert_usd','null',now()::text,'u1')");
    for (const uid of ["u1", "u2"]) {
      await db.query("INSERT INTO mailboxes(mailbox_id,user_id,employee_id,address,local_part,display_name,status,created_at,updated_at) VALUES($1,$2,$3,$4,$2,'시험용 사내메일함','active',now()::text,now()::text)", [`live_mailbox_${uid}`, uid, uid === "u1" ? "e1" : "e2", `${uid}@local.invalid`]);
      for (const [sort, kind] of ["inbox", "sent", "drafts", "trash", "archive", "spam"].entries()) await db.query("INSERT INTO mail_folders(folder_id,mailbox_id,name,system_kind,sort,created_at) VALUES($1,$2,$3,$3,$4,now()::text)", [`live_folder_${uid}_${kind}`, `live_mailbox_${uid}`, kind, sort]);
    }
    for (const provider of OFFICIAL_PROVIDERS) {
      await db.query("INSERT INTO scraper_sources(source_id,slug,name,purpose,enabled,base_url,official_provider,official_config,created_at,updated_at) VALUES($1,$1,$2,'intel',0,$3,$4,$5::jsonb,now()::text,now()::text)", [`official_${provider.id}`, provider.name, provider.homeUrl, provider.id, JSON.stringify(emptyOfficialState())]);
      await db.query("INSERT INTO scraper_endpoints(endpoint_id,source_id,name,api_config,enabled,created_at,updated_at) VALUES($1,$2,$3,$4::jsonb,0,now()::text,now()::text)", [`official_endpoint_${provider.id}`, `official_${provider.id}`, provider.name, JSON.stringify(defaultOfficialConfig(provider))]);
    }
    await db.query("INSERT INTO local_intelligence_live_metadata VALUES(true,1,true,now())");
    await grantLocalBriefingAccess(db);
    await db.query("COMMIT"); return { initialized: true, schemaVersion: 1, database: "intel_live", actorUserId: "u1" };
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await db.end(); }
}

async function grantLocalBriefingAccess(db: Database): Promise<void> {
  await db.query("ALTER TABLE intel_rag_briefing_shares ADD COLUMN IF NOT EXISTS explicit_share boolean NOT NULL DEFAULT false");
  await db.query(`INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect)
    SELECT 'local-briefing-'||k.key,'local-reviewer',k.key,'all','allow'
    FROM unnest(ARRAY['intel.briefing.view','intel.briefing.create','intel.briefing.share']) k(key)
    WHERE EXISTS(SELECT 1 FROM permission_templates WHERE template_id='local-reviewer')
      AND NOT EXISTS(SELECT 1 FROM permission_template_grants g WHERE g.template_id='local-reviewer' AND g.permission_key=k.key)`);
}
async function withReadOnlySource<T>(work: (source: Database) => Promise<T>): Promise<T> {
  if (!process.env.MCM_INTEL_SOURCE_DATABASE_URL) throw new Error("원본 수집 DB의 읽기 전용 연결이 아직 설정되지 않았습니다.");
  let source: InstanceType<typeof Client> | undefined;
  try {
    const url = localIntelligenceSourceUrl(process.env.MCM_INTEL_SOURCE_DATABASE_URL);
    const sslMode = process.env.MCM_INTEL_SOURCE_SSL ?? "require";
    if (!["require", "disable"].includes(sslMode)) throw new Error("원본 SSL 설정 오류");
    url.searchParams.set("options", "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000");
    // 서버 인증은 외부의 인증된 SSM 터널이 담당한다. 검증 없는 TLS를 직접 원격 연결에 사용하지 않는다.
    source = new Client({ connectionString: url.toString(), application_name: "mcm-local-intel-readonly-import", ssl: sslMode === "require" ? { rejectUnauthorized: false } : false });
    await source.connect(); await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const mode = (await source.query("SHOW transaction_read_only")).rows[0];
    if (mode.transaction_read_only !== "on") throw new Error("읽기 전용 트랜잭션 확인 실패");
    const result = await work(source); await source.query("COMMIT"); return result;
  } catch (error) {
    await source?.query("ROLLBACK").catch(() => undefined);
    const code = String((error as { code?: string }).code ?? "READ_ONLY_SOURCE_ERROR").replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);
    throw new Error(`원본 읽기 전용 조회에 실패했습니다 (${code}). 접속 정보는 기록하지 않았습니다.`);
  } finally { await source?.end(); }
}
const sourceScope = `WITH source_rows AS (SELECT to_jsonb(s) AS j FROM intel_signals s), eligible AS (
 SELECT j FROM source_rows WHERE j->>'source'=ANY($1::text[]) AND COALESCE(j->>'signal_grade','candidate')<>'excluded'
 AND COALESCE(j->>'status','new')<>'dismissed' AND NULLIF(j->>'duplicate_of','') IS NULL AND NULLIF(j->>'deleted_at','') IS NULL
 AND substring(regexp_replace(COALESCE(NULLIF(j->>'disclosed_at',''),j->>'created_at',''),'[^0-9]','','g'),1,8)>=$2)
`;
async function inspectSource(source: Database, options: LiveSourceOptions): Promise<LiveSourceInspection> {
  const b = bounds(options);
  const count = (await source.query(`${sourceScope} SELECT count(*)::integer AS total,min(j->>'disclosed_at') AS published_from,max(j->>'disclosed_at') AS published_to FROM eligible`, [SOURCES, b.cutoff])).rows[0];
  const groups = (await source.query(`${sourceScope} SELECT j->>'source' AS source,count(*)::integer AS count FROM eligible GROUP BY 1 ORDER BY 1`, [SOURCES, b.cutoff])).rows;
  const sourceCounts = Object.fromEntries(groups.map(row => [String(row.source), Number(row.count)]));
  const hasLogs = (await source.query("SELECT to_regclass('public.scraper_run_logs') IS NOT NULL AS present")).rows[0]?.present;
  const sourceLogSummary = hasLogs ? (await source.query("SELECT DISTINCT ON(j->>'source_slug') j->>'source_slug' AS source,j->>'status' AS status,j->>'finished_at' AS finished_at FROM (SELECT to_jsonb(l) AS j FROM scraper_run_logs l) log WHERE j->>'source_slug'=ANY($1::text[]) ORDER BY j->>'source_slug',j->>'finished_at' DESC NULLS LAST", [SOURCES])).rows : [];
  const hasState = (await source.query("SELECT to_regclass('public.intel_collect_state') IS NOT NULL AS present")).rows[0]?.present;
  if (hasState) sourceLogSummary.push(...(await source.query("SELECT j->>'source' AS source,j->>'last_run_at' AS last_run_at,'execution_only_not_success' AS status FROM (SELECT to_jsonb(s) AS j FROM intel_collect_state s) state WHERE j->>'source'=ANY($1::text[])",[SOURCES])).rows);
  return { lookbackDays: b.days, limit: b.limit, sourceTotal: Number(count.total), sourceCounts, publishedFrom: str(count.published_from), publishedTo: str(count.published_to), sourceLogSummary, truncated: Number(count.total) > b.limit };
}
export async function inspectLocalIntelligenceSource(options: LiveSourceOptions = {}): Promise<LiveSourceInspection> {
  targetUrl(); bounds(options); return withReadOnlySource(source => inspectSource(source, options));
}
function dateOnly(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8); if (digits.length !== 8) return null;
  const day = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
  return Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day ? day : null;
}
function timestamp(value: unknown, fallback: string): string { const text = str(value); return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback; }

/** 원본에서는 SELECT만 수행하고, 모든 저장·프로젝트 보강은 intel_live에서 수행한다. */
export async function importLocalIntelligenceSource(options: LiveSourceOptions = {}): Promise<LiveImportResult> {
  await initializeLocalIntelligenceLive(); const url = targetUrl(), b = bounds(options), importId = `live_import_${randomUUID()}`;
  const destination = new Client({ connectionString: url.toString(), ssl: false });
  await destination.connect();
  try {
    await destination.query("SELECT pg_advisory_lock(hashtext('local-intelligence-live-import'))");
    await destination.query("INSERT INTO local_intelligence_imports(import_id,status,lookback_days,limit_count) VALUES($1,'running',$2,$3)", [importId,b.days,b.limit]);
    const origins: Array<{ sourceSignalId: string; targetSignalId: string }> = (await destination.query("SELECT source_signal_id,target_signal_id FROM local_intelligence_signal_origins ORDER BY source_signal_id")).rows.map((row: Row) => ({ sourceSignalId: String(row.source_signal_id), targetSignalId: String(row.target_signal_id) }));
    const explicitIds = explicitImportedSourceIds(options.includeSourceSignalIds, new Set(origins.map(origin => origin.sourceSignalId)));
    const incoming = await withReadOnlySource(async source => {
      const inspection = await inspectSource(source,options);
      const existingStates = await readImportedSignalStates(source, origins, SOURCES);
      const projection = `jsonb_build_object('signal_id',j->>'signal_id','source',j->>'source','external_id',j->>'external_id','company_name',j->>'company_name','report_name',j->>'report_name','summary',j->>'summary','signal_type',j->>'signal_type','signal_grade',j->>'signal_grade','amount',j->>'amount','url',j->>'url','disclosed_at',j->>'disclosed_at','facility_id',j->>'facility_id','industry',j->>'industry','industry_relevance',j->>'industry_relevance','region',j->>'region','created_at',j->>'created_at','updated_at',j->>'updated_at','channel',CASE WHEN jsonb_typeof(j->'raw_json')='object' THEN j->'raw_json'->>'channel' ELSE NULL END,'public_raw',CASE WHEN jsonb_typeof(j->'raw_json')='object' THEN jsonb_build_object('description',j->'raw_json'->>'description','originalLink',j->'raw_json'->>'originalLink','classification',j->'raw_json'->'classification','body',CASE WHEN j->>'source'='press' THEN j->'raw_json'->>'body' ELSE NULL END) ELSE '{}'::jsonb END)`;
      const selected = (await source.query(`${sourceScope} SELECT ${projection} AS signal FROM eligible ORDER BY CASE WHEN j->>'source'='news' THEN 1 ELSE 0 END,COALESCE(j->>'disclosed_at',j->>'created_at') DESC,j->>'signal_id' LIMIT $3`, [SOURCES,b.cutoff,b.limit])).rows.map(row => row.signal as Row);
      const explicit = explicitIds.length ? (await source.query(`${sourceScope} SELECT ${projection} AS signal FROM eligible WHERE j->>'signal_id'=ANY($3::text[]) ORDER BY j->>'signal_id'`, [SOURCES,b.cutoff,explicitIds])).rows.map(row => row.signal as Row) : [];
      const signals = mergeImportedSourceRows(selected, explicit);
      const facilityIds = [...new Set(signals.map(s => str(s.facility_id)).filter((id): id is string => !!id))];
      const hasFacilities = (await source.query("SELECT to_regclass('public.facilities') IS NOT NULL AS present")).rows[0]?.present;
      const facilities = hasFacilities && facilityIds.length ? (await source.query("SELECT jsonb_build_object('facility_id',j->>'facility_id','company_name',j->>'company_name','site_address',j->>'site_address','region_sido',j->>'region_sido','region_sigungu',j->>'region_sigungu') AS facility FROM (SELECT to_jsonb(f) AS j FROM facilities f) src WHERE j->>'facility_id'=ANY($1::text[])",[facilityIds])).rows.map(row=>row.facility as Row) : [];
      return { inspection,signals,facilities,existingStates };
    });
    const now = new Date().toISOString(), changedIds: string[] = [], allIds: string[] = [], facilityMap = new Map<string,string>();
    await destination.query("BEGIN");
    const invalidatedSignals = await invalidateImportedSignals(destination, incoming.existingStates, now);
    for (const facility of incoming.facilities) {
      const sourceId = String(facility.facility_id), id = localId("livef",sourceId), digest = hash(facility); facilityMap.set(sourceId,id);
      const previous = (await destination.query("SELECT content_hash FROM local_intelligence_facility_origins WHERE source_facility_id=$1",[sourceId])).rows[0];
      if (previous?.content_hash !== digest) {
        await destination.query("INSERT INTO facilities(facility_id,company_name,site_address,region_sido,region_sigungu,source,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'public_source_import',$6,$6) ON CONFLICT(facility_id) DO UPDATE SET company_name=EXCLUDED.company_name,site_address=EXCLUDED.site_address,region_sido=EXCLUDED.region_sido,region_sigungu=EXCLUDED.region_sigungu,updated_at=EXCLUDED.updated_at",[id,facility.company_name,facility.site_address,facility.region_sido,facility.region_sigungu,now]);
        await destination.query("INSERT INTO local_intelligence_facility_origins(source_facility_id,target_facility_id,content_hash,last_import_id) VALUES($1,$2,$3,$4) ON CONFLICT(source_facility_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,last_import_id=EXCLUDED.last_import_id",[sourceId,id,digest,importId]);
      }
    }
    for (const signal of incoming.signals) {
      const sourceId = str(signal.signal_id); if (!sourceId) continue;
      const id = localId("lives",sourceId), facilityId = facilityMap.get(String(signal.facility_id)) ?? null;
      const digest = importedSignalFingerprint(signal); allIds.push(id);
      const previous = (await destination.query("SELECT o.content_hash,s.raw_json FROM local_intelligence_signal_origins o JOIN intel_signals s ON s.signal_id=o.target_signal_id WHERE o.source_signal_id=$1",[sourceId])).rows[0];
      if (previous?.content_hash === digest) continue;
      const amount = signal.amount == null || signal.amount === "" ? null : Number(signal.amount);
      await destination.query(`INSERT INTO intel_signals(signal_id,source,external_id,company_name,report_name,summary,signal_type,signal_grade,amount,url,disclosed_at,facility_id,industry,industry_relevance,region,raw_json,match_status,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'new',$18,$19)
        ON CONFLICT(signal_id) DO UPDATE SET company_name=EXCLUDED.company_name,report_name=EXCLUDED.report_name,summary=EXCLUDED.summary,signal_type=EXCLUDED.signal_type,signal_grade=EXCLUDED.signal_grade,amount=EXCLUDED.amount,url=EXCLUDED.url,disclosed_at=EXCLUDED.disclosed_at,facility_id=EXCLUDED.facility_id,industry=EXCLUDED.industry,industry_relevance=EXCLUDED.industry_relevance,region=EXCLUDED.region,status=CASE WHEN intel_signals.raw_json#>>'{localImport,sourceAvailability}' IN('missing','deleted','excluded','dismissed','duplicate','source_changed') THEN EXCLUDED.status ELSE intel_signals.status END,raw_json=EXCLUDED.raw_json,updated_at=EXCLUDED.updated_at`,
        [id,signal.source,str(signal.external_id)??sourceId,signal.company_name,signal.report_name,signal.summary,str(signal.signal_type)??"other",str(signal.signal_grade)??"candidate",amount!=null&&Number.isFinite(amount)&&amount>=0?amount:null,signal.url,dateOnly(signal.disclosed_at),facilityId,signal.industry,signal.industry_relevance,signal.region,JSON.stringify(importedSignalRaw(signal,sourceId,importId,previous?.raw_json)),facilityId?"matched":"unmatched",timestamp(signal.created_at,now),now]);
      await destination.query("INSERT INTO local_intelligence_signal_origins(source_signal_id,target_signal_id,content_hash,last_import_id) VALUES($1,$2,$3,$4) ON CONFLICT(source_signal_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,last_import_id=EXCLUDED.last_import_id,imported_at=now()",[sourceId,id,digest,importId]);
      changedIds.push(id);
    }
    await destination.query("COMMIT");
    // 첫 적재뿐 아니라 원본 재동기화도 과거 알림 폭주를 막는 initial_backfill로 보강한다.
    const missing = (await destination.query("SELECT s.signal_id FROM intel_signals s LEFT JOIN intel_projects p ON p.ingestion_key='signal:'||s.signal_id WHERE s.signal_id=ANY($1::text[]) AND (p.project_id IS NULL OR s.updated_at::timestamptz>p.source_checked_at OR (p.created_by IS NULL AND p.region IS DISTINCT FROM NULLIF(btrim(s.region),'')))",[allIds])).rows.map((row:Row)=>String(row.signal_id));
    const ingestIds = [...new Set([...changedIds,...missing])]; let projectsCreated = 0;
    for (let offset=0;offset<ingestIds.length;offset+=500) projectsCreated += (await ingestSignalProjects({signalIds:ingestIds.slice(offset,offset+500),mode:"initial_backfill",limit:500})).created;
    const selectedCounts: Record<string,number> = {};for(const signal of incoming.signals) selectedCounts[String(signal.source)]=(selectedCounts[String(signal.source)]??0)+1;
    const result: LiveImportResult = { ...incoming.inspection,sourceCounts:selectedCounts,availableSourceCounts:incoming.inspection.sourceCounts,selectionStrategy:`non_news_first_then_latest_news;within_group=published_desc,signal_id_asc;limit=2000${explicitIds.length?`;explicit_existing=${explicitIds.length}`:""}`,importId,importedAt:new Date().toISOString(),importedSignals:allIds.length,importedFacilities:facilityMap.size,changedSignals:changedIds.length,invalidatedSignals,projectsCreated };
    await destination.query("UPDATE local_intelligence_imports SET status='completed',completed_at=$2,source_total=$3,imported_signals=$4,imported_facilities=$5,projects_created=$6,source_counts=$7::jsonb,source_log_summary=$8::jsonb,coverage=$9::jsonb WHERE import_id=$1",[importId,result.importedAt,result.sourceTotal,result.importedSignals,result.importedFacilities,result.projectsCreated,JSON.stringify(result.sourceCounts),JSON.stringify(result.sourceLogSummary),JSON.stringify({publishedFrom:result.publishedFrom,publishedTo:result.publishedTo,truncated:result.truncated,changedSignals:result.changedSignals,invalidatedSignals:result.invalidatedSignals,availableSourceCounts:result.availableSourceCounts,selectionStrategy:result.selectionStrategy})]);
    await destination.query("INSERT INTO intel_briefing_runtime(key,value) VALUES('local_real_import',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[JSON.stringify({importedAt:result.importedAt,source:"public_collection_database",counts:{signals:result.importedSignals,facilities:result.importedFacilities,projectsCreated},publishedFrom:result.publishedFrom,publishedTo:result.publishedTo,sourceCounts:result.sourceCounts})]);
    return result;
  } catch (error) {
    await destination.query("ROLLBACK").catch(()=>undefined);
    const safeError = `실제 자료 가져오기 실패 (${String((error as {code?:string}).code??"IMPORT_ERROR").replace(/[^A-Za-z0-9_]/g,"").slice(0,64)})`;
    await destination.query("UPDATE local_intelligence_imports SET status='failed',completed_at=now(),error=$2 WHERE import_id=$1",[importId,safeError]).catch(()=>undefined);
    throw new Error(safeError);
  } finally { await destination.query("SELECT pg_advisory_unlock(hashtext('local-intelligence-live-import'))").catch(()=>undefined);await destination.end(); }
}
