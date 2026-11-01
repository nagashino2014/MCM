import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { checkPermission, loadUserAccess, type UserAccess } from "@/lib/auth/rbac";
import { createSalesProjectInTransaction, createActivityInTransaction } from "@/lib/sales/queries";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";
import { markReviewedWrite } from "@/lib/ieps/facility-update";
import { extractRegion } from "@scraper/lib/ieps/region";
import { ACTIVITY_TYPES, type SalesActivityType } from "@/lib/sales/types";
import { assertOfficialSignalVisible, officialSignalVisibleCondition } from "./official-sources-visibility";
import { newsContentQualityCondition } from "./news-content-quality";
import { activityDate, assessPublicServices, intelError, isoDate, normalizeProjectInput, optionalText, positiveVersion, PROJECT_RULE_VERSION, recommendProjectActions, requiredText, scorePublicProject, serviceCode, stringIds } from "./project-intelligence-rules";
import type { ActionSuggestion, BriefingProjectFilter, FacilityCandidate, IntelIngestionMode, IntelProject, IntelProjectEvent, IntelProjectInput, LinkProjectInput, ManualPriority, PublicPriority, ServiceAssessment } from "./project-intelligence-types";
export type { IntelProject, BriefingProjectFilter } from "./project-intelligence-types";

