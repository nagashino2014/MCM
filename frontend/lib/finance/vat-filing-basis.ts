import { createHash, randomUUID } from "node:crypto";
import { rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { lockAccountingWrite } from "./write-lock";
import { resolveVatFilingScope, validateFact, validateSubject, type SubjectRevision, type FactRevision, type VatFilingScopeResult } from "./vat-filing-scope";

/** B1 봉인본은 신고 근거다. 세액 계산·국세청 접수·실제 신고서 확정을 뜻하지 않는다. */
export const VAT_FILING_BASIS_SCHEMA = "vat-filing-basis-v1" as const;
const fail = (message: string, status = 409, code = "vat_filing_basis_conflict") => Object.assign(new Error(message), {status, code});
const validId = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])) : value;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const json = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
function schemaError(error: unknown): never {
  const e = error as {code?: string; message?: string};
  if (["42P01","42703","42883"].includes(String(e?.code))) throw fail(`부가세 신고 근거 자료구조를 확인할 수 없습니다. 229 적용 상태를 확인하세요: ${e.message?.match(/(?:relation|column|function) "([a-zA-Z_][a-zA-Z0-9_.]*)"/)?.[1] ?? "필수 테이블·열·함수"}`,503,"vat_filing_basis_unavailable");
  if (["23505","23514","23503"].includes(String(e?.code))) throw fail("신고 근거의 중복·판번호·소비 제약이 맞지 않습니다. 최신 근거와 이미 사용한 내역을 확인하세요.");
  throw error;
}
function requestValid(requestId: unknown, actor: unknown, expectedVersion?: unknown) {
  if (!validId(requestId) || !validId(actor) || (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion)<0))) throw fail("요청 식별자·담당자·기대 판번호가 올바르지 않습니다.",400,"vat_filing_basis_input");
}
export async function withVatFilingBasisTransaction<T>(fn: (db: PgDatabase)=>Promise<T>): Promise<T> {
  for (let attempt=0;;attempt++) {
    try { return await withDbWrite(async db=>{await lockAccountingWrite(db);return fn(db);},{accountingSnapshot:true}); }
    catch(error) {if(attempt<2 && ["40001","40P01"].includes(String((error as any)?.code)))continue;return schemaError(error);}
  }
}
async function replay(db: PgDatabase, id: string, action: string, payloadHash: string, actor: string) {
  const row = rowsToObjects(await db.exec("SELECT action,payload_hash,result_json,actor_user_id FROM vat_filing_requests WHERE request_id=$1",[id]))[0];
  if(!row)return null;
  if(row.action!==action || row.payload_hash!==payloadHash || row.actor_user_id!==actor)throw fail("같은 요청 식별자에 다른 내용 또는 담당자가 있습니다.");
  return {...json(row.result_json),replayed:true};
}
async function remember(db: PgDatabase, id: string, action: "subject_revision"|"fact_revision"|"seal_basis", payloadHash: string, result: object, actor: string, target: string) {
  await db.run("INSERT INTO vat_filing_requests(request_id,action,payload_hash,result_json,actor_user_id)VALUES($1,$2,$3,$4::jsonb,$5)",[id,action,payloadHash,JSON.stringify(result),actor]);
  await recordAuditLogInline(db,{actorUserId:actor,action:"finance_vat_filing_basis",targetTable:action==='subject_revision'?'vat_filing_subject_revisions':action==='fact_revision'?'vat_filing_fact_revisions':'vat_filing_basis_snapshots',targetId:target,after:{action,requestId:id,...result}});
}
export async function currentVatFilingSubject(db: PgDatabase, subjectId: string, period?:{from:string;to:string}): Promise<SubjectRevision> {
  const rows=rowsToObjects(await db.exec("SELECT revision_id,subject_id,version,payload_json FROM vat_filing_subject_revisions WHERE subject_id=$1 ORDER BY version DESC",[subjectId]));
  if(!rows.length)throw fail("신고 주체 기준이 등록되지 않았습니다. 미확인 상태를 포함한 주체 기준을 먼저 등록하세요.",404,"vat_filing_subject_missing");
  const subjects=rows.map(row=>{
    let parsed:SubjectRevision;
    try {parsed=validateSubject(json(row.payload_json));}catch {throw fail("저장된 신고 주체 근거 형식을 검증할 수 없습니다.",503,"vat_filing_basis_unavailable");}
    if(parsed.revisionId!==row.revision_id||parsed.subjectId!==row.subject_id||parsed.version!==Number(row.version))throw fail("저장된 신고 주체 판번호의 일관성을 확인할 수 없습니다.",503,"vat_filing_basis_unavailable");
    return parsed;
  });
  // 대상기간과 겹치는 가장 최근 판을 선택한다. 중간 제도변경은 옛 판으로 덮지 않고 resolver가 보류한다.
  return (period?subjects.find(s=>s.effectiveFrom<=period.to&&(s.effectiveTo===null||s.effectiveTo>=period.from)):subjects[0])??subjects[0];
}
export async function vatFilingSubjectFacts(db: PgDatabase, subjectId: string): Promise<FactRevision[]> {
  const rows=rowsToObjects(await db.exec("SELECT revision_id,fact_id,subject_id,version,kind,state,period_year,period_term,date_from,date_to,amount,payload_json FROM vat_filing_fact_revisions WHERE subject_id=$1 ORDER BY fact_id,version",[subjectId]));
  return rows.map(row=>{
    let fact:FactRevision;
    try {fact=validateFact(json(row.payload_json));}catch {throw fail("저장된 외부 신고 근거 형식을 검증할 수 없습니다.",503,"vat_filing_basis_unavailable");}
    if(fact.revisionId!==row.revision_id||fact.factId!==row.fact_id||fact.subjectId!==row.subject_id||fact.version!==Number(row.version)||fact.kind!==row.kind||fact.state!==row.state||fact.year!==Number(row.period_year)||fact.term!==Number(row.period_term)||fact.from!==row.date_from||fact.to!==row.date_to||fact.amount!==(row.amount==null?null:Number(row.amount)))throw fail("저장된 외부 신고 근거의 일관성을 확인할 수 없습니다.",503,"vat_filing_basis_unavailable");
    return fact;
  });
}

