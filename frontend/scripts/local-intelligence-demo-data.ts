import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { normalizeBriefingProfile, kstDate } from "../lib/intel/briefing-schedule";
import { assessPublicServices, scorePublicProject, PROJECT_RULE_VERSION } from "../lib/intel/project-intelligence-rules";
import { OFFICIAL_PROVIDERS, defaultOfficialConfig, emptyOfficialState } from "../lib/intel/official-sources-policy";
import type { IntelProject } from "../lib/intel/project-intelligence-types";

const VERSION = 1;
const IDS = { profileId: "demo_profile_semiconductor", briefingId: "demo_briefing_sample", runId: "demo_run_sample", projectIds: ["demo_project_semiconductor", "demo_project_electronics", "demo_project_delayed"] };
export interface LocalIntelligenceDemoData { initialized: boolean; schemaVersion: number; database: "intel_demo"; actorUserId: "u1"; profileId: string; briefingId: string; runId: string; projectIds: string[] }
interface DemoDatabase { query(sql: string, values?: unknown[]): Promise<unknown> }

function localDatabaseUrl(): URL {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "55439" || url.pathname !== "/intel_demo" || decodeURIComponent(url.username) !== "mcm_intel_test" || url.search || url.hash) {
    throw new Error("로컬 실증 DB만 허용합니다: mcm_intel_test@127.0.0.1:55439/intel_demo");
  }
  return url;
}
async function frontendRoot(): Promise<string> {
  let cursor = path.resolve(process.cwd());
  for (let i = 0; i < 7; i++) {
    for (const candidate of [cursor, path.join(cursor, "frontend")]) {
      try { await access(path.join(candidate, "tests/fixtures/project-intelligence-base.sql")); return candidate; } catch { /* 상위 작업 폴더 확인 */ }
    }
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  throw new Error("로컬 데모 fixture 경로를 찾지 못했습니다. 작업 트리 또는 frontend에서 실행하세요.");
}
/** 비어 있는 독립 DB만 초기화한다. 이 함수에는 기존 테이블·사용자 자료를 삭제하는 경로가 없다. */
export async function initializeLocalIntelligenceDemo(): Promise<LocalIntelligenceDemoData> {
  const url = localDatabaseUrl(), root = await frontendRoot();
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString(), ssl: false });
  try {
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_demo'")).rowCount) {
      try { await admin.query("CREATE DATABASE intel_demo"); } catch (error) { if ((error as { code?: string }).code !== "42P04") throw error; }
    }
  } finally { await admin.end(); }
  const db = new Client({ connectionString: url.toString(), ssl: false });
  try {
    await db.connect(); await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('local-intelligence-demo-initialize'))");
    const tables = (await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' AND schemaname NOT LIKE 'pg_temp%'")).rows.map((row: { schemaname: string; tablename: string }) => `${row.schemaname}.${row.tablename}`);
    if (tables.includes("public.local_intelligence_demo_metadata")) {
      const state = (await db.query("SELECT schema_version,complete FROM local_intelligence_demo_metadata WHERE singleton=true")).rows[0];
      if (!state?.complete || Number(state.schema_version) !== VERSION) throw new Error("기존 로컬 데모 DB의 버전이 다르거나 초기화가 불완전합니다. 기존 자료를 보존하고 중단했습니다.");
      await ensureV1ReadSchema(db);
      await db.query("COMMIT");
      return { initialized: false, schemaVersion: VERSION, database: "intel_demo", actorUserId: "u1", ...IDS };
    }
    if (tables.length) throw new Error("intel_demo에 기존 테이블이 있어 초기화를 중단했습니다. 자동 삭제·덮어쓰기는 수행하지 않습니다.");
    const projectFixture = (await readFile(path.join(root, "tests/fixtures/project-intelligence-base.sql"), "utf8")).replace(/^CREATE TABLE (scraper_sources|intel_source_documents|intel_source_document_revisions)\(.*\);\r?\n/gm, "");
    await db.query(projectFixture);
    const sourceTables = (await readFile(path.join(root, "tests/fixtures/official-sources-base.sql"), "utf8")).split(/\r?\n/).filter(line => /^CREATE TABLE scraper_(sources|endpoints)\(/.test(line));
    if (sourceTables.length !== 2) throw new Error("공식 소스 fixture의 테이블 정의를 확인하세요.");
    await db.query(sourceTables.join("\n"));
    await db.query(`
      CREATE TABLE local_intelligence_demo_metadata(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),schema_version integer NOT NULL,complete boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE users ADD COLUMN email text,ADD COLUMN name text,ADD COLUMN email_local text;
      ALTER TABLE departments ADD COLUMN display_order integer NOT NULL DEFAULT 0;
      CREATE TABLE positions(position_id text PRIMARY KEY,position_name text,rank_order integer);
      ALTER TABLE employee_profiles ADD COLUMN user_id text,ADD COLUMN position_id text REFERENCES positions(position_id);
      ALTER TABLE contracts ADD COLUMN contract_title text,ADD COLUMN status text DEFAULT 'active';
      ALTER TABLE intel_signals ADD COLUMN region text,ADD COLUMN raw_json text,ADD COLUMN relevance_note text,ADD COLUMN match_type text,
        ADD COLUMN corp_code text,ADD COLUMN brn text,ADD COLUMN asset_class text,ADD COLUMN acquire_purpose text,ADD COLUMN counterparty text,ADD COLUMN agency text;
      CREATE TABLE intel_rag_briefings(briefing_id text PRIMARY KEY,question text NOT NULL,answer_md text,sources jsonb,filters jsonb,model text,status text,error text,created_by text,created_at text);
      CREATE TABLE intel_embeddings(signal_id text PRIMARY KEY,content text,model text,content_hash text,updated_at text);
      CREATE TABLE intel_collect_state(source text PRIMARY KEY,last_run_at text,last_cursor text,updated_at text);
      CREATE TABLE alerts(id bigserial PRIMARY KEY,severity text,source text,code text,title text,body text,payload_json jsonb,created_at text);
      INSERT INTO positions VALUES('demo_executive','[예시] 영업임원',1),('demo_manager','[예시] 영업담당',2);
      UPDATE users SET email=user_id||'@demo.invalid',email_local=user_id,name=CASE user_id WHEN 'u1' THEN '[예시] 김영업 임원' ELSE '[예시] 이마케팅 담당' END;
      UPDATE employee_profiles SET user_id=CASE employee_id WHEN 'e1' THEN 'u1' ELSE 'u2' END,name=CASE employee_id WHEN 'e1' THEN '[예시] 김영업 임원' ELSE '[예시] 이마케팅 담당' END,position_id=CASE employee_id WHEN 'e1' THEN 'demo_executive' ELSE 'demo_manager' END;
      UPDATE departments SET dept_name=CASE dept_id WHEN 'd1' THEN '[예시] 전략영업팀' ELSE '[예시] 영업지원팀' END;
      UPDATE facilities SET company_name='[예시] 한빛반도체',normalized_company_name='한빛반도체',source='local_demo',memo='로컬 체험을 위한 가상 사업장입니다.',created_at=now()::text,updated_at=now()::text;
      UPDATE contracts SET contract_title='[예시] 기존 환경자문 계약';
      UPDATE sales_projects SET title=CASE project_id WHEN 'legacy_sales' THEN '[예시] 한빛반도체 환경자문' ELSE '[예시] 담당부서 제한 영업건' END,priority='normal',opened_at=current_date::text,created_by='u1',created_at=now()::text,updated_at=now()::text;
      UPDATE intel_signals SET company_name='[예시] 한빛반도체',report_name='[예시] 기존 공장 증설 발표',summary='실제 발표가 아닌 로컬 체험용 가상 증설 자료입니다.',region='경기도 용인시',industry_relevance='direct',disclosed_at=current_date::text,created_at=now()::text,updated_at=now()::text;
    `);
    for (const file of ["319_official_intelligence_sources.sql", "320_project_intelligence.sql", "131_rag_briefing_share.sql", "132_scraper_run_logs.sql", "095_mail_core.sql", "096_mail_folders.sql", "098_mail_folders_sys_unique.sql", "321_scheduled_intelligence_briefings.sql"]) {
      const sql = (await readFile(path.join(root, "../infra/aws", file), "utf8")).replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, "");
      await db.query(sql);
    }
    await seedExamples(db);
    await ensureV1ReadSchema(db);
    await db.query("INSERT INTO local_intelligence_demo_metadata(singleton,schema_version,complete) VALUES(true,$1,true)", [VERSION]);
    await db.query("COMMIT");
    return { initialized: true, schemaVersion: VERSION, database: "intel_demo", actorUserId: "u1", ...IDS };
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await db.end(); }
}