type Row = Record<string, unknown>;
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const str = (v: unknown) => v == null ? null : String(v);
const dt = (v: unknown) => v instanceof Date ? v.toISOString() : String(v ?? "");
const day = (v: unknown) => v == null ? null : dt(v).slice(0, 10);
const obj = (v: unknown): Row => typeof v === "string" ? JSON.parse(v) : (v ?? {}) as Row;
async function rows(db: PgDatabase, sql: string, params: unknown[] = []): Promise<Row[]> { return rowsToObjects(await db.exec(sql, params)); }
async function one(db: PgDatabase, sql: string, params: unknown[] = []): Promise<Row | null> { return (await rows(db, sql, params))[0] ?? null; }
async function audit(db: PgDatabase, actor: string | null, action: string, table: string, id: string, before: unknown, after: unknown) {
  await db.run("INSERT INTO audit_log(actor_user_id,action,target_table,target_id,before_json,after_json,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)", [actor, action, table, id, JSON.stringify(before), JSON.stringify(after), new Date().toISOString()]);
}
export function mapIntelProject(r: Row): IntelProject {
  return { projectId: String(r.project_id), title: String(r.title), companyName: str(r.company_name), facilityId: str(r.facility_id), candidateId: str(r.candidate_id), industry: str(r.industry), region: str(r.region),
    stage: String(r.stage) as IntelProject["stage"], amount: r.amount == null ? null : Number(r.amount), currency: String(r.currency), amountScope: String(r.amount_scope), publicSummary: str(r.public_summary),
    expectedStartAt: day(r.expected_start_at), expectedEndAt: day(r.expected_end_at), version: Number(r.version), state: String(r.state) as IntelProject["state"], mergedIntoId: str(r.merged_into_id),
    owningDeptId: str(r.owning_dept_id), createdBy: str(r.created_by), createdAt: dt(r.created_at), updatedAt: dt(r.updated_at), priority: r.priority ? obj(r.priority) as unknown as PublicPriority : null };
}
function mapEvent(r: Row): IntelProjectEvent & { confirmed: boolean } {
  return { eventId: String(r.event_id), projectId: String(r.project_id), eventType: String(r.event_type), version: Number(r.version), title: String(r.title), occurredAt: day(r.occurred_at), discoveredAt: dt(r.discovered_at),
    before: obj(r.before_json), after: obj(r.after_json), evidenceSignalIds: (r.evidence_signal_ids ?? []) as string[], revisionIds: (r.revision_ids ?? []) as string[], mode: r.mode as IntelIngestionMode, correctsEventId: str(r.corrects_event_id), confirmed: r.confirmed === true };
}
function requireKey(access: UserAccess, permission: string, target: Parameters<typeof checkPermission>[2] = {}) {
  if (!checkPermission(access, permission, target)) throw intelError("이 작업에 필요한 권한이 없습니다.", 403);
}
function requirePublicEdit(access: UserAccess, r: { owning_dept_id?: unknown; created_by?: unknown }) {
  const deptId = str(r.owning_dept_id);
  // 참여자 권한으로 아직 참여관계가 없는 공용 후보·타부서 프로젝트를 수정할 수 없다.
  const eligible = access.grants.some((g) => g.permissionKey === "sales.edit" && g.effect === "allow" && (g.scopeKind === "all" || !!deptId && (g.scopeKind === "self_dept" && access.postDeptIds.includes(deptId) || g.scopeKind === "specific_dept" && g.scopeDeptId === deptId)));
  if (!eligible) throw intelError("이 인텔 항목을 수정할 부서 또는 전사 권한이 필요합니다.", 403);
  requireKey(access, "sales.edit", { ...(deptId ? { deptId } : {}), userId: str(r.created_by) ?? access.userId });
}
async function lockedProject(db: PgDatabase, projectId: string, version?: number): Promise<Row> {
  const p = await one(db, "SELECT * FROM intel_projects WHERE project_id=$1 FOR UPDATE", [projectId]);
  if (!p) throw intelError("투자 프로젝트를 찾을 수 없습니다.", 404);
  if (p.state !== "active") throw intelError("병합되거나 보관된 프로젝트입니다.", 409);
  if (version != null && Number(p.version) !== positiveVersion(version)) throw intelError("다른 사용자가 변경했습니다. 최신 내용을 다시 확인하세요.", 409);
  await assertProjectEvidenceVisible(db,projectId);
  return p;
}
/** 분리·병합 후에도 상세 사건 이력에 남는 공식 근거의 현재 권리를 확인한다. */
async function assertProjectEvidenceVisible(db:PgDatabase,projectId:string){
  const ids=await rows(db,`WITH RECURSIVE lineage(project_id) AS (SELECT project_id FROM intel_projects WHERE project_id=$1 UNION ALL SELECT p.project_id FROM intel_projects p JOIN lineage l ON p.merged_into_id=l.project_id), evidence(signal_id) AS (SELECT ps.signal_id FROM intel_project_signals ps JOIN lineage l ON l.project_id=ps.project_id UNION SELECT unnest(e.evidence_signal_ids) FROM intel_project_events e JOIN lineage l ON l.project_id=e.project_id) SELECT DISTINCT s.signal_id FROM evidence JOIN intel_signals s USING(signal_id) WHERE s.source LIKE 'official:%'`,[projectId]);
  for(const id of ids)await assertOfficialSignalVisible(String(id.signal_id),db);
}
async function assertCandidateEvidenceVisible(db:PgDatabase,candidate:Row){
  await validateSignals(db,stringIds(obj(candidate.evidence).signalIds,1000));
  const projects=await rows(db,"SELECT project_id FROM intel_projects WHERE candidate_id=$1",[candidate.candidate_id]);for(const p of projects)await assertProjectEvidenceVisible(db,String(p.project_id));
}
async function validateFacility(db: PgDatabase, facilityId: string | null | undefined) {
  if (facilityId && !await one(db, "SELECT facility_id FROM facilities WHERE facility_id=$1 AND deleted_at IS NULL", [facilityId])) throw intelError("유효한 사업장을 선택하세요.");
}
async function validateSignals(db: PgDatabase, ids: string[]) {
  if (!ids.length) return;
  const found = await rows(db, "SELECT signal_id FROM intel_signals WHERE signal_id=ANY($1::text[])", [ids]);
  if (found.length !== ids.length) throw intelError("존재하지 않는 근거 신호가 포함되어 있습니다.");
  for(const id of ids)await assertOfficialSignalVisible(id,db);
}
async function projectSignals(db: PgDatabase, projectId: string): Promise<string[]> { return (await rows(db, "SELECT signal_id FROM intel_project_signals WHERE project_id=$1 ORDER BY signal_id", [projectId])).map((r) => String(r.signal_id)); }
async function connectSignals(db: PgDatabase, projectId: string, ids: string[], actor: string | null, reason: string, reviewed = true) {
  await validateSignals(db, ids);
  for (const signalId of ids) await db.run("INSERT INTO intel_project_signals(project_id,signal_id,reason,reviewed,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,signal_id) DO NOTHING", [projectId, signalId, reason, reviewed, actor]);
}
async function appendEvent(db: PgDatabase, p: Row, data: { type: string; title: string; before?: Row; after?: Row; signalIds: string[]; revisionIds?: string[]; mode?: IntelIngestionMode; occurredAt?: string | null; confirmed?: boolean; key?: string; correctsEventId?: string | null }, actor: string | null) {
  const projectId = String(p.project_id); await validateSignals(db, data.signalIds);
  const linked = await projectSignals(db, projectId);
  if (data.signalIds.some((id) => !linked.includes(id))) throw intelError("사건의 근거는 해당 프로젝트에 연결된 신호여야 합니다.");
  const revisionIds = data.revisionIds ?? [];
  if (revisionIds.length) {
    const found = await rows(db, "SELECT r.revision_id FROM intel_source_document_revisions r JOIN intel_source_documents d ON d.document_id=r.document_id WHERE r.revision_id=ANY($1::text[]) AND d.signal_id=ANY($2::text[])", [revisionIds, data.signalIds]);
    if (found.length !== revisionIds.length) throw intelError("문서 버전과 사건 근거가 일치하지 않습니다.");
  }
  if (data.correctsEventId && !await one(db, "SELECT event_id FROM intel_project_events WHERE event_id=$1 AND project_id=$2", [data.correctsEventId, projectId])) throw intelError("정정할 원사건이 이 프로젝트에 속하지 않습니다.");
  const eventKey = data.key ?? hash([data.type, data.before ?? {}, data.after ?? {}, data.signalIds.slice().sort(), data.correctsEventId]);
  const existing = await one(db, "SELECT * FROM intel_project_events WHERE project_id=$1 AND event_key=$2", [projectId,eventKey]);
  if (existing) return mapEvent(existing);
  const last = await one(db, "SELECT COALESCE(MAX(version),0)+1 AS version FROM intel_project_events WHERE project_id=$1", [projectId]);
  const id = uid("ipe");
  const event = await one(db, `INSERT INTO intel_project_events(event_id,project_id,event_type,version,title,occurred_at,before_json,after_json,evidence_signal_ids,revision_ids,mode,confirmed,event_key,corrects_event_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::text[],$10::text[],$11,$12,$13,$14,$15) RETURNING *`,
    [id,projectId,data.type,Number(last?.version),data.title,data.occurredAt??null,JSON.stringify(data.before??{}),JSON.stringify(data.after??{}),data.signalIds,revisionIds,data.mode??"live",!!data.confirmed&&data.signalIds.length>0,eventKey,data.correctsEventId??null,actor]);
  return mapEvent(event!);
}
export async function listProjectEvents(input: { after?: string; asOf?: string; mode?: IntelIngestionMode; limit?: number; offset?: number; confirmedOnly?: boolean; projectId?: string } = {}) {
  const db = await getDb(); const params: unknown[] = []; const where = ["1=1"]; const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if(input.projectId)await assertProjectEvidenceVisible(db,input.projectId);
  where.push(`NOT EXISTS(SELECT 1 FROM intel_signals rights_signal WHERE rights_signal.signal_id=ANY(e.evidence_signal_ids) AND NOT (${officialSignalVisibleCondition("rights_signal")} AND ${newsContentQualityCondition("rights_signal")}))`);
  if (input.after) where.push(`e.discovered_at > ${add(input.after)}::timestamptz`);
  if (input.asOf) where.push(`e.discovered_at <= ${add(input.asOf)}::timestamptz`);
  if (input.mode) where.push(`e.mode=${add(input.mode)}`);
  if (input.confirmedOnly) where.push("e.confirmed=true");
  if (input.projectId) where.push(`e.project_id=${add(input.projectId)}`);
  return (await rows(db, `SELECT e.* FROM intel_project_events e WHERE ${where.join(" AND ")} ORDER BY e.discovered_at,e.event_id LIMIT ${add(Math.min(5000,Math.max(1,input.limit??500)))} OFFSET ${add(Math.max(0,input.offset??0))}`, params)).map(mapEvent);
}
export async function queryBriefingProjects(filter: BriefingProjectFilter = {}, options: { asOf?: string; db?: PgDatabase } = {}) {
  const db = options.db ?? await getDb(); const params: unknown[]=[]; const where=["p.state='active'"]; const add=(v:unknown)=>{params.push(v);return `$${params.length}`;};
  for(const stamp of [filter.from,filter.to,options.asOf])if(stamp&&!Number.isFinite(Date.parse(stamp)))throw intelError("조회 기간을 확인하세요.");
  if(filter.amountMin!=null&&filter.amountMax!=null&&filter.amountMin>filter.amountMax)throw intelError("최소 규모는 최대 규모보다 클 수 없습니다.");
  for(const number of [filter.limit,filter.offset])if(number!=null&&!Number.isSafeInteger(number))throw intelError("페이지 범위를 확인하세요.");
  if(filter.q?.trim()){const q=add(optionalText(filter.q,300));where.push(`(strpos(lower(p.title),lower(${q}))>0 OR strpos(lower(COALESCE(p.company_name,'')),lower(${q}))>0)`);}
  if(filter.reviewState){if(!["confirmed","needs_review"].includes(filter.reviewState))throw intelError("검토 상태를 확인하세요.");where.push(`COALESCE((SELECT (pa.assessment->>'needsReview')::boolean FROM intel_priority_assessments pa WHERE pa.project_id=p.project_id AND pa.project_version=p.version ORDER BY pa.created_at DESC LIMIT 1),true)=${add(filter.reviewState==="needs_review")}`);}
  where.push("(p.created_by IS NOT NULL OR p.ingestion_key IS NULL OR p.ingestion_key NOT LIKE 'signal:%' OR EXISTS(SELECT 1 FROM intel_signals origin WHERE 'signal:'||origin.signal_id=p.ingestion_key AND origin.signal_grade<>'excluded' AND origin.status<>'dismissed' AND origin.duplicate_of IS NULL))");
  where.push(`NOT EXISTS(SELECT 1 FROM intel_signals rights_signal WHERE (EXISTS(SELECT 1 FROM intel_project_signals ps WHERE ps.project_id=p.project_id AND ps.signal_id=rights_signal.signal_id) OR EXISTS(SELECT 1 FROM intel_project_events e WHERE e.project_id=p.project_id AND rights_signal.signal_id=ANY(e.evidence_signal_ids))) AND NOT (${officialSignalVisibleCondition("rights_signal")} AND ${newsContentQualityCondition("rights_signal")}))`);
  // 파생 제목·요약·점수도 원자료의 현재 권리를 따른다. 혼합 근거 중 제한된 공식 자료가 있으면 재평가 전까지 전체 프로젝트를 제외한다.
  where.push(`NOT EXISTS(SELECT 1 FROM intel_project_signals ps JOIN intel_source_documents d ON d.signal_id=ps.signal_id JOIN scraper_sources src ON src.source_id=d.source_id LEFT JOIN intel_source_document_revisions rv ON rv.revision_id=d.current_revision_id WHERE ps.project_id=p.project_id AND src.official_provider IS NOT NULL AND (d.status<>'available' OR COALESCE(src.official_config->>'enabled','false')<>'true' OR src.official_config->>'verifiedAt' IS NULL OR COALESCE(src.official_config->'permissions'->>'aiAllowed','false')<>'true' OR COALESCE(src.official_config->'permissions'->>'internalReportAllowed','false')<>'true' OR COALESCE(src.official_config->'permissions'->>'storageAllowed','false')<>'true' OR COALESCE(rv.rights_snapshot->>'aiAllowed','false')<>'true' OR COALESCE(rv.rights_snapshot->>'internalReportAllowed','false')<>'true' OR COALESCE(rv.rights_snapshot->>'storageAllowed','false')<>'true'))`);
  if (filter.industries?.length) where.push(`p.industry=ANY(${add(stringIds(filter.industries))}::text[])`);
  if (filter.regions?.length) where.push(`EXISTS(SELECT 1 FROM unnest(${add(stringIds(filter.regions))}::text[]) region WHERE p.region=region OR p.region LIKE region||' %')`);
  if (filter.companyNames?.length) where.push(`p.company_name=ANY(${add(stringIds(filter.companyNames))}::text[])`);
  if (filter.types?.length) where.push(`(p.stage=ANY(${add(stringIds(filter.types))}::text[]) OR EXISTS(SELECT 1 FROM intel_project_signals ps JOIN intel_signals s ON s.signal_id=ps.signal_id WHERE ps.project_id=p.project_id AND s.signal_type=ANY(${add(filter.types)}::text[])))`);
  if (filter.serviceCodes?.length) { filter.serviceCodes.forEach(serviceCode); where.push(`EXISTS(SELECT 1 FROM intel_service_assessments a WHERE a.project_id=p.project_id AND a.project_version=p.version AND a.service_code=ANY(${add(filter.serviceCodes)}::text[]) AND a.assessment->>'status'='possible')`); }
  const amount: string[]=[];
  for (const [value,op] of [[filter.amountMin,">="],[filter.amountMax,"<="]] as const) if(value != null){ if(!Number.isFinite(value)||value<0)throw intelError("규모 조건을 확인하세요.");amount.push(`p.amount ${op} ${add(value)}`); }
  if(amount.length)where.push(`((p.currency='KRW' AND ${amount.join(" AND ")})${filter.includeUnknownAmount !== false ? " OR p.amount IS NULL OR p.currency<>'KRW'" : ""})`);
  if(filter.from)where.push(`p.updated_at>=${add(filter.from)}::timestamptz`);
  if(filter.to)where.push(`p.updated_at<=${add(filter.to)}::timestamptz`);
  if(options.asOf)where.push(`p.updated_at<=${add(options.asOf)}::timestamptz`);
  const clause=where.join(" AND "); const total=Number((await one(db,`SELECT count(*) AS total FROM intel_projects p WHERE ${clause}`,params))?.total??0);
  const limit=Math.min(5000,Math.max(1,filter.limit??50)); const offset=Math.max(0,filter.offset??0);
  const order=filter.sortByPriority?"COALESCE((a.assessment->>'needsReview')::boolean,true) ASC,(a.assessment->>'score')::numeric DESC NULLS LAST,p.updated_at DESC,p.project_id":"p.updated_at DESC,p.project_id";
  const result=await rows(db,`SELECT p.*,a.assessment AS priority FROM intel_projects p LEFT JOIN LATERAL(SELECT assessment FROM intel_priority_assessments a WHERE a.project_id=p.project_id AND a.project_version=p.version ORDER BY a.created_at DESC LIMIT 1) a ON true WHERE ${clause} ORDER BY ${order} LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,limit,offset]);
  return {projects:result.map(mapIntelProject),total};
}
async function assessInTransaction(db: PgDatabase, p: Row) {
  const project=mapIntelProject(p); const ids=await projectSignals(db,project.projectId);
  const grades=ids.length?await rows(db,"SELECT signal_grade,report_name,summary FROM intel_signals WHERE signal_id=ANY($1::text[])",[ids]):[];
  const services=assessPublicServices({...project,publicSummary:[project.publicSummary,...grades.map(r=>[r.report_name,r.summary].filter(Boolean).join(" "))].filter(Boolean).join("\n")},ids);
  const confidence=grades.some((r)=>r.signal_grade==="confirmed")?"confirmed":grades.length?"candidate":"unknown";
  const asOf=new Date().toISOString().slice(0,10);const priority=scorePublicProject(project,services,confidence,asOf);
  for(const a of services)await db.run(`INSERT INTO intel_service_assessments(assessment_id,project_id,project_version,service_code,assessment,rule_version) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`,[uid("isa"),project.projectId,project.version,a.serviceCode,JSON.stringify(a),PROJECT_RULE_VERSION]);
  await db.run("INSERT INTO intel_priority_assessments(assessment_id,project_id,project_version,assessment,rule_version,as_of) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT DO NOTHING",[uid("ipa"),project.projectId,project.version,JSON.stringify(priority),PROJECT_RULE_VERSION,asOf]);
  return {services,priority};
}
export async function assessIntelProject(projectId:string, access:UserAccess) {return withDbWrite(async db=>{const p=await lockedProject(db,projectId);requirePublicEdit(access,p);return assessInTransaction(db,p);});}
export async function createIntelProject(input:IntelProjectInput,access:UserAccess) {
  requirePublicEdit(access,{owning_dept_id:access.deptId,created_by:access.userId});const v=normalizeProjectInput(input);
  return withDbWrite(db=>idempotent(db,"project:create",requiredText(input.requestKey,"요청 키",160),access,input,async()=>{await validateFacility(db,v.facilityId);await validateSignals(db,v.signalIds??[]);const id=uid("ip");
    const p=await one(db,`INSERT INTO intel_projects(project_id,title,company_name,facility_id,industry,region,stage,amount,currency,amount_scope,public_summary,expected_start_at,expected_end_at,owning_dept_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[id,v.title,v.companyName,v.facilityId,v.industry,v.region,v.stage,v.amount,v.currency,v.amountScope,v.publicSummary,v.expectedStartAt,v.expectedEndAt,access.deptId,access.userId]);
    await connectSignals(db,id,v.signalIds??[],access.userId,"사용자 확인 연결");await appendEvent(db,p!,{type:"discovered",title:v.title,after:{stage:v.stage,amount:v.amount,currency:v.currency},signalIds:v.signalIds??[],confirmed:false},access.userId);
    await assessInTransaction(db,p!);await audit(db,access.userId,"intel_project_create","intel_projects",id,null,v);return mapIntelProject(p!);}));
}
export async function updateIntelProject(projectId:string,input:IntelProjectInput&{version:number;eventType?:string;occurredAt?:string;confirmed?:boolean;revisionIds?:string[];correctsEventId?:string},access:UserAccess) {
  return withDbWrite(async db=>{const p=await lockedProject(db,projectId,input.version);requirePublicEdit(access,p);const old=mapIntelProject(p);const v=normalizeProjectInput({...old,...input});await validateFacility(db,v.facilityId);
    await connectSignals(db,projectId,v.signalIds??[],access.userId,"사용자 추가 근거");
    const next=await one(db,`UPDATE intel_projects SET title=$2,company_name=$3,facility_id=$4,industry=$5,region=$6,stage=$7,amount=$8,currency=$9,amount_scope=$10,public_summary=$11,expected_start_at=$12,expected_end_at=$13,created_by=COALESCE(created_by,$14),version=version+1,updated_at=now() WHERE project_id=$1 RETURNING *`,[projectId,v.title,v.companyName,v.facilityId,v.industry,v.region,v.stage,v.amount,v.currency,v.amountScope,v.publicSummary,v.expectedStartAt,v.expectedEndAt,access.userId]);
    const ids=await projectSignals(db,projectId);await appendEvent(db,next!,{type:optionalText(input.eventType,100)??"project_update",title:v.title,before:{stage:old.stage,amount:old.amount,currency:old.currency,expectedStartAt:old.expectedStartAt,expectedEndAt:old.expectedEndAt},after:{stage:v.stage,amount:v.amount,currency:v.currency,expectedStartAt:v.expectedStartAt,expectedEndAt:v.expectedEndAt},signalIds:ids,revisionIds:stringIds(input.revisionIds),occurredAt:isoDate(input.occurredAt),confirmed:input.confirmed===true,correctsEventId:input.correctsEventId},access.userId);
    await assessInTransaction(db,next!);await audit(db,access.userId,"intel_project_update","intel_projects",projectId,old,v);return mapIntelProject(next!);});
}