/** 같은 회계 잠금 안에서 현재 선택 결과를 전후 대조한다. 기존 stale 근거를 덮거나 수리하지 않는다. */
async function sealedScopesBeforeWrite(db: PgDatabase, subjectId: string) {
  const snapshots=rowsToObjects(await db.exec("SELECT snapshot_id,subject_id,period_year,period_term,period_kind,schema_version,scope_json FROM vat_filing_basis_snapshots WHERE subject_id=$1 ORDER BY snapshot_id",[subjectId]));
  const result:Array<{snapshotId:string;query:VatFilingScopeQuery;scopeHash:string}>=[];
  for(const row of snapshots){
    const stored=json(row.scope_json);
    if((row.period_kind!=="preliminary"&&row.period_kind!=="final")||row.schema_version!==VAT_FILING_BASIS_SCHEMA||!stored?.evidenceSnapshot||stored.subjectId!==row.subject_id||stored.year!==Number(row.period_year)||stored.term!==Number(row.period_term)||stored.kind!==row.period_kind)throw fail("봉인 근거의 기간·형식을 검증할 수 없습니다.",503,"vat_filing_basis_unavailable");
    const query:VatFilingScopeQuery={subjectId,year:Number(row.period_year),term:Number(row.period_term) as 1|2,kind:row.period_kind,collectionCorpNum:stored.evidenceSnapshot.collectionCorpNum};
    result.push({snapshotId:String(row.snapshot_id),query,scopeHash:(await getVatFilingScope(query,db)).scopeHash});
  }
  return result;
}
async function assertSealedScopesUnchanged(db:PgDatabase,before:Awaited<ReturnType<typeof sealedScopesBeforeWrite>>) {
  const affected:string[]=[];
  for(const item of before)if((await getVatFilingScope(item.query,db)).scopeHash!==item.scopeHash)affected.push(item.snapshotId);
  if(affected.length)throw Object.assign(fail("봉인한 기간의 신고 근거가 달라지는 변경입니다. 과거 보관본을 유지하고 후행 정정 절차를 확인하세요.",409,"vat_filing_sealed_scope_changed"),{snapshotIds:affected});
}
export type VatFilingWriteValidation = (db:PgDatabase)=>Promise<void>;

