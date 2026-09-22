import {createHash, randomUUID} from 'node:crypto';
import {withDbWrite, rowsToObjects, type PgDatabase} from '@/lib/db';
import {recordAuditLogInline} from '@/lib/auth/audit';
import {lockAccountingWrite} from './write-lock';
import {getVatFilingScope, readVatFilingArchive} from './vat-filing-basis';
import {resolveVatFilingScope, type VatFilingScopeResult} from './vat-filing-scope';
import {buildVatReturn, vatPeriod, type VatReturnForm, type VatReturnRecord} from './vat-return';
import {assertVatFinalizationOpen} from './vat-finalization-boundary';
import type {VatFollowupSelection} from './vat-followup-consumption-types';
import {assertVatFollowupCalculation, persistVatFollowupConsumption, selectionFromVatFollowupForm} from './vat-followup-consumption';
import type {VatSameSupplySelection} from './vat-same-supply-types';
import {assertSameSupplyCalculation,parseSameSupplySelection,persistSameSupplyConsumption,selectionFromSameSupplyForm} from './vat-same-supply';
import {assertVatUsePrerequisites} from './vat-use-prerequisites';

const SCHEMA='vat-return-basis-v1';
const TABLES=['vat_filing_return_revisions','vat_filing_return_confirmations','vat_filing_return_requests','vat_filing_return_fences'];
const error=(message:string,status=409,code='vat_return_basis_conflict',issues?:unknown)=>Object.assign(new Error(message),{status,code,...(issues?{issues}:{})});
const id=(value:unknown):value is string=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200;
const digest=(value:unknown)=>createHash('sha256').update(stableJson(value)).digest('hex');
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
const stableJson=(value:unknown)=>JSON.stringify(stable(value));
const parse=(value:unknown):any=>typeof value==='string'?JSON.parse(value):value;
function translate(e:any):never {
  if(['40001','40P01'].includes(e?.code))throw error('다른 작업이 신고 근거를 변경했습니다. 최신 자료를 조회한 뒤 다시 시도하세요.',409,'vat_return_concurrent_change');
  if(['42P01','42703','42883','55000'].includes(e?.code))throw error('신고 근거·계산 자료구조를 확인할 수 없습니다. 적용한 마이그레이션과 보관 근거를 확인하세요.',503,'vat_return_basis_unavailable');
  if(['23505','23503','23514'].includes(e?.code))throw error('신고 계산판·근거 사용·확정 제약이 맞지 않습니다. 최신 저장본을 확인하세요.');
  if(e instanceof SyntaxError)throw error('저장된 신고 근거의 형식을 읽을 수 없습니다.',503,'vat_return_basis_unavailable');
  throw e;
}
async function transaction<T>(fn:(db:PgDatabase)=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++)try{return await withDbWrite(async db=>{await lockAccountingWrite(db);return fn(db);},{accountingSnapshot:true});}
  catch(e){if(attempt<2&&['40001','40P01'].includes(String((e as any)?.code)))continue;return translate(e);}
}
async function structure(db:PgDatabase){
  const rows=rowsToObjects(await db.exec('SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name',[TABLES]));
  if(TABLES.some(name=>!rows.some(r=>r.name===name&&r.present===true)))throw error('부가세 계산 자료구조 230이 준비되지 않았습니다.',503,'vat_return_basis_unavailable');
}
/** 수집 주체는 서버 설정에서만 읽는다. 요청이나 봉인본의 번호를 기본값으로 쓰지 않는다. */
export function vatReturnCollectorCorpNum():string|null{
  const value=String(process.env.BAROBILL_CORPNUM??'').trim();
  if(!/^[\d\s-]+$/.test(value))return null;
  const number=value.replace(/[\s-]/g,'');return /^\d{10}$/.test(number)?number:null;
}
export interface BasisVatReturnInput {basisSnapshotId:string;expectedScopeHash:string;manual?:Record<string,number>;followup?:VatFollowupSelection;sameSupply?:VatSameSupplySelection}
function validateInput(input:BasisVatReturnInput){
  if(input?.sameSupply!==undefined)parseSameSupplySelection(input.sameSupply);
  if(!input||!id(input.basisSnapshotId)||!/^[a-f0-9]{64}$/.test(input.expectedScopeHash??''))throw error('신고 근거 식별자와 확인한 판 지문이 필요합니다.',400,'vat_return_basis_input');
  if(input.manual!==undefined&&(!input.manual||typeof input.manual!=='object'||Array.isArray(input.manual)||Object.entries(input.manual).some(([k,v])=>!['etaxCredit','penalty'].includes(k)||!Number.isSafeInteger(v)||v<0)))throw error('예정고지·미환급액은 직접 입력할 수 없습니다. 전자신고 공제·가산세의 원 단위 정수만 입력하세요.',400,'vat_return_basis_input');
}
async function validatedBasis(db:PgDatabase,input:BasisVatReturnInput):Promise<VatFilingScopeResult>{
  validateInput(input);await structure(db);
  const archive=await readVatFilingArchive({origin:'basis',id:input.basisSnapshotId},db);
  const saved=archive.scope as VatFilingScopeResult;
  if(archive.record.schema_version!=='vat-filing-basis-v1'||saved?.schemaVersion!=='vat-filing-basis-v1')throw error('지원하지 않는 근거 보관 형식입니다.',503,'vat_return_basis_unavailable');
  let rebuilt:VatFilingScopeResult;
  try{rebuilt=resolveVatFilingScope({...saved.evidenceSnapshot,year:saved.year,term:saved.term,kind:saved.kind});}
  catch{throw error('저장된 신고 근거의 구성 내용을 검증할 수 없습니다.',503,'vat_return_basis_unavailable');}
  if(stableJson(rebuilt)!==stableJson(saved)||archive.record.scope_hash!==saved.scopeHash||archive.record.subject_id!==saved.subjectId||archive.record.date_from!==saved.dateFrom||archive.record.date_to!==saved.dateTo)throw error('저장된 신고 근거와 지문이 일치하지 않습니다.',503,'vat_return_basis_unavailable');
  if(input.expectedScopeHash!==saved.scopeHash)throw error('선택한 신고 근거판이 다릅니다. 자료를 다시 확인하세요.');
  const current=await getVatFilingScope({subjectId:saved.subjectId,year:saved.year,term:saved.term,kind:saved.kind,collectionCorpNum:vatReturnCollectorCorpNum()},db);
  if(!current.canCalculate||current.scopeHash!==saved.scopeHash)throw error('주체·외부 근거가 보관 이후 달라졌거나 수집 주체를 확인할 수 없습니다. 후행 검토가 필요합니다.',409,'vat_return_basis_changed',current.issues);
  const consumed=rowsToObjects(await db.exec('SELECT fact_id,revision_id,kind,amount FROM vat_filing_basis_consumptions WHERE snapshot_id=$1 ORDER BY fact_id,kind',[input.basisSnapshotId]))
    .map(r=>({factId:String(r.fact_id),revisionId:String(r.revision_id),kind:String(r.kind),amount:Number(r.amount)}));
  const plan=[...saved.consumptions].sort((a,b)=>a.factId.localeCompare(b.factId)||a.kind.localeCompare(b.kind));
  if(stableJson(consumed)!==stableJson(plan))throw error('봉인된 사용 근거와 실제 소비 원장이 일치하지 않습니다.',503,'vat_return_basis_unavailable');
  return current;
}
/** 수집 시각/생성시각은 표시값이다. 실제 원천·금액·차단·대사·근거는 비교한다. */
export function basisVatCalculationHash(form:VatReturnForm):string{
  if(form.filingBasis?.version==='vat-return-basis-v3'){
    const hash=assertSameSupplyCalculation(form).calculationHash;
    if(form.followupConsumption)assertVatFollowupCalculation(form);
    return hash;
  }
  if(form.sameSupplyConsumption)throw error('구형 계산판에 같은 공급 사용을 붙일 수 없습니다.',503,'vat_return_basis_unavailable');
  if(form.filingBasis?.version==='vat-return-basis-v2')return assertVatFollowupCalculation(form).calculationHash;
  if(form.followupConsumption)throw error('구형 계산판에 후행 검토를 붙일 수 없습니다.',503,'vat_return_basis_unavailable');
  const {generatedAt:_generated,warnings:_warnings,ledgerSnapshot,filingBasis,...calculation}=form;
  const {calculationHash:_hash,...basis}=filingBasis??{};
  return digest({...calculation,filingBasis:basis,ledgerRows:ledgerSnapshot?.rows});
}
export async function buildBasisVatReturn(input:BasisVatReturnInput,db?:PgDatabase):Promise<VatReturnForm>{
  if(!db)return transaction(tx=>buildBasisVatReturn(input,tx));
  const scope=await validatedBasis(db,input);
  if(input.followup && input.followup.subjectId!==scope.subjectId)throw error('봉인 주체와 후행 검토 주체가 다릅니다.',400,'vat_return_basis_input');
  if(input.sameSupply && input.sameSupply.subjectId!==scope.subjectId)throw error('봉인 주체와 같은 공급 검토 주체가 다릅니다.',400,'vat_return_basis_input');
  const form=await buildVatReturn(vatPeriod(scope.year,scope.term,scope.kind==='preliminary'?'pre':'final'),input.manual,db,{basisSnapshotId:input.basisSnapshotId,scope},input.followup,input.sameSupply);
  form.filingBasis!.calculationHash=basisVatCalculationHash(form);return form;
}
export async function listVatReturnBases(){return transaction(async db=>{
  await structure(db);
  const rows=rowsToObjects(await db.exec('SELECT snapshot_id,subject_id,scope_hash,period_year,period_term,period_kind,date_from,date_to,scope_json FROM vat_filing_basis_snapshots ORDER BY period_year DESC,period_term DESC,period_kind,snapshot_id'));
  return rows.map(r=>{const scope=parse(r.scope_json);return {basisSnapshotId:String(r.snapshot_id),subjectId:String(r.subject_id),scopeHash:String(r.scope_hash),year:Number(r.period_year),term:Number(r.period_term) as 1|2,kind:r.period_kind==='preliminary'?'pre' as const:'final' as const,dateFrom:String(r.date_from),dateTo:String(r.date_to),mode:scope.mode as VatFilingScopeResult['mode'],label:`${r.period_year}년 ${r.period_term}기 ${r.period_kind==='preliminary'?'예정':'확정'} (${r.date_from}~${r.date_to})`};});
});}
function request(input:{requestId:string;expectedCalculationHash:string},actor:string){if(!id(input?.requestId)||!id(actor)||!/^[a-f0-9]{64}$/.test(input?.expectedCalculationHash??''))throw error('요청 식별자·담당자·확인한 계산 지문이 필요합니다.',400,'vat_return_basis_input');}
async function replay(db:PgDatabase,requestId:string,action:string,payloadHash:string,actor:string){
  const row=rowsToObjects(await db.exec('SELECT * FROM vat_filing_return_requests WHERE request_id=$1',[requestId]))[0];
  if(!row)return null;
  if(row.action!==action||row.payload_hash!==payloadHash||row.actor_user_id!==actor)throw error('같은 요청 식별자에 다른 내용 또는 담당자가 있습니다.');
  return {...parse(row.result_json),replayed:true};
}
async function remember(db:PgDatabase,requestId:string,action:'save'|'confirm',payloadHash:string,actor:string,result:any){
  await db.run('INSERT INTO vat_filing_return_requests(request_id,action,payload_hash,result_json,actor_user_id) VALUES($1,$2,$3,$4::jsonb,$5)',[requestId,action,payloadHash,JSON.stringify(result),actor]);
  await recordAuditLogInline(db,{actorUserId:actor,action:action==='save'?'vat_return_save':'vat_return_confirm',targetTable:action==='save'?'vat_filing_return_revisions':'vat_filing_return_confirmations',targetId:result.returnId,after:result});
}
export async function saveBasisVatReturn(input:BasisVatReturnInput&{requestId:string;expectedCalculationHash:string},actor:string):Promise<{returnId:string;form:VatReturnForm;replayed?:boolean}>{
  validateInput(input);request(input,actor);const payloadHash=digest(input);
  return transaction(async db=>{
    await structure(db);const previousRequest=await replay(db,input.requestId,'save',payloadHash,actor);if(previousRequest){const stored=await loadVatReturnRecord(previousRequest.returnId,db);if(!stored)throw error('요청에 해당하는 저장본이 없습니다.',503,'vat_return_basis_unavailable');return {...previousRequest,form:stored.form};}
    const form=await buildBasisVatReturn(input,db);
    if(rowsToObjects(await db.exec('SELECT confirmation_id FROM vat_filing_return_confirmations WHERE basis_snapshot_id=$1',[input.basisSnapshotId])).length)throw error('이미 확정한 신고 근거입니다. 과거 저장본을 보존하고 후행 정정 절차를 확인하세요.');
    await assertVatFinalizationOpen(db,{subjectId:form.filingBasis!.subjectId,year:form.period.year,term:form.period.term,kind:form.period.kind,path:'basis'});
    if(form.filingBasis!.calculationHash!==input.expectedCalculationHash)throw error('조회 이후 원천·계산이 달라졌습니다. 다시 계산하여 확인하세요.',409,'vat_return_calculation_changed');
    const old=rowsToObjects(await db.exec('SELECT return_id,revision FROM vat_filing_return_revisions WHERE basis_snapshot_id=$1 ORDER BY revision DESC LIMIT 1',[input.basisSnapshotId]))[0];
    const returnId=`vbr-${randomUUID()}`,revision=Number(old?.revision??0)+1;
    await db.run('INSERT INTO vat_filing_return_revisions(return_id,basis_snapshot_id,revision,previous_return_id,schema_version,calculation_hash,scope_hash,form_json,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',[returnId,input.basisSnapshotId,revision,old?.return_id??null,form.filingBasis!.version,form.filingBasis!.calculationHash,form.filingBasis!.scopeHash,JSON.stringify(form),actor]);
    await remember(db,input.requestId,'save',payloadHash,actor,{returnId,revision,basisSnapshotId:input.basisSnapshotId,calculationHash:form.filingBasis!.calculationHash});
    return {returnId,form};
  });
}
export async function confirmBasisVatReturn(input:{returnId:string;requestId:string;expectedCalculationHash:string},actor:string):Promise<{confirmationId:string;returnId:string;replayed?:boolean}>{
  request(input,actor);if(!id(input.returnId))throw error('저장본 식별자가 필요합니다.',400);const payloadHash=digest(input);
  return transaction(async db=>{
    await structure(db);const retried=await replay(db,input.requestId,'confirm',payloadHash,actor);if(retried){const saved=await loadVatReturnRecord(input.returnId,db);if(!saved||saved.status!=='confirmed')throw error('확정 요청의 저장 근거를 확인할 수 없습니다.',503,'vat_return_basis_unavailable');return retried;}
    const record=await loadVatReturnRecord(input.returnId,db);
    if(!record)throw error('저장된 신고서를 찾을 수 없습니다.',404);
    if(record.origin!=='basis_return')throw error('과거 형식의 저장본은 읽기 전용입니다. 새 근거로 별도 작성하세요.');
    const basis=record.form.filingBasis!;
    if(basis.calculationHash!==input.expectedCalculationHash)throw error('확인한 계산판이 다릅니다.');
    const existing=rowsToObjects(await db.exec('SELECT * FROM vat_filing_return_confirmations WHERE return_id=$1',[input.returnId]))[0];
    if(existing)return {confirmationId:String(existing.confirmation_id),returnId:input.returnId,replayed:true};
    await assertVatFinalizationOpen(db,{subjectId:basis.subjectId,year:record.periodYear,term:record.periodTerm as 1|2,kind:record.periodKind==='pre'?'pre':'final',path:'basis'});
    const latest=rowsToObjects(await db.exec('SELECT return_id FROM vat_filing_return_revisions WHERE basis_snapshot_id=$1 ORDER BY revision DESC LIMIT 1',[record.basisSnapshotId]))[0];
    if(latest?.return_id!==record.returnId)throw error('이후 계산판이 있습니다. 최신 저장본을 확인하세요.');
    const current=await buildBasisVatReturn({basisSnapshotId:basis.basisSnapshotId,expectedScopeHash:basis.scopeHash,manual:Object.fromEntries(record.form.manual.map(m=>[m.key,m.amount])),followup:selectionFromVatFollowupForm(record.form),sameSupply:selectionFromSameSupplyForm(record.form)},db);
    if(current.blockingIssues.length)throw error('원천·신고 검토가 끝나지 않아 확정할 수 없습니다.',409,'vat_return_review_required',current.blockingIssues);
    if(current.filingBasis!.calculationHash!==basis.calculationHash)throw error('원천 또는 계산이 저장 이후 달라졌습니다. 다시 계산하여 별도 판으로 저장하세요.',409,'vat_return_calculation_changed');
    const confirmationId=`vbc-${randomUUID()}`;
    await db.run('INSERT INTO vat_filing_return_confirmations(confirmation_id,return_id,basis_snapshot_id,calculation_hash,confirmed_by)VALUES($1,$2,$3,$4,$5)',[confirmationId,input.returnId,record.basisSnapshotId,basis.calculationHash,actor]);
    await persistSameSupplyConsumption(db,current,confirmationId,actor);
    await persistVatFollowupConsumption(db,current,{path:'basis',returnId:input.returnId,confirmationId},actor);
    const result={confirmationId,returnId:input.returnId};await remember(db,input.requestId,'confirm',payloadHash,actor,result);return result;
  });
}
function record(row:Record<string,unknown>,origin:'legacy'|'basis_return'):VatReturnRecord{
  const form=parse(row.form_json) as VatReturnForm;
  if(origin==='basis_return'&&(!form.filingBasis||![SCHEMA,'vat-return-basis-v2','vat-return-basis-v3'].includes(String(row.schema_version))||form.filingBasis.version!==row.schema_version||basisVatCalculationHash(form)!==row.calculation_hash||form.filingBasis.basisSnapshotId!==row.basis_snapshot_id||form.filingBasis.calculationHash!==row.calculation_hash))throw error('저장된 계산판의 내용을 검증할 수 없습니다.',503,'vat_return_basis_unavailable');
  if(origin==='legacy'&&form.followupConsumption)assertVatFollowupCalculation(form);
  return {origin,returnId:String(row.return_id),basisSnapshotId:origin==='basis_return'?String(row.basis_snapshot_id):undefined,revision:origin==='basis_return'?Number(row.revision):undefined,
    periodYear:origin==='basis_return'?form.period.year:Number(row.period_year),periodTerm:origin==='basis_return'?form.period.term:Number(row.period_term),periodKind:origin==='basis_return'?form.period.kind:String(row.period_kind),dateFrom:origin==='basis_return'?form.period.from:String(row.date_from),dateTo:origin==='basis_return'?form.period.to:String(row.date_to),
    status:origin==='basis_return'?(row.confirmation_id?'confirmed':'draft'):String(row.status),form,memo:row.memo?String(row.memo):null,createdBy:row.created_by?String(row.created_by):null,confirmedBy:row.confirmed_by?String(row.confirmed_by):null,confirmedAt:row.confirmed_at?String(row.confirmed_at):null,updatedAt:String(row.updated_at??row.created_at??'')};
}
const returnSelect='SELECT r.*,c.confirmation_id,c.confirmed_by,c.confirmed_at FROM vat_filing_return_revisions r LEFT JOIN vat_filing_return_confirmations c ON c.return_id=r.return_id';
export async function loadVatReturnRecord(returnId:string,db?:PgDatabase):Promise<VatReturnRecord|null>{
  if(!id(returnId))throw error('저장본 식별자가 올바르지 않습니다.',400);
  if(!db)return transaction(tx=>loadVatReturnRecord(returnId,tx));
  if(returnId.startsWith('vbr-')){await structure(db);const row=rowsToObjects(await db.exec(returnSelect+' WHERE r.return_id=$1',[returnId]))[0];const saved=row?record(row,'basis_return'):null;if(saved?.form.sameSupplyConsumption){await assertVatUsePrerequisites(db,process.env.FINANCE_R1_SCHEMA??'public');await db.exec('SELECT finance_vat_use_assert_form_v3($1::jsonb)',[JSON.stringify(saved.form)]);if(row.confirmation_id)await db.exec('SELECT finance_vat_use_assert_confirmation($1)',[row.confirmation_id]);}return saved;}
  const row=rowsToObjects(await db.exec('SELECT * FROM vat_returns WHERE return_id=$1',[returnId]))[0];return row?record(row,'legacy'):null;
}
export async function listVatReturnRecords():Promise<VatReturnRecord[]>{return transaction(async db=>{
  await structure(db);
  const legacy=rowsToObjects(await db.exec('SELECT * FROM vat_returns ORDER BY period_year DESC,period_term DESC,period_kind'));
  const current=rowsToObjects(await db.exec(returnSelect+' ORDER BY r.created_at DESC,r.revision DESC'));
  if(current.some(row=>row.schema_version==='vat-return-basis-v3'))await assertVatUsePrerequisites(db,process.env.FINANCE_R1_SCHEMA??'public');
  for(const row of current)if(row.schema_version==='vat-return-basis-v3'){await db.exec('SELECT finance_vat_use_assert_form_v3($1::jsonb)',[JSON.stringify(parse(row.form_json))]);if(row.confirmation_id)await db.exec('SELECT finance_vat_use_assert_confirmation($1)',[row.confirmation_id]);}
  return [...current.map(r=>record(r,'basis_return')),...legacy.map(r=>record(r,'legacy'))];
});}