export interface BusinessLink { linkId:string; salesProjectId:string|null; contractId:string|null; title:string|null; stage:string|null; serviceCode:string|null; scopeKey:string|null }
export async function getIntelProjectDetail(projectId:string,access:UserAccess) {
  requireKey(access,"sales.view");const db=await getDb();const p=await one(db,"SELECT * FROM intel_projects WHERE project_id=$1",[projectId]);if(!p)throw intelError("프로젝트를 찾을 수 없습니다.",404);
  await assertProjectEvidenceVisible(db,projectId);
  const signals=await rows(db,"SELECT s.signal_id,s.source,s.report_name,s.company_name,s.url,s.disclosed_at,s.signal_grade,s.summary,ps.reason,ps.reviewed FROM intel_project_signals ps JOIN intel_signals s ON s.signal_id=ps.signal_id WHERE ps.project_id=$1 ORDER BY s.disclosed_at DESC NULLS LAST",[projectId]);
  const events=(await rows(db,"WITH RECURSIVE lineage(project_id) AS (SELECT project_id FROM intel_projects WHERE project_id=$1 UNION ALL SELECT p.project_id FROM intel_projects p JOIN lineage l ON p.merged_into_id=l.project_id) SELECT e.* FROM intel_project_events e JOIN lineage l ON l.project_id=e.project_id ORDER BY e.discovered_at DESC,e.event_id",[projectId])).map(mapEvent);
  const services=(await rows(db,"SELECT assessment FROM intel_service_assessments WHERE project_id=$1 AND project_version=$2 ORDER BY service_code",[projectId,p.version])).map(r=>obj(r.assessment) as unknown as ServiceAssessment);
  const priorityRow=await one(db,"SELECT assessment FROM intel_priority_assessments WHERE project_id=$1 AND project_version=$2 ORDER BY created_at DESC LIMIT 1",[projectId,p.version]);
  const allLinks=await rows(db,"SELECT l.*,s.title AS sales_title,s.stage,s.owner_employee_id,ep.name AS owner_name,ep.status AS owner_status FROM intel_business_links l LEFT JOIN sales_projects s ON s.project_id=l.sales_project_id LEFT JOIN employee_profiles ep ON ep.employee_id=s.owner_employee_id WHERE l.project_id=$1 ORDER BY l.created_at",[projectId]);
  const links:BusinessLink[]=allLinks.filter(r=>r.sales_project_id?checkPermission(access,"sales.view",{projectId:String(r.sales_project_id)}):checkPermission(access,"contract.view",{contractId:String(r.contract_id)})).map(r=>({linkId:String(r.link_id),salesProjectId:str(r.sales_project_id),contractId:str(r.contract_id),title:str(r.sales_title),stage:str(r.stage),serviceCode:str(r.service_code),scopeKey:str(r.scope_key)}));
  const actionRows=await rows(db,"SELECT a.*,s.status AS activity_status FROM intel_action_suggestions a LEFT JOIN sales_activities s ON s.activity_id=a.sales_activity_id WHERE a.project_id=$1 ORDER BY a.created_at DESC",[projectId]);
  const actions=actionRows.filter(r=>r.sales_project_id?checkPermission(access,"sales.view",{projectId:String(r.sales_project_id)}):r.created_by===access.userId||canPublicEdit(access,p)).map(mapAction);
  const manual=await one(db,"SELECT * FROM intel_manual_priorities WHERE project_id=$1 AND user_id=$2",[projectId,access.userId]);
  const owner=allLinks.find(l=>l.sales_project_id&&l.owner_employee_id&&l.owner_status==="active"&&checkPermission(access,"sales.view",{projectId:String(l.sales_project_id)})&&checkPermission(access,"sales.edit",{projectId:String(l.sales_project_id)}));
  const recommendedActions=recommendProjectActions(projectId,services,owner?{employeeId:String(owner.owner_employee_id),name:String(owner.owner_name),salesProjectId:String(owner.sales_project_id)}:null,new Date(Date.now()+9*3600000).toISOString().slice(0,10)).filter(r=>!actions.some(a=>a.title===r.title&&a.status!=="rejected"));
  return {project:mapIntelProject(p),signals,events,services,priority:priorityRow?obj(priorityRow.assessment):null,manualPriority:manual?mapManualPriority(manual):null,recommendedActions,links,actions,
    internalContext:{basis:"viewer_authorized",relationshipPoints:links.length?15:0,maximum:15,reason:links.length?"열람 권한이 있는 기존 영업·계약 연결이 있습니다.":"현재 열람 범위에서 확인된 연결이 없습니다."},canEdit:canPublicEdit(access,p)};
}
function canPublicEdit(access:UserAccess,p:Row){try{requirePublicEdit(access,p);return true;}catch{return false;}}
function mapManualPriority(r:Row):ManualPriority{return {priority:r.priority as ManualPriority["priority"],reason:String(r.reason),actorName:String(r.actor_name),updatedAt:dt(r.updated_at),ruleVersion:String(r.rule_version),projectVersion:Number(r.project_version)};}
export async function setManualPriority(projectId:string,input:{requestKey:string;version:number;priority:ManualPriority["priority"];reason:string},access:UserAccess){
  requireKey(access,"sales.view");requireKey(access,"sales.edit");if(!["high","normal","low"].includes(input.priority))throw intelError("검토 우선순위를 확인하세요.");const reason=requiredText(input.reason,"조정 사유",2000);
  return withDbWrite(db=>idempotent(db,`priority:${projectId}:${access.userId}`,input.requestKey,access,input,async()=>{
    const p=await lockedProject(db,projectId,input.version);const before=await one(db,"SELECT * FROM intel_manual_priorities WHERE project_id=$1 AND user_id=$2",[projectId,access.userId]);
    const actor=await one(db,"SELECT ep.name FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id=u.employee_id WHERE u.user_id=$1",[access.userId]);
    const saved=await one(db,"INSERT INTO intel_manual_priorities(project_id,user_id,priority,reason,actor_name,project_version,rule_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id,user_id) DO UPDATE SET priority=EXCLUDED.priority,reason=EXCLUDED.reason,actor_name=EXCLUDED.actor_name,project_version=EXCLUDED.project_version,rule_version=EXCLUDED.rule_version,updated_at=now() RETURNING *",[projectId,access.userId,input.priority,reason,str(actor?.name)??access.userId,p.version,PROJECT_RULE_VERSION]);
    await audit(db,access.userId,"intel_manual_priority","intel_manual_priorities",`${projectId}:${access.userId}`,before,saved);return {manualPriority:mapManualPriority(saved!)};
  }));
}