export interface SaveSubjectRevisionInput { requestId: string; expectedVersion: number; subject: SubjectRevision }
export async function saveVatFilingSubjectRevision(input: SaveSubjectRevisionInput, actor: string, validate?: VatFilingWriteValidation) {
  requestValid(input?.requestId,actor,input?.expectedVersion);
  const subject=validateSubject(input.subject),payloadHash=hash({expectedVersion:input.expectedVersion,subject});
  if(subject.version!==input.expectedVersion+1)throw fail("새 주체 판번호는 기대 판번호의 다음 값이어야 합니다.",400);
  return withVatFilingBasisTransaction(async db=>{
    const previousRequest=await replay(db,input.requestId,"subject_revision",payloadHash,actor);if(previousRequest)return previousRequest;
    const old=rowsToObjects(await db.exec("SELECT revision_id,version FROM vat_filing_subject_revisions WHERE subject_id=$1 ORDER BY version DESC LIMIT 1",[subject.subjectId]))[0];
    if(Number(old?.version??0)!==input.expectedVersion)throw fail("신고 주체 기준이 변경되었습니다. 최신 판번호로 다시 검토하세요.");
    await validate?.(db);
    const protectedScopes=await sealedScopesBeforeWrite(db,subject.subjectId);
    await db.run("INSERT INTO vat_filing_subjects(subject_id)VALUES($1) ON CONFLICT DO NOTHING",[subject.subjectId]);
    await db.run("INSERT INTO vat_filing_subject_revisions(revision_id,subject_id,version,previous_revision_id,payload_json,actor_user_id)VALUES($1,$2,$3,$4,$5::jsonb,$6)",[subject.revisionId,subject.subjectId,subject.version,old?.revision_id??null,JSON.stringify(subject),actor]);
    await assertSealedScopesUnchanged(db,protectedScopes);
    const result={revisionId:subject.revisionId,subjectId:subject.subjectId,version:subject.version,replayed:false};
    await remember(db,input.requestId,"subject_revision",payloadHash,result,actor,subject.revisionId);return result;
  });
}