/** v1 체험 데이터의 입력 내용은 유지하면서 영업 상세 조회에 필요한 열만 보완한다. */
async function ensureV1ReadSchema(db: DemoDatabase): Promise<void> {
  await db.query("ALTER TABLE intel_rag_briefing_shares ADD COLUMN IF NOT EXISTS explicit_share boolean NOT NULL DEFAULT false");
  await db.query(`INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect)
    SELECT 'local-briefing-'||t.template_id||'-'||k.key,t.template_id,k.key,'all','allow'
    FROM permission_templates t CROSS JOIN unnest(ARRAY['intel.briefing.view','intel.briefing.create','intel.briefing.share']) k(key)
    WHERE t.template_id IN('all','restricted') AND NOT EXISTS(SELECT 1 FROM permission_template_grants g WHERE g.template_id=t.template_id AND g.permission_key=k.key)`);
  await db.query("ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS photo_public_path text");
  await db.query("CREATE TABLE IF NOT EXISTS facility_contact_people(id bigserial PRIMARY KEY,facility_id text REFERENCES facilities(facility_id),person_name text,title text)");
}

async function seedExamples(db: DemoDatabase): Promise<void> {
  const now = new Date().toISOString(), today = kstDate(), day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  for (const provider of OFFICIAL_PROVIDERS) {
    await db.query("INSERT INTO scraper_sources(source_id,slug,name,purpose,enabled,base_url,official_provider,official_config,created_at,updated_at) VALUES($1,$1,$2,'intel',0,$3,$4,$5::jsonb,$6,$6)", [`official_${provider.id}`, provider.name, provider.homeUrl, provider.id, JSON.stringify(emptyOfficialState()), now]);
    await db.query("INSERT INTO scraper_endpoints(endpoint_id,source_id,name,api_config,enabled,created_at,updated_at) VALUES($1,$2,$3,$4::jsonb,0,$5,$5)", [`official_endpoint_${provider.id}`, `official_${provider.id}`, provider.name, JSON.stringify(defaultOfficialConfig(provider)), now]);
  }
  for (const uid of ["u1", "u2"]) {
    await db.query("INSERT INTO mailboxes(mailbox_id,user_id,employee_id,address,local_part,display_name,status,created_at,updated_at) VALUES($1,$2,$3,$4,$2,$5,'active',$6,$6)", [`demo_mailbox_${uid}`, uid, uid === "u1" ? "e1" : "e2", `${uid}@demo.invalid`, uid === "u1" ? "[예시] 영업임원" : "[예시] 영업담당", now]);
    for (const [sort, kind] of ["inbox", "sent", "drafts", "trash", "archive", "spam"].entries()) await db.query("INSERT INTO mail_folders(folder_id,mailbox_id,name,system_kind,sort,created_at) VALUES($1,$2,$3,$3,$4,$5)", [`demo_folder_${uid}_${kind}`, `demo_mailbox_${uid}`, kind, sort, now]);
  }
  await db.query("INSERT INTO intel_facility_candidates(candidate_id,company_name,site_address,industry,evidence,status,owning_dept_id,created_by) VALUES('demo_candidate_electronics','[예시] 새빛전자부품','충청북도 청주시 흥덕구 예시산단 20','electronics',$1::jsonb,'new','d1','u1')", [JSON.stringify({ signalIds: ["demo_signal_2"], note: "실제 기업·주소가 아닌 신규 사업장 검토 예시" })]);
  const specs = [
    { id: IDS.projectIds[0], title: "[예시] 한빛반도체 용인 생산시설 증설", company: "[예시] 한빛반도체", industry: "semiconductor", region: "경기도 용인시", facility: "f1", candidate: null, stage: "permitting" as const, amount: 120000000000, summary: "로컬 예시: 생산시설 증설과 특수가스·용제 공정 검토, VOC 저감 및 탄소배출 관리 계획. 실제 투자 발표가 아닙니다.", start: day(60) },
    { id: IDS.projectIds[1], title: "[예시] 새빛전자부품 청주 신설 공장", company: "[예시] 새빛전자부품", industry: "electronics", region: "충청북도 청주시", facility: null, candidate: "demo_candidate_electronics", stage: "announced" as const, amount: 35000000000, summary: "로컬 예시: 전자부품 신설 공장 투자와 폐수처리·환경 인허가 계획. 신규 사업장 등록 검토를 체험할 수 있습니다.", start: day(150) },
    { id: IDS.projectIds[2], title: "[예시] 한빛반도체 청주 증설 일정 조정", company: "[예시] 한빛반도체", industry: "semiconductor", region: "충청북도 청주시", facility: "f2", candidate: null, stage: "delayed" as const, amount: null, summary: "로컬 예시: 증설 일정이 조정되었고 투자금액은 미확인입니다. 변경 사유와 인허가 일정을 먼저 확인할 대상입니다.", start: null },
  ];
  for (const [index, spec] of specs.entries()) {
    const signalId = `demo_signal_${index + 1}`;
    await db.query("INSERT INTO intel_signals(signal_id,source,external_id,company_name,report_name,summary,signal_type,signal_grade,amount,url,disclosed_at,facility_id,industry,industry_relevance,region,raw_json,created_at,updated_at) VALUES($1,'news',$1,$2,$3,$4,$5,'confirmed',$6,$7,$8,$9,$10,'direct',$11,$12,$13,$13)", [signalId, spec.company, spec.title, spec.summary, index === 1 ? "new_factory" : "expansion", spec.amount, `https://example.invalid/local-demo/${signalId}`, today, spec.facility, spec.industry, spec.region, JSON.stringify({ localDemo: true }), now]);
    await db.query("INSERT INTO intel_projects(project_id,title,company_name,facility_id,candidate_id,industry,region,stage,amount,currency,amount_scope,public_summary,expected_start_at,expected_end_at,owning_dept_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'KRW','single_facility',$10,$11,$12,'d1','u1')", [spec.id, spec.title, spec.company, spec.facility, spec.candidate, spec.industry, spec.region, spec.stage, spec.amount, spec.summary, spec.start, spec.start ? day(365) : null]);
    await db.query("INSERT INTO intel_project_signals(project_id,signal_id,reason,reviewed,created_by) VALUES($1,$2,'로컬 예시 근거',true,'u1')", [spec.id, signalId]);
    await db.query("INSERT INTO intel_project_events(event_id,project_id,event_type,version,title,occurred_at,before_json,after_json,evidence_signal_ids,mode,confirmed,event_key,created_by) VALUES($1,$2,'demo_example',1,$3,$4,$5::jsonb,$6::jsonb,$7::text[],'initial_backfill',true,$1,'u1')", [`demo_event_${index + 1}`, spec.id, spec.title, today, JSON.stringify({ stage: index === 2 ? "announced" : "unknown" }), JSON.stringify({ stage: spec.stage, amount: spec.amount, localDemo: true }), [signalId]]);
    const project = { title: spec.title, publicSummary: spec.summary, industry: spec.industry, stage: spec.stage, amount: spec.amount, currency: "KRW", expectedStartAt: spec.start } as IntelProject;
    const services = assessPublicServices(project, [signalId]), priority = scorePublicProject(project, services, "confirmed", today);
    for (const service of services) await db.query("INSERT INTO intel_service_assessments(assessment_id,project_id,project_version,service_code,assessment,rule_version) VALUES($1,$2,1,$3,$4::jsonb,$5)", [`demo_service_${index}_${service.serviceCode}`, spec.id, service.serviceCode, JSON.stringify(service), PROJECT_RULE_VERSION]);
    await db.query("INSERT INTO intel_priority_assessments(assessment_id,project_id,project_version,assessment,rule_version,as_of) VALUES($1,$2,1,$3::jsonb,$4,$5)", [`demo_priority_${index}`, spec.id, JSON.stringify(priority), PROJECT_RULE_VERSION, today]);
  }
  await db.query("INSERT INTO intel_business_links(link_id,project_id,sales_project_id,service_code,scope_key,created_by) VALUES('demo_business_link',$1,'legacy_sales','integrated_permit','local-example','u1')", [IDS.projectIds[0]]);
  await db.query("INSERT INTO intel_action_suggestions(action_id,project_id,title,activity_type,assignee_employee_id,scheduled_at,status,evidence_signal_ids,sales_project_id,created_by) VALUES('demo_action',$1,'[예시] 증설 범위와 인허가 일정 확인','email','e1',$2,'proposed',ARRAY['demo_signal_1'],'legacy_sales','u1')", [IDS.projectIds[0], `${day(1)}T10:00:00`]);
  const profile = normalizeBriefingProfile({ name: "[예시] 반도체·전자부품 주간 브리핑", enabled: false, visibility: "shared", filters: { industries: ["semiconductor", "electronics"], regions: [], signalTypes: [], companyNames: [], services: [], amountMin: null, amountMax: null, includeUnknownScale: true }, schedule: { cadence: "weekly", startDate: today, time: "08:30", weekday: 1, monthDay: 1, timezone: "Asia/Seoul" }, recipients: [{ userId: "u1", channels: ["inbox"] }, { userId: "u2", channels: ["inbox"] }], importantAlerts: true, importantAmount: 10000000000, allowPartialSources: true, reportLevel: "detailed" }, "u1");
  const profileSnapshot = { ...profile, profileId: IDS.profileId, ownerUserId: "u1", version: 1, nextRunAt: null, createdAt: now, updatedAt: now, canManage: true };
  await db.query("INSERT INTO intel_briefing_profiles(profile_id,owner_user_id,name,config) VALUES($1,'u1',$2,$3::jsonb)", [IDS.profileId, profile.name, JSON.stringify(profile)]);
  for (const uid of ["u1", "u2"]) await db.query("INSERT INTO intel_briefing_recipients(profile_id,user_id,channels) VALUES($1,$2,'[\"inbox\"]')", [IDS.profileId, uid]);
  await db.query("INSERT INTO intel_briefing_runs(run_id,profile_id,trigger,request_key,scheduled_for,profile_version,config_snapshot,status,requested_by) VALUES($1,$2,'manual','local-demo-seed',$3,1,$4::jsonb,'published','u1')", [IDS.runId, IDS.profileId, now, JSON.stringify(profileSnapshot)]);
  const items = specs.map((spec, i) => ({ id: `signal:demo_signal_${i + 1}`, revision: "local-example-v1", kind: "signal", title: spec.title, companyName: spec.company, region: spec.region, source: "news", url: `https://example.invalid/local-demo/demo_signal_${i + 1}`, publishedAt: today, discoveredAt: now, text: spec.summary, changed: true, amount: spec.amount, temporalClass: "initial_baseline" }));
  await db.query("INSERT INTO intel_briefing_snapshots(snapshot_id,run_id,as_of,payload) VALUES('demo_snapshot',$1,$2,$3::jsonb)", [IDS.runId, now, JSON.stringify({ totalProjects: 3, totalSignals: 3, changedCount: 3, sourceHealth: [], items, asOf: now, capturedAt: now, periodStart: now, periodEnd: now, initialBaseline: true, coverageNote: "로컬 예시 자료입니다. 실제 수집·AI 분석 결과가 아닙니다." })]);
  const report = { kpis: [{ label: "예시 프로젝트", value: "3개", sub: "가상 체험 자료" }, { label: "확인할 일정 변경", value: "1건", sub: "가상 지연 사례" }, { label: "신규 사업장 후보", value: "1개", sub: "등록 전 검토" }, { label: "보고서 구분", value: "로컬 예시", sub: "실제 AI 생성 아님" }], trends: ["이 보고서는 화면 체험을 위한 가상 예시입니다. 실제 시장 동향이나 기업 투자 발표가 아닙니다.", "한빛반도체 예시에서는 증설 인허가 일정, 새빛전자부품 예시에서는 신규 사업장 확인이 우선입니다. [1][2]", "금액 미상·일정 지연 사례는 확인 질문을 먼저 준비합니다. [3]"], companies: specs.map((spec, i) => ({ name: spec.company, region: spec.region, status: spec.stage, project: spec.title, desc: `${spec.summary} [${i + 1}]`, facts: [{ label: "예시 투자액", value: spec.amount == null ? "미확인" : `${(spec.amount / 100000000).toLocaleString()}억원` }], note: null })), insights: [{ badge: "확인 필요", text: "서비스 검토 결과에서 확인 질문을 검토하고 담당자·일정을 지정한 후 활동 제안을 채택해 보세요. [1]" }], etcNote: "가상 기업·가상 투자 정보만 사용했습니다. 외부 API와 외부 메일은 호출하지 않았습니다." };
  const sources = items.map(item => ({ signalId: item.id.slice(7), score: null, source: "news", companyName: item.companyName, reportName: item.title, disclosedAt: today, facilityName: null, url: item.url, kind: "signal", revision: item.revision }));
  await db.query("INSERT INTO intel_rag_briefings(briefing_id,question,answer_md,sources,filters,model,status,created_by,created_at,access_scope,profile_id,run_id,snapshot_id,schema_version) VALUES($1,'[로컬 예시] 관심 산업 브리핑',$2,$3::jsonb,$4::jsonb,'local-example-not-ai','done','u1',$5,'restricted',$6,$7,'demo_snapshot',2)", [IDS.briefingId, JSON.stringify(report), JSON.stringify(sources), JSON.stringify(profile.filters), now, IDS.profileId, IDS.runId]);
  await db.query("UPDATE intel_briefing_runs SET briefing_id=$2,snapshot_id='demo_snapshot' WHERE run_id=$1", [IDS.runId, IDS.briefingId]);
  for (const uid of ["u1", "u2"]) {
    await db.query("INSERT INTO intel_rag_briefing_shares(share_id,briefing_id,recipient_user_id,shared_by,created_at) VALUES($1,$2,$3,'u1',$4)", [`demo_share_${uid}`, IDS.briefingId, uid, now]);
    await db.query("INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,briefing_id,user_id,channel,kind,payload) VALUES($1,$1,$2,$3,$4,'inbox','briefing',$5::jsonb)", [`demo_delivery_${uid}`, IDS.profileId, IDS.briefingId, uid, JSON.stringify({ title: "[로컬 예시] 관심 산업 브리핑", text: "가상 자료로 구성한 체험용 보고서가 준비되었습니다. 실제 수집 또는 AI 생성 결과가 아닙니다.", link: `/sales/rag?tab=scheduled&runId=${IDS.runId}` })]);
  }
}