/** 동일 요청의 DB 변경과 결과를 한 거래에 저장한다. 실패 시 키도 롤백된다. */
async function idempotent<T>(db:PgDatabase,scope:string,key:string,access:UserAccess,input:unknown,work:()=>Promise<T>):Promise<T>{
  requiredText(key,"요청 키",160);const fingerprint=hash(input);await db.run("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${scope}:${key}`]);
  const previous=await one(db,"SELECT * FROM intel_operation_keys WHERE operation_scope=$1 AND request_key=$2",[scope,key]);
  if(previous){if(previous.actor_user_id!==access.userId||previous.request_hash!==fingerprint)throw intelError("같은 요청 키에 다른 내용 또는 사용자가 지정되었습니다.",409);const result=obj(previous.result);if(typeof result.projectId==="string")await assertProjectEvidenceVisible(db,result.projectId);if(typeof result.candidateId==="string"){const c=await one(db,"SELECT * FROM intel_facility_candidates WHERE candidate_id=$1",[result.candidateId]);if(c)await assertCandidateEvidenceVisible(db,c);}return result as T;}
  const result=await work();await db.run("INSERT INTO intel_operation_keys(operation_scope,request_key,actor_user_id,request_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",[scope,key,access.userId,fingerprint,JSON.stringify(result)]);return result;
}
async function validateEmployee(db:PgDatabase,employeeId:string,deptId?:string) {
  const e=await one(db,"SELECT employee_id,dept_id FROM employee_profiles WHERE employee_id=$1 AND status='active'",[employeeId]);if(!e)throw intelError("활성 담당자를 선택하세요.");
  if(deptId&&String(e.dept_id)!==deptId){const post=await one(db,"SELECT 1 FROM employee_dept_posts WHERE employee_id=$1 AND dept_id=$2 AND revoked_at IS NULL AND (effective_from IS NULL OR left(effective_from,10)<=CURRENT_DATE::text) AND (effective_to IS NULL OR left(effective_to,10)>=CURRENT_DATE::text)",[employeeId,deptId]);if(!post)throw intelError("담당자가 선택 부서에 속하지 않습니다.");}
}
export async function linkIntelProject(projectId:string,input:LinkProjectInput,access:UserAccess) {
  requireKey(access,"sales.edit");positiveVersion(input.version);
  if([!!input.salesProjectId,!!input.contractId,!!input.createSales].filter(Boolean).length!==1)throw intelError("기존 영업건, 계약, 신규 영업건 중 하나를 선택하세요.");
  return withDbWrite(db=>idempotent(db,`link:${projectId}`,input.requestKey,access,input,async()=>{
    const p=await lockedProject(db,projectId,input.version);requirePublicEdit(access,p);let salesProjectId=input.salesProjectId??null;const contractId=input.contractId??null;let code:string|null=null;let scope:string|null=null;
    if(input.createSales){const c=input.createSales;code=serviceCode(c.serviceCode);scope=requiredText(c.scopeKey,"업무 범위",200);if(!p.facility_id)throw intelError("사업장을 먼저 연결하세요.");await validateFacility(db,String(p.facility_id));
      requirePublicEdit(access,{owning_dept_id:c.ownerDeptId,created_by:access.userId});await validateEmployee(db,c.ownerEmployeeId,c.ownerDeptId);
      const existing=await one(db,"SELECT sales_project_id FROM intel_business_links WHERE project_id=$1 AND service_code=$2 AND scope_key=$3",[projectId,code,scope]);
      if(existing){salesProjectId=String(existing.sales_project_id);requireKey(access,"sales.edit",{projectId:salesProjectId});}
      else{salesProjectId=await createSalesProjectInTransaction(db,{facilityId:String(p.facility_id),title:optionalText(c.title,300)??String(p.title),serviceCategory:code as typeof c.serviceCode,serviceSubcategory:c.serviceSubcategory??null,ownerEmployeeId:c.ownerEmployeeId,ownerDeptId:c.ownerDeptId,priority:c.priority??"normal",stage:"lead",expectedAmount:null,memo:`투자 프로젝트 ${projectId}\n업무 범위: ${scope}`},access.userId);
        await db.run("INSERT INTO sales_project_members(project_id,employee_id,role_label,created_at) VALUES($1,$2,'정',$3) ON CONFLICT DO NOTHING",[salesProjectId,c.ownerEmployeeId,new Date().toISOString()]);}
    }else if(salesProjectId){requireKey(access,"sales.edit",{projectId:salesProjectId});const s=await one(db,"SELECT facility_id,service_category FROM sales_projects WHERE project_id=$1",[salesProjectId]);if(!s)throw intelError("영업건을 찾을 수 없습니다.",404);if(p.facility_id&&s.facility_id!==p.facility_id)throw intelError("사업장이 다른 영업건은 연결할 수 없습니다.");code=str(s.service_category);}
    else if(contractId){requireKey(access,"contract.view",{contractId});const c=await one(db,"SELECT contract_id,facility_id FROM contracts WHERE contract_id=$1 AND deleted_at IS NULL",[contractId]);if(!c)throw intelError("계약을 찾을 수 없습니다.",404);if(p.facility_id&&c.facility_id!==p.facility_id)throw intelError("사업장이 다른 계약은 연결할 수 없습니다.");}
    await db.run("INSERT INTO intel_business_links(link_id,project_id,sales_project_id,contract_id,service_code,scope_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[uid("ibl"),projectId,salesProjectId,contractId,code,scope,access.userId]);
    // legacy 단일 신호 상태를 바꾸지 않는다. 한 기사에 속한 다른 프로젝트의 미전환 후보를 보존한다.
    let activityId:string|null=null;if(input.actionId){if(!salesProjectId)throw intelError("후속 활동에는 영업건이 필요합니다.");activityId=await acceptActionInTransaction(db,input.actionId,salesProjectId,access,projectId,true);}
    await audit(db,access.userId,"intel_business_link","intel_projects",projectId,null,{salesProjectId,contractId,activityId});return {projectId,salesProjectId,contractId,activityId};
  }));
}

export async function unlinkIntelProject(projectId:string,linkId:string,input:{requestKey:string;reason:string},access:UserAccess){
  return withDbWrite(db=>idempotent(db,`unlink:${projectId}:${linkId}`,input.requestKey,access,input,async()=>{
    const p=await lockedProject(db,projectId);requirePublicEdit(access,p);const reason=requiredText(input.reason,"연결 해제 사유",2000);
    const link=await one(db,"SELECT * FROM intel_business_links WHERE link_id=$1 AND project_id=$2 FOR UPDATE",[linkId,projectId]);if(!link)throw intelError("연결을 찾을 수 없습니다.",404);
    if(link.sales_project_id)requireKey(access,"sales.edit",{projectId:String(link.sales_project_id)});else requireKey(access,"contract.view",{contractId:String(link.contract_id)});
    await db.run("DELETE FROM intel_business_links WHERE link_id=$1",[linkId]);
    // 확정 활동은 기존 영업건에 보존한다. 미채택 제안만 연결을 풀어 재검토시킨다.
    if(link.sales_project_id)await db.run("UPDATE intel_action_suggestions SET sales_project_id=NULL,status='hold',reason=$3,version=version+1,updated_at=now() WHERE project_id=$1 AND sales_project_id=$2 AND status IN ('proposed','hold')",[projectId,link.sales_project_id,`영업 연결 해제: ${reason}`]);
    await audit(db,access.userId,"intel_business_unlink","intel_business_links",linkId,link,{reason});return {linkId,unlinked:true};
  }));
}

function mapCandidate(r:Row):FacilityCandidate{return {candidateId:String(r.candidate_id),companyName:String(r.company_name),siteAddress:str(r.site_address),industry:str(r.industry),businessRegistrationNo:str(r.business_registration_no),evidence:obj(r.evidence),status:r.status as FacilityCandidate["status"],reason:str(r.reason),reviewAt:day(r.review_at),facilityId:str(r.facility_id),version:Number(r.version),createdAt:dt(r.created_at),updatedAt:dt(r.updated_at)};}
export async function listFacilityCandidates(access:UserAccess,filter:{status?:string;limit?:number;offset?:number}={}){
  requireKey(access,"sales.view");for(const number of [filter.limit,filter.offset])if(number!=null&&!Number.isSafeInteger(number))throw intelError("페이지 범위를 확인하세요.");const db=await getDb();const status=optionalText(filter.status,30);
  const where=`($1::text IS NULL OR c.status=$1) AND (c.created_by IS NOT NULL OR c.candidate_key NOT LIKE 'signal:%' OR EXISTS(SELECT 1 FROM intel_signals s WHERE 'signal:'||s.signal_id=c.candidate_key AND s.signal_grade<>'excluded' AND s.status<>'dismissed' AND s.duplicate_of IS NULL)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.evidence->'signalIds','[]'::jsonb)) evidence_id WHERE NOT EXISTS(SELECT 1 FROM intel_signals rights_signal WHERE rights_signal.signal_id=evidence_id AND (${officialSignalVisibleCondition("rights_signal")} AND ${newsContentQualityCondition("rights_signal")}))) AND NOT EXISTS(SELECT 1 FROM intel_projects p JOIN intel_project_signals ps ON ps.project_id=p.project_id JOIN intel_signals rights_signal ON rights_signal.signal_id=ps.signal_id WHERE p.candidate_id=c.candidate_id AND NOT (${officialSignalVisibleCondition("rights_signal")} AND ${newsContentQualityCondition("rights_signal")}))`;
  const result=await rows(db,`SELECT c.* FROM intel_facility_candidates c WHERE ${where} ORDER BY c.updated_at DESC,c.candidate_id LIMIT $2 OFFSET $3`,[status,Math.min(200,Math.max(1,filter.limit??50)),Math.max(0,filter.offset??0)]);return {candidates:result.map(mapCandidate),total:Number((await one(db,`SELECT count(*) AS n FROM intel_facility_candidates c WHERE ${where}`,[status]))?.n??0)};
}
export async function createFacilityCandidate(input:{companyName:string;siteAddress?:string;industry?:string;businessRegistrationNo?:string;evidenceSignalIds?:string[]},access:UserAccess){requirePublicEdit(access,{owning_dept_id:access.deptId,created_by:access.userId});return withDbWrite(async db=>{const name=requiredText(input.companyName,"회사명");const address=optionalText(input.siteAddress,500);const ids=stringIds(input.evidenceSignalIds);await validateSignals(db,ids);const key=hash([name,address,ids.slice().sort()]);const r=await one(db,"INSERT INTO intel_facility_candidates(candidate_id,company_name,site_address,industry,business_registration_no,evidence,candidate_key,owning_dept_id,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) ON CONFLICT(candidate_key) DO UPDATE SET candidate_key=EXCLUDED.candidate_key RETURNING *",[uid("ifc"),name,address,optionalText(input.industry,100),optionalText(input.businessRegistrationNo,30),JSON.stringify({signalIds:ids}),key,access.deptId,access.userId]);return mapCandidate(r!);});}
export async function resolveFacilityCandidate(candidateId:string,input:{action:"link"|"register"|"hold"|"reject"|"review";version:number;requestKey:string;facilityId?:string;companyName?:string;siteAddress?:string;businessRegistrationNo?:string;reason?:string;reviewAt?:string;allowDuplicateBusinessRegistrationNo?:boolean},access:UserAccess){
  requireKey(access,"sales.edit");return withDbWrite(db=>idempotent(db,`candidate:${candidateId}`,input.requestKey,access,input,async()=>{
    const c=await one(db,"SELECT * FROM intel_facility_candidates WHERE candidate_id=$1 FOR UPDATE",[candidateId]);if(!c)throw intelError("후보를 찾을 수 없습니다.",404);requirePublicEdit(access,c);if(Number(c.version)!==positiveVersion(input.version))throw intelError("후보가 변경되었습니다. 다시 확인하세요.",409);
    await assertCandidateEvidenceVisible(db,c);
    if(["linked_existing","registered"].includes(String(c.status)))throw intelError("이미 확정된 후보입니다.",409);
    let facilityId:string|null=null;let status:string;let reason=optionalText(input.reason,2000);let reviewAt=isoDate(input.reviewAt);
    if(input.action==="link"||input.action==="register"){requireKey(access,"facility.edit");
      if(input.action==="link"){facilityId=requiredText(input.facilityId,"사업장");await validateFacility(db,facilityId);status="linked_existing";}
      else{const name=normalizeCompanyName(requiredText(input.companyName??c.company_name,"회사명"))!;if(name==="기업명 확인 필요")throw intelError("확인한 실제 회사명을 입력하세요.");const address=normalizeAddress(requiredText(input.siteAddress??c.site_address,"확인한 사업장 주소",500));if(!address)throw intelError("확인한 주소를 입력하세요.");const brn=normalizeBusinessRegistrationNo(optionalText(input.businessRegistrationNo??c.business_registration_no,30));
        if(brn&&!/^\d{3}-?\d{2}-?\d{5}$/.test(brn))throw intelError("사업자번호 형식을 확인하세요.");const companyKey=name.replace(/\s+/g,"").replace(/[()（）]/g,"").toLowerCase();const addressKey=address.replace(/\s+/g," ").trim();
        await db.run("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`facility:${companyKey}:${addressKey}`]);if(brn)await db.run("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`facility-brn:${brn}`]);
        const dup=await one(db,"SELECT facility_id FROM facilities WHERE deleted_at IS NULL AND ((normalized_company_name=$1 AND normalized_address=$2) OR ($3::text IS NOT NULL AND business_registration_no=$3 AND NOT $4::boolean)) LIMIT 1",[companyKey,addressKey,brn,input.allowDuplicateBusinessRegistrationNo===true]);if(dup)throw intelError(`기존 사업장 ${dup.facility_id}과 중복될 수 있습니다. 기존 연결 또는 별도 공장 여부를 확인하세요.`,409);
        await markReviewedWrite(db);facilityId=uid("facm");const region=extractRegion(address);const now=new Date().toISOString();
        await db.run("INSERT INTO facilities(facility_id,company_name,business_registration_no,site_address,normalized_company_name,normalized_address,region_sido,region_sigungu,source,memo,created_at,updated_at,site_address_verbatim) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$10,true)",[facilityId,name,brn,address,companyKey,addressKey,region.sido,region.sigungu,`인텔 후보 검토 등록: ${candidateId}`,now]);status="registered";
      }
      const facility=await one(db,"SELECT region_sido,region_sigungu FROM facilities WHERE facility_id=$1",[facilityId]);
      const updatedProjects=await rows(db,"UPDATE intel_projects SET facility_id=$2,region=COALESCE($3,region),version=version+1,updated_at=now() WHERE candidate_id=$1 AND state='active' RETURNING *",[candidateId,facilityId,[facility?.region_sido,facility?.region_sigungu].filter(Boolean).join(" ")||null]);
      for(const updatedProject of updatedProjects)await assessInTransaction(db,updatedProject);
      // N:M 신호는 전역 시설을 추측해 덮어쓰지 않는다. 단일 연결인 경우만 호환 필드를 보강한다.
      await db.run(`UPDATE intel_signals s SET facility_id=$2,match_status='matched',updated_at=$3 WHERE s.facility_id IS NULL AND EXISTS(SELECT 1 FROM intel_project_signals ps JOIN intel_projects p ON p.project_id=ps.project_id WHERE ps.signal_id=s.signal_id AND p.candidate_id=$1) AND (SELECT count(*) FROM intel_project_signals x WHERE x.signal_id=s.signal_id)=1`,[candidateId,facilityId,new Date().toISOString()]);
    }else if(input.action==="hold"){status="hold";reason=requiredText(input.reason,"보류 사유",2000);if(!reviewAt)throw intelError("재검토일을 지정하세요.");}
    else if(input.action==="reject"){status="rejected";reason=requiredText(input.reason,"제외 사유",2000);}else if(input.action==="review")status="in_review";else throw intelError("지원하지 않는 검토 동작입니다.");
    const next=await one(db,"UPDATE intel_facility_candidates SET status=$2,reason=$3,review_at=$4,facility_id=$5,version=version+1,updated_at=now() WHERE candidate_id=$1 RETURNING *",[candidateId,status,reason,reviewAt,facilityId]);await audit(db,access.userId,"intel_candidate_resolve","intel_facility_candidates",candidateId,c,next);return mapCandidate(next!);
  }));
}

function actionEndDate(type:string,start:string,value:unknown):string{
  if(!value&&["visit","site_briefing","proposal_meeting","bid"].includes(type))throw intelError("이 활동은 시작·종료 일시를 모두 확정해야 합니다.");
  const end=value?activityDate(value):start;if(end<start)throw intelError("종료 일시는 시작 일시보다 빠를 수 없습니다.");return end;
}
function mapAction(r:Row):ActionSuggestion{return {actionId:String(r.action_id),projectId:String(r.project_id),title:String(r.title),activityType:r.activity_type as SalesActivityType,assigneeEmployeeId:str(r.assignee_employee_id),scheduledAt:str(r.scheduled_at),endedAt:str(r.ended_at),status:r.status as ActionSuggestion["status"],reason:str(r.reason),evidenceSignalIds:(r.evidence_signal_ids??[]) as string[],salesProjectId:str(r.sales_project_id),salesActivityId:str(r.sales_activity_id),activityStatus:str(r.activity_status),version:Number(r.version),createdAt:dt(r.created_at),updatedAt:dt(r.updated_at)};}
export async function createActionSuggestion(input:{requestKey?:string;projectId:string;title:string;activityType:SalesActivityType;assigneeEmployeeId?:string;scheduledAt?:string;endedAt?:string;evidenceSignalIds?:string[];salesProjectId?:string},access:UserAccess){return withDbWrite(db=>idempotent(db,"action:create",requiredText(input.requestKey,"요청 키",160),access,input,async()=>{
  const p=await lockedProject(db,input.projectId);requirePublicEdit(access,p);const title=requiredText(input.title,"후속 행동");if(!ACTIVITY_TYPES.some(a=>a.code===input.activityType)||input.activityType==="result")throw intelError("예정 영업활동 종류를 선택하세요.");
  if(input.salesProjectId){requireKey(access,"sales.edit",{projectId:input.salesProjectId});if(!await one(db,"SELECT 1 FROM intel_business_links WHERE project_id=$1 AND sales_project_id=$2",[input.projectId,input.salesProjectId]))throw intelError("먼저 영업건을 연결하세요.");}
  if(input.assigneeEmployeeId)await validateEmployee(db,input.assigneeEmployeeId);const start=input.scheduledAt?activityDate(input.scheduledAt):null;const end=input.endedAt?activityDate(input.endedAt):null;if(start&&end&&end<start)throw intelError("종료 일시를 확인하세요.");
  const ids=stringIds(input.evidenceSignalIds);const linked=await projectSignals(db,input.projectId);if(ids.some(id=>!linked.includes(id)))throw intelError("프로젝트에 연결된 근거를 선택하세요.");
  const a=await one(db,"INSERT INTO intel_action_suggestions(action_id,project_id,title,activity_type,assignee_employee_id,scheduled_at,ended_at,evidence_signal_ids,sales_project_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10) RETURNING *",[uid("ias"),input.projectId,title,input.activityType,input.assigneeEmployeeId??null,start,end,ids,input.salesProjectId??null,access.userId]);await audit(db,access.userId,"intel_action_propose","intel_action_suggestions",String(a!.action_id),null,a);return mapAction(a!);
}));}
async function acceptActionInTransaction(db:PgDatabase,actionId:string,salesProjectId:string,access:UserAccess,projectId:string,newlyAuthorized=false):Promise<string>{
  const a=await one(db,"SELECT * FROM intel_action_suggestions WHERE action_id=$1 FOR UPDATE",[actionId]);if(!a||a.project_id!==projectId)throw intelError("후속 조치를 찾을 수 없습니다.",404);
  if(!newlyAuthorized)requireKey(access,"sales.edit",{projectId:salesProjectId});if(a.sales_activity_id){if(a.sales_project_id!==salesProjectId)throw intelError("다른 영업건으로 이미 채택되었습니다.",409);return String(a.sales_activity_id);}
  if(a.status==="rejected")throw intelError("제외한 제안은 채택할 수 없습니다.");if(!a.assignee_employee_id)throw intelError("담당자를 지정하세요.");await validateEmployee(db,String(a.assignee_employee_id));
  const start=activityDate(a.scheduled_at);const end=actionEndDate(String(a.activity_type),start,a.ended_at);
  const activityId=await createActivityInTransaction(db,salesProjectId,{activityType:a.activity_type as SalesActivityType,status:"planned",scheduledAt:start,endedAt:end,occurredAt:null,summary:`${a.title}\n투자 프로젝트: ${projectId}`,authorEmployeeId:access.employeeId,assignees:[{employeeId:String(a.assignee_employee_id),roleKind:"attendee"}]},access.userId);
  await db.run("UPDATE intel_action_suggestions SET status='accepted',sales_project_id=$2,sales_activity_id=$3,version=version+1,updated_at=now() WHERE action_id=$1",[actionId,salesProjectId,activityId]);return activityId;
}
export async function resolveActionSuggestion(actionId:string,input:{action:"accept"|"hold"|"reject";requestKey:string;version:number;salesProjectId?:string;assigneeEmployeeId?:string;scheduledAt?:string;endedAt?:string;reason?:string},access:UserAccess){requireKey(access,"sales.edit");return withDbWrite(db=>idempotent(db,`action:${actionId}`,input.requestKey,access,input,async()=>{
  const head=await one(db,"SELECT project_id FROM intel_action_suggestions WHERE action_id=$1",[actionId]);if(!head)throw intelError("제안을 찾을 수 없습니다.",404);const p=await lockedProject(db,String(head.project_id));requirePublicEdit(access,p);
  const a=(await one(db,"SELECT * FROM intel_action_suggestions WHERE action_id=$1 FOR UPDATE",[actionId]))!;
  if(Number(a.version)!==positiveVersion(input.version))throw intelError("제안이 변경되었습니다. 다시 확인하세요.",409);if(a.status==="accepted")throw intelError("채택한 활동은 영업활동 화면에서 변경하세요.",409);
  let activityId:string|null=null;if(input.action==="accept"){const salesId=requiredText(input.salesProjectId??a.sales_project_id,"영업건");requireKey(access,"sales.edit",{projectId:salesId});if(!await one(db,"SELECT 1 FROM intel_business_links WHERE project_id=$1 AND sales_project_id=$2",[a.project_id,salesId]))throw intelError("해당 프로젝트에 연결된 영업건이 아닙니다.");
    const employeeId=requiredText(input.assigneeEmployeeId??a.assignee_employee_id,"담당자");await validateEmployee(db,employeeId);const start=activityDate(input.scheduledAt??a.scheduled_at);const end=actionEndDate(String(a.activity_type),start,input.endedAt??a.ended_at);await db.run("UPDATE intel_action_suggestions SET assignee_employee_id=$2,scheduled_at=$3,ended_at=$4 WHERE action_id=$1",[actionId,employeeId,start,end]);activityId=await acceptActionInTransaction(db,actionId,salesId,access,String(a.project_id));
  }else if(input.action==="hold"||input.action==="reject"){await db.run("UPDATE intel_action_suggestions SET status=$2,reason=$3,version=version+1,updated_at=now() WHERE action_id=$1",[actionId,input.action==="hold"?"hold":"rejected",requiredText(input.reason,"사유",2000)]);}else throw intelError("지원하지 않는 제안 처리입니다.");
  await audit(db,access.userId,"intel_action_resolve","intel_action_suggestions",actionId,a,{action:input.action,activityId});return {actionId,activityId};
}));}

export async function mergeIntelProjects(targetId:string,input:{sourceId:string;version:number;sourceVersion:number;requestKey:string;reason:string},access:UserAccess){
  if(targetId===input.sourceId)throw intelError("서로 다른 프로젝트를 선택하세요.");const reason=requiredText(input.reason,"병합 근거",2000);
  return withDbWrite(db=>idempotent(db,`merge:${targetId}`,input.requestKey,access,input,async()=>{
    const locked=new Map<string,Row>();for(const id of [targetId,input.sourceId].sort())locked.set(id,await lockedProject(db,id,id===targetId?input.version:input.sourceVersion));
    const target=locked.get(targetId)!;const source=locked.get(input.sourceId)!;requirePublicEdit(access,target);requirePublicEdit(access,source);
    if(target.facility_id&&source.facility_id&&target.facility_id!==source.facility_id)throw intelError("서로 다른 사업장입니다. 사업장 연결을 검토한 뒤 병합하세요.",409);
    const sourceLinks=await rows(db,"SELECT * FROM intel_business_links WHERE project_id=$1",[input.sourceId]);
    for(const link of sourceLinks){if(link.sales_project_id)requireKey(access,"sales.edit",{projectId:String(link.sales_project_id)});else requireKey(access,"contract.view",{contractId:String(link.contract_id)});}
    await db.run("INSERT INTO intel_project_signals(project_id,signal_id,reason,reviewed,created_by) SELECT $1,signal_id,$3,true,$4 FROM intel_project_signals WHERE project_id=$2 ON CONFLICT DO NOTHING",[targetId,input.sourceId,reason,access.userId]);
    for(const l of sourceLinks)await db.run("INSERT INTO intel_business_links(link_id,project_id,sales_project_id,contract_id,service_code,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[uid("ibl"),targetId,l.sales_project_id,l.contract_id,l.service_code,access.userId]);
    // 이전 제안은 새 문맥에서 재검토한다. 완료된 활동·원래 링크·사건 이력은 삭제하지 않는다.
    await db.run("UPDATE intel_action_suggestions SET status='hold',reason=$2,version=version+1,updated_at=now() WHERE project_id=ANY($1::text[]) AND status='proposed'",[[targetId,input.sourceId],`프로젝트 병합 후 재검토: ${reason}`]);
    await db.run("UPDATE intel_projects SET state='merged',merged_into_id=$2,version=version+1,updated_at=now() WHERE project_id=$1",[input.sourceId,targetId]);
    const next=await one(db,"UPDATE intel_projects SET facility_id=COALESCE(facility_id,$2),version=version+1,updated_at=now() WHERE project_id=$1 RETURNING *",[targetId,source.facility_id]);
    await appendEvent(db,next!,{type:"merged",title:`프로젝트 통합: ${reason}`,before:{sourceId:input.sourceId},after:{targetId},signalIds:await projectSignals(db,targetId),mode:"replay",confirmed:false},access.userId);
    await assessInTransaction(db,next!);await audit(db,access.userId,"intel_project_merge","intel_projects",targetId,{source,target},{reason,targetId});return {projectId:targetId,mergedProjectId:input.sourceId};
  }));
}
export async function splitIntelProject(sourceId:string,input:{version:number;requestKey:string;title:string;signalIds:string[];reason:string},access:UserAccess){const ids=stringIds(input.signalIds);if(!ids.length)throw intelError("분리할 근거를 선택하세요.");const title=requiredText(input.title,"새 프로젝트명");const reason=requiredText(input.reason,"분리 근거",2000);
  return withDbWrite(db=>idempotent(db,`split:${sourceId}`,input.requestKey,access,input,async()=>{const p=await lockedProject(db,sourceId,input.version);requirePublicEdit(access,p);const existing=await projectSignals(db,sourceId);if(ids.some(id=>!existing.includes(id))||ids.length===existing.length)throw intelError("원래 프로젝트에 근거를 남기고 일부 근거만 분리하세요.");
    const id=uid("ip");const next=await one(db,"INSERT INTO intel_projects(project_id,title,company_name,industry,region,owning_dept_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[id,title,p.company_name,p.industry,p.region,access.deptId,access.userId]);
    await connectSignals(db,id,ids,access.userId,reason);await db.run("DELETE FROM intel_project_signals WHERE project_id=$1 AND signal_id=ANY($2::text[])",[sourceId,ids]);
    const oldNext=await one(db,"UPDATE intel_projects SET version=version+1,updated_at=now() WHERE project_id=$1 RETURNING *",[sourceId]);
    await db.run("UPDATE intel_action_suggestions SET status='hold',reason=$2,version=version+1,updated_at=now() WHERE project_id=$1 AND status='proposed'",[sourceId,`프로젝트 분리 후 재검토: ${reason}`]);
    await appendEvent(db,next!,{type:"split",title,after:{sourceId,reason},signalIds:ids,mode:"replay"},access.userId);await assessInTransaction(db,next!);await assessInTransaction(db,oldNext!);
    await audit(db,access.userId,"intel_project_split","intel_projects",sourceId,p,{projectId:id,signalIds:ids,reason});return {projectId:id,sourceProjectId:sourceId};
  }));
}

/** 기존 수집 신호를 공용 검토 프로젝트로 보강한다. 이름만으로 서로 다른 공장을 합치지 않는다. */
export async function ingestSignalProjects(input:{signalIds?:string[];revisionIds?:string[];mode:IntelIngestionMode;limit?:number}):Promise<{created:number;updated:number;skipped:number;projectIds:string[]}>{
  if(!["live","initial_backfill","replay"].includes(input.mode))throw intelError("적재 모드를 지정하세요.");const db=await getDb();const ids=stringIds(input.signalIds,1000);const params:unknown[]=[];
  let condition=`s.duplicate_of IS NULL AND s.signal_grade <> 'excluded' AND s.status<>'dismissed' AND ${newsContentQualityCondition()}`;if(ids.length){params.push(ids);condition+=" AND s.signal_id=ANY($1::text[])";}else condition+=" AND (p.project_id IS NULL OR s.updated_at::timestamptz>p.source_checked_at)";
  params.push(Math.min(1000,Math.max(1,input.limit??200)));const signals=await rows(db,`SELECT s.* FROM intel_signals s LEFT JOIN intel_projects p ON p.ingestion_key='signal:'||s.signal_id WHERE ${condition} ORDER BY s.created_at DESC LIMIT $${params.length}`,params);
  const result={created:0,updated:0,skipped:0,projectIds:[] as string[]};
  for(const signal of signals){const outcome=await withDbWrite(async tx=>{
    const key=`signal:${signal.signal_id}`;await tx.run("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);let p=await one(tx,"SELECT * FROM intel_projects WHERE ingestion_key=$1 FOR UPDATE",[key]);
    if(p?.state==="merged"||p?.state==="archived"){await tx.run("UPDATE intel_projects SET source_checked_at=now() WHERE project_id=$1",[p.project_id]);return {status:"skipped" as const,id:String(p.project_id)};}
    const revisionIds=input.revisionIds?.length?(await rows(tx,"SELECT r.revision_id FROM intel_source_document_revisions r JOIN intel_source_documents d ON d.document_id=r.document_id WHERE d.signal_id=$1 AND r.revision_id=ANY($2::text[]) ORDER BY r.revision_id",[signal.signal_id,input.revisionIds])).map(r=>String(r.revision_id)):[];
    // 연결 시설은 기업 매칭 결과일 수 있으므로 본사·다른 공장의 주소를 투자 지역으로 대신 쓰지 않는다.
    const sourceRegion=str(signal.region)?.trim()||null;
    const regionChanged=!!p&&!p.created_by&&str(p.region)!==sourceRegion;
    const fingerprint=hash([signal.report_name,signal.summary,signal.company_name,signal.industry,signal.amount,signal.signal_grade,signal.disclosed_at,revisionIds]);
    const eventKey=`signal:${signal.signal_id}:${fingerprint}${regionChanged?`:region:${hash([p!.region,sourceRegion,p!.version])}`:""}`;
    if(p&&await one(tx,"SELECT event_id FROM intel_project_events WHERE project_id=$1 AND event_key=$2",[p.project_id,eventKey])){await tx.run("UPDATE intel_projects SET source_checked_at=now() WHERE project_id=$1",[p.project_id]);return {status:"skipped" as const,id:String(p.project_id)};}
    let candidateId:string|null=null;const isNew=!p;const previous=p?mapIntelProject(p):null;
    if(!p){if(!signal.facility_id){candidateId=uid("ifc");await tx.run("INSERT INTO intel_facility_candidates(candidate_id,company_name,industry,evidence,candidate_key) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(candidate_key) DO NOTHING",[candidateId,String(signal.company_name??"기업명 확인 필요"),signal.industry,JSON.stringify({signalIds:[String(signal.signal_id)],fields:{companyName:{value:signal.company_name,confirmed:false,signalId:signal.signal_id}}}),key]);candidateId=String((await one(tx,"SELECT candidate_id FROM intel_facility_candidates WHERE candidate_key=$1",[key]))?.candidate_id);}
      p=await one(tx,`INSERT INTO intel_projects(project_id,title,company_name,facility_id,candidate_id,industry,region,stage,amount,public_summary,ingestion_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,'unknown',$8,$9,$10) RETURNING *`,[uid("ip"),String(signal.report_name??signal.company_name??"신규 투자정보 검토"),signal.company_name,signal.facility_id,candidateId,signal.industry,sourceRegion,signal.amount,signal.summary,key]);
      await connectSignals(tx,String(p!.project_id),[String(signal.signal_id)],null,"수집 신호의 독립 검토 후보; 동일 사업 여부 미확정",false);
    }else if(!p.created_by){p=await one(tx,"UPDATE intel_projects SET title=$2,public_summary=$3,amount=$4,region=$5,company_name=$6,industry=$7,version=version+1,updated_at=now() WHERE project_id=$1 RETURNING *",[p.project_id,String(signal.report_name??signal.company_name??p.title),signal.summary,signal.amount,sourceRegion,signal.company_name,signal.industry]);}
    else{p=await one(tx,"UPDATE intel_projects SET version=version+1,updated_at=now() WHERE project_id=$1 RETURNING *",[p.project_id]);}
    const current=mapIntelProject(p!);
    await appendEvent(tx,p!,{type:isNew?"discovered":"source_update",title:String(signal.report_name??p!.title),before:previous?{amount:previous.amount,stage:previous.stage,currency:previous.currency,region:previous.region}:{},after:{signalType:signal.signal_type,summary:signal.summary,amount:current.amount,stage:current.stage,currency:current.currency,region:current.region,sourceRegion,sourceAmount:signal.amount==null?null:Number(signal.amount)},signalIds:[String(signal.signal_id)],revisionIds,mode:input.mode,occurredAt:signal.disclosed_at?day(signal.disclosed_at):null,confirmed:signal.signal_grade==="confirmed",key:eventKey},null);
    if(signal.linked_project_id)await tx.run("INSERT INTO intel_business_links(link_id,project_id,sales_project_id) SELECT $1,$2,project_id FROM sales_projects WHERE project_id=$3 ON CONFLICT DO NOTHING",[uid("ibl"),p!.project_id,signal.linked_project_id]);
    await tx.run("UPDATE intel_projects SET source_checked_at=now() WHERE project_id=$1",[p!.project_id]);await assessInTransaction(tx,p!);return {status:isNew?"created" as const:"updated" as const,id:String(p!.project_id)};
  });result[outcome.status]++;result.projectIds.push(outcome.id);}
  return result;
}

export async function loadProjectIntelligenceActor(userId:string){return loadUserAccess(userId);}