export interface SaveFactRevisionInput { requestId: string; expectedVersion: number; fact: FactRevision }
export async function saveVatFilingFactRevision(input: SaveFactRevisionInput, actor: string, validate?: VatFilingWriteValidation) {
  requestValid(input?.requestId,actor,input?.expectedVersion);
  const fact=validateFact(input.fact),payloadHash=hash({expectedVersion:input.expectedVersion,fact});
  if(fact.version!==input.expectedVersion+1)throw fail("새 외부 근거 판번호는 기대 판번호의 다음 값이어야 합니다.",400);
  return withVatFilingBasisTransaction(async db=>{
    const previousRequest=await replay(db,input.requestId,"fact_revision",payloadHash,actor);if(previousRequest)return previousRequest;
    await currentVatFilingSubject(db,fact.subjectId);
    const root=rowsToObjects(await db.exec("SELECT fact_id,subject_id,kind,external_key FROM vat_filing_facts WHERE fact_id=$1",[fact.factId]))[0];
    if(root && (root.subject_id!==fact.subjectId||root.kind!==fact.kind||root.external_key!==fact.data.externalKey))throw fail("외부 사실의 주체·유형·문서 식별자는 변경할 수 없습니다.");
    const old=rowsToObjects(await db.exec("SELECT revision_id,version,period_year,period_term FROM vat_filing_fact_revisions WHERE fact_id=$1 ORDER BY version DESC LIMIT 1",[fact.factId]))[0];
    if(Number(old?.version??0)!==input.expectedVersion || (old?.revision_id??null)!==fact.data.supersedesRevisionId)throw fail("외부 근거의 유효 말단이 변경되었습니다. 최신 판번호를 다시 확인하세요.");
    if(old && (Number(old.period_year)!==fact.year||Number(old.period_term)!==fact.term))throw fail("같은 외부 사실의 귀속 연도·기수는 변경할 수 없습니다. 올바른 원문과 별도 정정 관계를 확인하세요.");
    if(rowsToObjects(await db.exec("SELECT snapshot_id FROM vat_filing_basis_consumptions WHERE fact_id=$1 LIMIT 1",[fact.factId])).length)throw fail("이미 봉인한 신고 근거에 사용된 사실입니다. B1에서는 과거 소비를 해제하거나 바꾸지 않습니다.");
    await validate?.(db);
    const protectedScopes=await sealedScopesBeforeWrite(db,fact.subjectId);
    if(!root)await db.run("INSERT INTO vat_filing_facts(fact_id,subject_id,kind,external_key)VALUES($1,$2,$3,$4)",[fact.factId,fact.subjectId,fact.kind,fact.data.externalKey]);
    await db.run("INSERT INTO vat_filing_fact_revisions(revision_id,fact_id,subject_id,kind,version,previous_revision_id,state,period_year,period_term,date_from,date_to,amount,payload_json,actor_user_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)",[fact.revisionId,fact.factId,fact.subjectId,fact.kind,fact.version,old?.revision_id??null,fact.state,fact.year,fact.term,fact.from,fact.to,fact.amount,JSON.stringify(fact),actor]);
    await assertSealedScopesUnchanged(db,protectedScopes);
    const result={revisionId:fact.revisionId,factId:fact.factId,version:fact.version,replayed:false};
    await remember(db,input.requestId,"fact_revision",payloadHash,result,actor,fact.revisionId);return result;
  });
}

export interface VatFilingScopeQuery { subjectId: string; year: number; term: 1|2; kind: "preliminary"|"final"; collectionCorpNum: string|null }
export async function getVatFilingScope(input: VatFilingScopeQuery, db?: PgDatabase): Promise<VatFilingScopeResult> {
  if(!input||!validId(input.subjectId))throw fail("신고 주체 식별자가 올바르지 않습니다.",400);
  if(!Number.isInteger(input.year)||input.year<1000||input.year>9999||![1,2].includes(input.term)||!["preliminary","final"].includes(input.kind))throw fail("신고 대상기간이 올바르지 않습니다.",400);
  if(!db)return withVatFilingBasisTransaction(tx=>getVatFilingScope(input,tx));
  const period={from:`${input.year}-${input.term===1?'01':'07'}-01`,to:`${input.year}-${input.kind==='preliminary'?(input.term===1?'03-31':'09-30'):(input.term===1?'06-30':'12-31')}`};
  const subject=await currentVatFilingSubject(db,input.subjectId,period),facts=await vatFilingSubjectFacts(db,input.subjectId);
  return resolveVatFilingScope({subject,facts,year:input.year,term:input.term,kind:input.kind,collectionCorpNum:input.collectionCorpNum});
}

export interface SealVatFilingBasisInput extends VatFilingScopeQuery {requestId: string; expectedScopeHash: string}
export async function sealVatFilingBasis(input: SealVatFilingBasisInput, actor: string, validate?: VatFilingWriteValidation) {
  requestValid(input?.requestId,actor);
  if(!/^[a-f0-9]{64}$/.test(input?.expectedScopeHash??""))throw fail("확인한 신고 근거 지문이 필요합니다.",400);
  const payloadHash=hash(input);
  return withVatFilingBasisTransaction(async db=>{
    const previousRequest=await replay(db,input.requestId,"seal_basis",payloadHash,actor);if(previousRequest)return previousRequest;
    await validate?.(db);
    const scope=await getVatFilingScope(input,db);
    if(scope.scopeHash!==input.expectedScopeHash)throw fail("조회 후 신고 주체·외부 근거가 변경되었습니다. 새 결과를 확인하세요.");
    if(!scope.canCalculate||scope.status!=="ready")throw Object.assign(fail("미확인·미지원 신고 근거가 남아 봉인할 수 없습니다."),{issues:scope.issues});
    const snapshotId=`vfb-${randomUUID()}`;
    await db.run("INSERT INTO vat_filing_basis_snapshots(snapshot_id,subject_id,subject_revision_id,period_year,period_term,period_kind,date_from,date_to,schema_version,scope_hash,scope_json,consumption_plan,actor_user_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)",[snapshotId,scope.subjectId,scope.subjectRevisionId,scope.year,scope.term,scope.kind,scope.dateFrom,scope.dateTo,VAT_FILING_BASIS_SCHEMA,scope.scopeHash,JSON.stringify(scope),JSON.stringify(scope.consumptions),actor]);
    for(const item of scope.consumptions)await db.run("INSERT INTO vat_filing_basis_consumptions(consumption_id,snapshot_id,fact_id,revision_id,subject_id,kind,amount)VALUES($1,$2,$3,$4,$5,$6,$7)",[`vfbc-${randomUUID()}`,snapshotId,item.factId,item.revisionId,scope.subjectId,item.kind,item.amount]);
    const result={snapshotId,schemaVersion:VAT_FILING_BASIS_SCHEMA,scopeHash:scope.scopeHash,status:"basis_sealed",taxReturnConfirmed:false,replayed:false};
    await remember(db,input.requestId,"seal_basis",payloadHash,result,actor,snapshotId);return result;
  });
}

/** 과거 confirmed의 형식 버전을 현재 계산 버전으로 바꾸지 않는다. 읽기/출력과 새 계산은 별개다. */
export async function readVatFilingArchive(input: {origin:"legacy"|"basis";id:string}, db?: PgDatabase): Promise<any> {
  if(!input||!validId(input.id)||!["legacy","basis"].includes(input.origin))throw fail("저장본 식별자가 올바르지 않습니다.",400);
  if(!db)return withVatFilingBasisTransaction(tx=>readVatFilingArchive(input,tx));
  if(input.origin==="legacy") {
    const row=rowsToObjects(await db.exec("SELECT * FROM vat_returns WHERE return_id=$1",[input.id]))[0];
    if(!row)throw fail("과거 신고 저장본을 찾을 수 없습니다.",404);
    return {origin:"legacy",readOnly:true,externalFilingStatus:"not_verified_by_this_snapshot",record:row,form:json(row.form_json)};
  }
  const row=rowsToObjects(await db.exec("SELECT * FROM vat_filing_basis_snapshots WHERE snapshot_id=$1",[input.id]))[0];
  if(!row)throw fail("봉인된 신고 근거를 찾을 수 없습니다.",404);
  return {origin:"basis",readOnly:true,taxReturnConfirmed:false,record:row,scope:json(row.scope_json)};
}

export async function inspectVatFilingBasis(snapshotId: string, collectionCorpNum: string|null) {
  return withVatFilingBasisTransaction(async db=>{
    const archive=await readVatFilingArchive({origin:"basis",id:snapshotId},db),stored=archive.scope as VatFilingScopeResult;
    if(archive.record.schema_version!==VAT_FILING_BASIS_SCHEMA)return {archive,current:null,status:"unsupported_version"};
    const current=await getVatFilingScope({subjectId:stored.subjectId,year:stored.year,term:stored.term,kind:stored.kind,collectionCorpNum},db);
    return {archive,current,status:current.scopeHash===stored.scopeHash?"unchanged":"review_required"};
  });
}
