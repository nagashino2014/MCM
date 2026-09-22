import { createHash } from 'node:crypto';
import { rowsToObjects, withDbWrite, type PgDatabase } from '@/lib/db';
import { recordAuditLogInline } from '@/lib/auth/audit';
import { lockAccountingWrite } from './write-lock';
import { requireVatFilingDocument } from './vat-filing-documents';
import { readVatFilingArchive } from './vat-filing-basis';
import { loadVatReturnRecord } from './vat-return-basis';
import type { VatFilingScopeResult } from './vat-filing-scope';
import type { VatPostAllocation, VatPostEventInput, VatPostEventRecord, VatPostIssue, VatPostOverview, VatPostPreview, VatPostPreviewInput, VatPostSaveInput, VatPostSaveResult, VatPostTarget, VatPostTargetRef } from './vat-filing-post-types';
export type * from './vat-filing-post-types';

const tables = ['vat_filing_post_identities','vat_filing_post_events','vat_filing_post_bindings','vat_filing_post_requests','vat_filing_post_revisions','vat_filing_post_allocations','vat_filing_post_fences','vat_filing_documents','vat_filing_basis_snapshots','vat_filing_basis_consumptions','vat_filing_return_revisions','vat_filing_return_confirmations'];
const fail = (message: string, status = 409, code = 'vat_post_conflict') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('사후 접수·납부의 저장 구조 또는 원문을 검증할 수 없습니다. 229~232와 후행 검토 사용 시 236~237 적용 상태 및 보관 자료를 확인하세요.',503,'vat_post_unavailable');
const parse = (v: any): any => typeof v === 'string' ? JSON.parse(v) : v;
function canonical(v: any): string { return v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`; }
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const generated = (prefix: string, requestId: string) => `${prefix}-${hash(requestId).slice(0,40)}`;
const key = (v: string) => v.trim().replace(/\s/g,'').toUpperCase();
function id(v: unknown, label: string, max = 200): string { if(typeof v !== 'string' || !v || v !== v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw fail(`${label}을 확인하세요.`,400,'vat_post_input'); return v; }
function object(v: unknown, label: string): Record<string,any> { if(!v || typeof v!=='object' || Array.isArray(v))throw fail(`${label} 형식을 확인하세요.`,400,'vat_post_input');return v as Record<string,any>; }
function exact(v: Record<string,any>, allowed: string[]) { if(Object.keys(v).some(k=>!allowed.includes(k)))throw fail('허용되지 않은 입력 항목이 있습니다.',400,'vat_post_input'); }
function day(v: unknown): string { const s=id(v,'원문 일자',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw fail('원문 일자를 확인하세요.',400,'vat_post_input');return s; }
function money(v: unknown, nullable=false, signed=false): number|null { if(nullable&&v===null)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||!signed&&v<0)throw fail('금액은 확인한 원 단위 정수로 입력하세요.',400,'vat_post_input');return v; }
function target(v: unknown): VatPostTargetRef { const r=object(v,'대상');exact(r,['kind','id']);if(r.kind!=='notice'&&r.kind!=='return')throw fail('봉인 고지 또는 내부 확정 대상을 선택하세요.',400);return {kind:r.kind,id:id(r.id,'대상')}; }
const targetKey=(r:VatPostTargetRef)=>`${r.kind}:${r.id}`;
const sameTarget=(a:VatPostTargetRef,b:VatPostTargetRef)=>a.kind===b.kind&&a.id===b.id;
function normalize(input: VatPostPreviewInput|VatPostSaveInput): VatPostPreviewInput {
 const v=object(input,'사후 기록');exact(v,['requestId','subjectId','eventId','expectedVersion','event','expectedPreviewHash','reviewConfirmed']);
 const requestId=id(v.requestId,'요청'),subjectId=id(v.subjectId,'주체');
 if(!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<0)throw fail('기대 판번호를 확인하세요.',400);
 const e=object(v.event,'사건');exact(e,['kind','state','officialKey','evidenceDocumentId','occurredAt','reason','sharedB1FactId','receipt','payment','reconciliation','other']);
 if(!['receipt','payment','reconciliation','other'].includes(e.kind)||!['recorded','verified','withdrawn'].includes(e.state))throw fail('사건 종류·검토 상태를 확인하세요.',400);
 if(['receipt','payment','reconciliation','other'].some(k=>k!==e.kind&&e[k]!==undefined))throw fail('사건 종류와 금액 항목이 다릅니다.',400);
 const event:VatPostEventInput={kind:e.kind,state:e.state,officialKey:e.officialKey===null?null:key(id(e.officialKey,'공식 식별자',300)),evidenceDocumentId:id(e.evidenceDocumentId,'서버 증빙'),occurredAt:day(e.occurredAt),reason:id(e.reason,'사유',2000),sharedB1FactId:e.sharedB1FactId==null?null:id(e.sharedB1FactId,'기존 사실')};
 if(event.officialKey!==null&&!event.officialKey)throw fail('공식 식별자를 확인하세요.',400);
 const d=object(e[e.kind],'사건 상세');
 if(e.kind==='receipt'){exact(d,['target','declaredTax']);const t=target(d.target);if(t.kind!=='return')throw fail('접수는 내부 확정 신고서를 선택하세요.',400);event.receipt={target:t,declaredTax:money(d.declaredTax,true,true)};}
 else if(e.kind==='payment'){
  exact(d,['actualTotal','additionalCharges','otherAmount','unallocatedAmount','allocations']);
  if(!Array.isArray(d.allocations)||d.allocations.length>100)throw fail('배부 명세는 100개 이하로 입력하세요.',400);
  const allocations:VatPostAllocation[]=d.allocations.map((a:unknown)=>{const r=object(a,'배부');exact(r,['target','amount']);const amount=money(r.amount)!;if(amount<=0)throw fail('배부액은 0원보다 커야 합니다.',400);return {target:target(r.target),amount};});
  if(new Set(allocations.map(a=>targetKey(a.target))).size!==allocations.length)throw fail('같은 대상은 한 배부행으로 입력하세요.',400);
  event.payment={actualTotal:money(d.actualTotal,true),additionalCharges:money(d.additionalCharges)!,otherAmount:money(d.otherAmount)!,unallocatedAmount:money(d.unallocatedAmount)!,allocations};
 }else if(e.kind==='reconciliation'){exact(d,['target','throughDate','observedPaidTotal']);event.reconciliation={target:target(d.target),throughDate:day(d.throughDate),observedPaidTotal:money(d.observedPaidTotal,true)};if(event.reconciliation.throughDate>event.occurredAt)throw fail('조회 기준일은 원문 확인일 이후일 수 없습니다.',400);}
 else {exact(d,['category','amount','target']);if(!['offset','refund','other'].includes(d.category))throw fail('기타 기록 종류를 확인하세요.',400);event.other={category:d.category,amount:money(d.amount,true),target:d.target==null?null:target(d.target)};}
 return {requestId,subjectId,eventId:v.eventId==null?null:id(v.eventId,'사건'),expectedVersion:v.expectedVersion,event};
}
async function structure(db:PgDatabase){ const rows=rowsToObjects(await db.exec('SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name',[tables]));if(tables.some(t=>!rows.some(r=>r.name===t&&r.present===true)))throw unavailable();await db.exec('SELECT revision_id,payload_hash,request_id FROM vat_filing_post_revisions WHERE false');await db.exec('SELECT * FROM vat_post_target($1,$2) WHERE false',['notice','schema-check']); }
async function transaction<T>(fn:(db:PgDatabase)=>Promise<T>):Promise<T>{for(let attempt=0;;attempt++){try{return await withDbWrite(async db=>{await lockAccountingWrite(db);await structure(db);return fn(db);},{accountingSnapshot:true});}catch(error){const e=error as any;if(attempt<2&&['40001','40P01'].includes(e.code))continue;if(e.status)throw e;if(['23505','23514','23503','P0002'].includes(e.code))throw fail('원문·공식 식별자·판번호 또는 대상 배부가 최신 상태와 일치하지 않습니다. 다시 검토하세요.');throw unavailable();}}}
function scopeArchive(archive:any):VatFilingScopeResult {
 const s=archive.scope as VatFilingScopeResult,r=archive.record;if(!s||s.schemaVersion!=='vat-filing-basis-v1'||r.schema_version!==s.schemaVersion||s.subjectId!==r.subject_id||s.scopeHash!==r.scope_hash||!Array.isArray(s.effectiveFactRevisionIds)||!Array.isArray(s.evidenceSnapshot?.facts))throw unavailable();
 const {scopeHash,...rest}=s;if(hash(rest)!==scopeHash)throw unavailable();return s;
}
async function targetAt(db:PgDatabase,ref:VatPostTargetRef,throughDate?:string):Promise<{amount:number;baseline:number|null;known:boolean;subjectId:string}>{
 const row=rowsToObjects(await db.exec('SELECT * FROM vat_post_target($1,$2,$3)',[ref.kind,ref.id,throughDate??null]))[0];if(!row)throw fail('대상을 찾을 수 없습니다.',404);const amount=Number(row.target_amount),baseline=row.baseline_paid==null?null:Number(row.baseline_paid);if(!Number.isSafeInteger(amount)||baseline!==null&&!Number.isSafeInteger(baseline))throw unavailable();return {amount,baseline,known:row.baseline_known===true,subjectId:String(row.subject_id)};
}
/** v1만 있는 주체는 기존 경로를 유지하고, v2는 구형 SQL 검산으로 처리하지 않는다. */
async function requireV2TargetStructure(db:PgDatabase):Promise<void>{
 try{
  const ready=rowsToObjects(await db.exec("SELECT to_regprocedure('vat_post_target_version()') IS NOT NULL AS version, to_regprocedure('vat_post_confirmed_return_hash(text)') IS NOT NULL AS verifier"))[0];
  if(!ready?.version||!ready.verifier)throw unavailable();
  if(rowsToObjects(await db.exec('SELECT vat_post_target_version() AS version'))[0]?.version!=='vat-post-target-v2')throw unavailable();
 }catch(error){if(['40001','40P01'].includes(String((error as {code?:string}).code)))throw error;throw unavailable();}
}
async function loadTargets(db:PgDatabase,subjectId:string):Promise<VatPostTarget[]>{
 const result:VatPostTarget[]=[];
 const notices=rowsToObjects(await db.exec("SELECT c.consumption_id,c.fact_id,c.revision_id,c.snapshot_id,r.date_from,r.date_to FROM vat_filing_basis_consumptions c JOIN vat_filing_fact_revisions r ON r.revision_id=c.revision_id WHERE c.subject_id=$1 AND c.kind='notice' ORDER BY c.consumption_id",[subjectId]));
 for(const r of notices){const ref:VatPostTargetRef={kind:'notice',id:String(r.consumption_id)},s=scopeArchive(await readVatFilingArchive({origin:'basis',id:String(r.snapshot_id)},db)),t=await targetAt(db,ref);result.push({...ref,subjectId,year:s.year,term:s.term,periodKind:s.kind,dateFrom:String(r.date_from),dateTo:String(r.date_to),basisSnapshotId:String(r.snapshot_id),factId:String(r.fact_id),factRevisionId:String(r.revision_id),targetAmount:t.amount,allocatableAmount:Math.max(t.amount,0),baselinePaid:t.baseline,baselineComplete:s.payment.state==='complete',allocatedAfter:0,remainingKnown:t.baseline===null?null:Math.max(t.amount,0)-t.baseline,storedHash:s.scopeHash});}
 const returns=rowsToObjects(await db.exec('SELECT c.confirmation_id,c.return_id,c.calculation_hash FROM vat_filing_return_confirmations c JOIN vat_filing_basis_snapshots s ON s.snapshot_id=c.basis_snapshot_id WHERE s.subject_id=$1 ORDER BY c.confirmation_id',[subjectId]));
 for(const r of returns){const record=await loadVatReturnRecord(String(r.return_id),db);if(!record||record.origin!=='basis_return'||record.status!=='confirmed'||record.form.filingBasis?.calculationHash!==r.calculation_hash)throw unavailable();if(['vat-return-basis-v2','vat-return-basis-v3'].includes(record.form.filingBasis?.version??''))await requireV2TargetStructure(db);const ref:VatPostTargetRef={kind:'return',id:String(r.confirmation_id)},t=await targetAt(db,ref);scopeArchive(await readVatFilingArchive({origin:'basis',id:record.basisSnapshotId!},db));result.push({...ref,subjectId,year:record.periodYear,term:record.periodTerm as 1|2,periodKind:record.periodKind==='pre'?'preliminary':'final',dateFrom:record.dateFrom,dateTo:record.dateTo,basisSnapshotId:record.basisSnapshotId!,returnId:record.returnId,confirmationId:String(r.confirmation_id),targetAmount:t.amount,allocatableAmount:Math.max(t.amount,0),baselinePaid:0,allocatedAfter:0,baselineComplete:false,remainingKnown:Math.max(t.amount,0),storedHash:String(r.calculation_hash)});}
 return result;
}
async function loadEvents(db:PgDatabase,subjectId:string):Promise<VatPostEventRecord[]>{
 const rows=rowsToObjects(await db.exec('SELECT r.*,e.subject_id,e.kind,e.shared_b1_fact_id FROM vat_filing_post_revisions r JOIN vat_filing_post_events e ON e.event_id=r.event_id WHERE e.subject_id=$1 ORDER BY r.created_at,r.event_id,r.version',[subjectId]));
 const docs=new Map<string,string>(),result:VatPostEventRecord[]=[];
 for(const r of rows){const event=parse(r.payload_json) as VatPostEventInput;if(hash(event)!==r.payload_hash||event.kind!==r.kind||event.state!==r.state||event.evidenceDocumentId!==r.document_id||(event.sharedB1FactId??null)!==(r.shared_b1_fact_id??null))throw unavailable();let evidenceHash=docs.get(String(r.document_id));if(!evidenceHash){evidenceHash=(await requireVatFilingDocument(String(r.document_id),subjectId,db)).evidenceHash;docs.set(String(r.document_id),evidenceHash);}if(evidenceHash!==r.document_hash)throw unavailable();result.push({eventId:String(r.event_id),revisionId:String(r.revision_id),version:Number(r.version),subjectId,event,evidenceHash,reconciliationHash:r.reconciliation_hash==null?null:String(r.reconciliation_hash),referenceOnly:!!r.shared_b1_fact_id,actorUserId:String(r.actor_user_id),createdAt:String(r.created_at),matchStatus:event.state==='withdrawn'?'withdrawn':'unreviewed',issues:[]});}
 return result;
}
function heads(records:VatPostEventRecord[]):VatPostEventRecord[]{const map=new Map<string,VatPostEventRecord>();for(const r of records)if(!map.has(r.eventId)||map.get(r.eventId)!.version<r.version)map.set(r.eventId,r);return [...map.values()];}
function paidAfter(records:VatPostEventRecord[],ref:VatPostTargetRef,throughDate?:string,skipEventId?:string):bigint{return heads(records).filter(r=>r.eventId!==skipEventId&&!r.referenceOnly&&r.event.state==='verified'&&r.event.kind==='payment'&&(!throughDate||r.event.occurredAt<=throughDate)).reduce((sum,r)=>sum+(r.event.payment?.allocations??[]).filter(a=>sameTarget(a.target,ref)).reduce((n,a)=>n+BigInt(a.amount),BigInt(0)),BigInt(0));}
function enrichTargets(targets:VatPostTarget[],records:VatPostEventRecord[]){for(const t of targets){const paid=paidAfter(records,t);if(paid>BigInt(Number.MAX_SAFE_INTEGER))throw unavailable();t.allocatedAfter=Number(paid);t.remainingKnown=t.baselinePaid===null?null:t.allocatableAmount-t.baselinePaid-t.allocatedAfter;}return targets;}
async function references(db:PgDatabase,subjectId:string):Promise<VatPostOverview['referenceCandidates']>{return rowsToObjects(await db.exec("SELECT DISTINCT ON(f.fact_id) f.fact_id,f.kind,f.external_key,r.payload_json,r.state FROM vat_filing_facts f JOIN vat_filing_fact_revisions r ON r.fact_id=f.fact_id WHERE f.subject_id=$1 AND f.kind IN('payment','filing') ORDER BY f.fact_id,r.version DESC",[subjectId])).filter(r=>r.state==='verified').map(r=>{const f=parse(r.payload_json);return {factId:String(r.fact_id),kind:r.kind as 'filing'|'payment',label:`${r.kind==='filing'?'기존 접수':'기존 납부'} · ${f.year}년 ${f.term}기 · ${r.kind==='filing'?f.data.receiptNumber:r.external_key}`,officialKey:key(r.kind==='filing'?f.data.receiptNumber:String(r.external_key)),amount:f.amount,evidenceDocumentId:typeof f.evidenceRef==='string'&&f.evidenceRef.startsWith('vat-document:')?f.evidenceRef.slice(13):null,evidenceHash:f.evidenceHash??null};});}
async function reconciliationHash(db:PgDatabase,event:VatPostEventInput):Promise<string|null>{const r=event.reconciliation;if(!r)return null;return String(rowsToObjects(await db.exec('SELECT vat_post_reconciliation_hash($1,$2,$3) AS value',[r.target.kind,r.target.id,r.throughDate]))[0].value);}
async function evaluate(db:PgDatabase,n:VatPostPreviewInput,records:VatPostEventRecord[],targets:VatPostTarget[],eventId:string,evidenceHash:string,storedReconciliationHash?:string|null){
 const event=n.event,issues:VatPostIssue[]=[],blocking:VatPostIssue[]=[];
 const add=(code:string,message:string,ref?:VatPostTargetRef,block=true)=>{const issue={code,message,...ref?{target:ref}:{}};issues.push(issue);if(block)blocking.push(issue);};
 const find=(ref:VatPostTargetRef)=>{const t=targets.find(t=>sameTarget(t,ref));if(!t)throw fail('같은 주체의 봉인 고지 또는 내부 확정 대상을 찾을 수 없습니다.',404);return t;};
 if(event.state==='withdrawn')return {issues,canReview:true,matchStatus:'withdrawn' as const};
 if(['receipt','payment'].includes(event.kind)&&!event.officialKey)add('official_key_missing','원문의 공식 접수·납부 식별자를 확인하세요.');
 let referenceOnly=false;
 if(event.sharedB1FactId){
  referenceOnly=true;const row=rowsToObjects(await db.exec('SELECT f.subject_id,f.kind,f.external_key,r.state,r.payload_json FROM vat_filing_facts f JOIN vat_filing_fact_revisions r ON r.fact_id=f.fact_id WHERE f.fact_id=$1 ORDER BY r.version DESC LIMIT 1',[event.sharedB1FactId]))[0];
  const f=row?parse(row.payload_json):null;
  if(!row||row.subject_id!==n.subjectId||row.kind!==(event.kind==='receipt'?'filing':event.kind)||row.state!=='verified'||key(row.kind==='filing'?f.data.receiptNumber:String(row.external_key))!==event.officialKey)add('shared_document_mismatch','같은 주체·종류·공식번호의 유효 B1 문서만 명시적으로 재참조할 수 있습니다.');
  else {
   if(typeof f.evidenceRef!=='string'||!f.evidenceRef.startsWith('vat-document:'))add('shared_document_legacy','기존 선언형 문서는 실물 동일성을 자동 확인할 수 없습니다.');
   else {const original=await requireVatFilingDocument(f.evidenceRef.slice(13),n.subjectId,db);if(original.evidenceHash!==f.evidenceHash||original.evidenceHash!==evidenceHash)add('shared_document_hash','기존 B1 서버 원문과 이번 문서가 일치하지 않습니다.');}
   if(event.kind==='payment'&&(event.payment!.actualTotal!==f.amount||event.payment!.allocations.length))add('shared_payment_reference_only','기존 납부는 같은 금액의 참고 기록만 허용하며 새 원금 배부로 합산하지 않습니다.');
   if(event.kind==='receipt'){const t=find(event.receipt!.target);if(t.year!==f.year||t.term!==f.term||t.dateFrom!==f.from||t.dateTo!==f.to||f.amount!==null&&event.receipt!.declaredTax!==f.amount)add('shared_receipt_target','기존 접수의 기간·금액과 내부 확정 대상이 다릅니다.');}
  }
 }
 let matchStatus:VatPostEventRecord['matchStatus']='matched';
 if(event.kind==='receipt'){
  const d=event.receipt!,t=find(d.target);if(d.declaredTax===null)add('receipt_tax_unknown','실제 접수 문서의 신고 세액을 확인하세요.');
  else if(d.declaredTax!==t.targetAmount){matchStatus='mismatch';add('receipt_tax_mismatch','접수 원문 세액과 내부 확정액이 다릅니다. 기록은 보관하며 정정 검토가 필요합니다.',d.target,false);}
 }else if(event.kind==='payment'){
  const p=event.payment!,allocated=p.allocations.reduce((sum,a)=>sum+BigInt(a.amount),BigInt(0)),components=allocated+BigInt(p.additionalCharges)+BigInt(p.otherAmount)+BigInt(p.unallocatedAmount);
  if(p.actualTotal===null)add('payment_total_unknown','실제 납부 원문 총액을 확인하세요.');
  else if(!referenceOnly&&components!==BigInt(p.actualTotal))add('payment_total_mismatch','배부·확정액 밖 가산분·기타·미배부 합계가 실제 총액과 다릅니다.');
  for(const a of p.allocations){const t=find(a.target),prior=paidAfter(records,t,undefined,eventId);if(t.baselinePaid===null)add('baseline_unknown','봉인 전 납부액을 확인할 수 없어 배부 한도 검토를 보류합니다.',t);else if(BigInt(t.baselinePaid)+prior+BigInt(a.amount)>BigInt(t.allocatableAmount))add('allocation_exceeds_target','봉인 전 납부와 이번 유효 배부가 대상 금액을 넘습니다. 초과분은 미배부로 보관하세요.',t);}
  if(referenceOnly&&components!==BigInt(0))add('reference_allocation','같은 B1 문서는 참고만 남깁니다. 배부·가산·기타·미배부 현금을 새로 입력하지 마세요.');
  if(!referenceOnly&&p.unallocatedAmount>0){matchStatus='mismatch';add('unallocated_cash','실제 납부 중 미배부 금액이 남아 있습니다.',undefined,false);}
 }else if(event.kind==='reconciliation'){
  const r=event.reconciliation!;find(r.target);const t=await targetAt(db,r.target,r.throughDate),post=paidAfter(records,r.target,r.throughDate);
  if(t.baseline===null)add('baseline_unknown','봉인 전 금액불명 내역이 있어 조회 대사를 완료할 수 없습니다.',r.target);
  else if(r.observedPaidTotal===null||BigInt(r.observedPaidTotal)!==BigInt(t.baseline)+post){matchStatus='mismatch';add('reconciliation_mismatch','조회 기준일의 확인 금액과 알려진 선납·사후 배부 합계가 다릅니다.',r.target);}
  if(storedReconciliationHash!==undefined&&event.state==='verified'&&storedReconciliationHash!==await reconciliationHash(db,event)){matchStatus='mismatch';add('reconciliation_sources_changed','조회 확인 이후 기준일 이전 납부 구성·판이 변경되었습니다. 합계가 같아도 다시 대조하세요.',r.target);}
 }else {if(event.other!.target)find(event.other!.target);matchStatus='unsupported';add('other_record_only','충당·환급·기타 원문은 보관하며 세액·납부 잔액에 자동 반영하지 않습니다.',undefined,false);}
 if(blocking.length)matchStatus='unreviewed';return {issues,canReview:!blocking.length,matchStatus};
}
export async function getVatFilingPostOverview(subjectId?:string):Promise<VatPostOverview>{return transaction(async db=>{
 const subjects=rowsToObjects(await db.exec("SELECT s.subject_id,r.payload_json->>'corpNum' AS corp_num FROM vat_filing_subjects s LEFT JOIN LATERAL (SELECT payload_json FROM vat_filing_subject_revisions WHERE subject_id=s.subject_id ORDER BY version DESC LIMIT 1) r ON true ORDER BY s.subject_id")).map(r=>({subjectId:String(r.subject_id),corpNum:r.corp_num==null?null:String(r.corp_num)}));
 if(!subjectId)return {subjects,subjectId:null,targets:[],events:[],referenceCandidates:[],issues:[]};id(subjectId,'주체');if(!subjects.some(s=>s.subjectId===subjectId))throw fail('신고 주체를 찾을 수 없습니다.',404);
 const records=await loadEvents(db,subjectId),targets=enrichTargets(await loadTargets(db,subjectId),records);
 for(const record of records){const evaluated=await evaluate(db,{requestId:'overview',subjectId,expectedVersion:record.version,event:record.event,eventId:record.eventId},records,targets,record.eventId,record.evidenceHash,record.reconciliationHash);record.issues=evaluated.issues;record.matchStatus=record.event.state==='recorded'?'unreviewed':evaluated.matchStatus;}
 return {subjects,subjectId,targets,events:records,referenceCandidates:await references(db,subjectId),issues:targets.filter(t=>t.baselinePaid===null).map(t=>({code:'baseline_unknown',message:'봉인 당시 납부 금액에 미확인 내역이 있습니다.',target:{kind:t.kind,id:t.id}}))};
});}
async function preview(db:PgDatabase,input:VatPostPreviewInput):Promise<VatPostPreview>{
 const n=normalize(input),eventId=n.eventId??generated('vpe',n.requestId),revisionId=generated('vpr',n.requestId),version=n.expectedVersion+1;
 if(!rowsToObjects(await db.exec('SELECT subject_id FROM vat_filing_subjects WHERE subject_id=$1',[n.subjectId])).length)throw fail('신고 주체를 먼저 등록하세요.',404);
 const root=rowsToObjects(await db.exec('SELECT * FROM vat_filing_post_events WHERE event_id=$1',[eventId]))[0];
 if(root&&(root.subject_id!==n.subjectId||root.kind!==n.event.kind||(root.shared_b1_fact_id??null)!==(n.event.sharedB1FactId??null)))throw fail('기존 사건의 주체·종류·동일 문서 연결은 바꿀 수 없습니다.');
 const records=await loadEvents(db,n.subjectId),old=heads(records).find(r=>r.eventId===eventId);
 if((old?.version??0)!==n.expectedVersion||!old&&n.event.state==='withdrawn'||old?.event.state==='verified'&&n.event.state==='recorded')throw fail('유효 말단 판이나 상태가 다릅니다. 검토한 전체 대체판 또는 명시 철회를 사용하세요.');
 const document=await requireVatFilingDocument(n.event.evidenceDocumentId,n.subjectId,db),targets=enrichTargets(await loadTargets(db,n.subjectId),records);
 const evaluated=await evaluate(db,n,records,targets,eventId,document.evidenceHash);
 if(n.event.officialKey){const owners=rowsToObjects(await db.exec('SELECT b.fact_id,b.event_id FROM vat_filing_post_identities i JOIN vat_filing_post_bindings b ON b.identity_id=i.identity_id WHERE i.subject_id=$1 AND i.document_kind=$2 AND i.document_key=$3',[n.subjectId,n.event.kind==='receipt'?'filing':n.event.kind,n.event.officialKey]));if(owners.some(o=>o.event_id&&o.event_id!==eventId||o.fact_id&&o.fact_id!==n.event.sharedB1FactId))throw fail('같은 공식 문서가 다른 사실/사건에 이미 등록되어 있습니다. 명시적인 동일 문서 참조를 확인하세요.');}
 return {previewHash:hash({n,eventId,version,evidenceHash:document.evidenceHash,heads:heads(records).map(r=>({eventId:r.eventId,version:r.version,payloadHash:hash(r.event)})),targets}),normalized:n,eventId,revisionId,version,evidenceHash:document.evidenceHash,reconciliationHash:await reconciliationHash(db,n.event),referenceOnly:!!n.event.sharedB1FactId,...evaluated,targets};
}
export async function previewVatFilingPostEvent(input:VatPostPreviewInput):Promise<VatPostPreview>{return transaction(db=>preview(db,input));}
export async function saveVatFilingPostEvent(input:VatPostSaveInput,actor:string):Promise<VatPostSaveResult>{
 const n=normalize(input);id(actor,'담당자');if(!/^[0-9a-f]{64}$/.test(input.expectedPreviewHash??''))throw fail('최신 미리보기를 먼저 확인하세요.',400);if(n.event.state!=='recorded'&&input.reviewConfirmed!==true)throw fail('증빙과 대상 대사를 명시적으로 검토하세요.',400);
 const payloadHash=hash({n,expectedPreviewHash:input.expectedPreviewHash,reviewConfirmed:input.reviewConfirmed===true});
 return transaction(async db=>{
  const prior=rowsToObjects(await db.exec('SELECT * FROM vat_filing_post_requests WHERE request_id=$1',[n.requestId]))[0];if(prior){if(prior.actor_user_id!==actor||prior.payload_hash!==payloadHash||prior.action!=='save')throw fail('같은 요청에 다른 담당자 또는 내용이 있습니다.');return {...parse(prior.result_json),replayed:true};}
  const p=await preview(db,n);if(p.previewHash!==input.expectedPreviewHash)throw fail('미리보기 이후 문서·대상·납부 내역이 변경되었습니다. 다시 확인하세요.',409,'vat_post_preview_changed');if(n.event.state!=='recorded'&&!p.canReview)throw Object.assign(fail('원문과 대상 배부의 검토가 끝나지 않았습니다.',409,'vat_post_review_incomplete'),{issues:p.issues});
  await db.run('INSERT INTO vat_filing_post_events(event_id,subject_id,kind,shared_b1_fact_id) VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING',[p.eventId,n.subjectId,n.event.kind,n.event.sharedB1FactId??null]);
  let identityId:string|null=null;
  if(n.event.officialKey){identityId=generated('vpi',`${n.subjectId}\u001f${n.event.kind==='receipt'?'filing':n.event.kind}\u001f${n.event.officialKey}`);await db.run('INSERT INTO vat_filing_post_identities(identity_id,subject_id,document_kind,document_key) VALUES($1,$2,$3,$4) ON CONFLICT(subject_id,document_kind,document_key) DO NOTHING',[identityId,n.subjectId,n.event.kind==='receipt'?'filing':n.event.kind,n.event.officialKey]);identityId=String(rowsToObjects(await db.exec('SELECT identity_id FROM vat_filing_post_identities WHERE subject_id=$1 AND document_kind=$2 AND document_key=$3',[n.subjectId,n.event.kind==='receipt'?'filing':n.event.kind,n.event.officialKey]))[0].identity_id);await db.run('INSERT INTO vat_filing_post_bindings(binding_id,identity_id,event_id) VALUES($1,$2,$3) ON CONFLICT(identity_id,event_id) DO NOTHING',[generated('vpb',`${identityId}:${p.eventId}`),identityId,p.eventId]);}
  const previous=n.expectedVersion?rowsToObjects(await db.exec('SELECT revision_id FROM vat_filing_post_revisions WHERE event_id=$1 AND version=$2',[p.eventId,n.expectedVersion]))[0]:null;
  const headerTarget=n.event.receipt?.target??n.event.reconciliation?.target??n.event.other?.target;
  await db.run('INSERT INTO vat_filing_post_revisions(revision_id,event_id,version,previous_revision_id,state,identity_id,document_id,document_hash,occurred_on,payload_json,payload_hash,actor_user_id,reviewed_by,request_id,notice_consumption_id,return_confirmation_id,reconciliation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)',[p.revisionId,p.eventId,p.version,previous?.revision_id??null,n.event.state,identityId,n.event.evidenceDocumentId,p.evidenceHash,n.event.occurredAt,JSON.stringify(n.event),hash(n.event),actor,n.event.state==='recorded'?null:actor,n.requestId,headerTarget?.kind==='notice'?headerTarget.id:null,headerTarget?.kind==='return'?headerTarget.id:null,p.reconciliationHash??null]);
  for(const [index,a] of (n.event.payment?.allocations??[]).entries())await db.run('INSERT INTO vat_filing_post_allocations(revision_id,line_no,notice_consumption_id,return_confirmation_id,amount) VALUES($1,$2,$3,$4,$5)',[p.revisionId,index,a.target.kind==='notice'?a.target.id:null,a.target.kind==='return'?a.target.id:null,a.amount]);
  const result:VatPostSaveResult={eventId:p.eventId,revisionId:p.revisionId,version:p.version,state:n.event.state,referenceOnly:p.referenceOnly,replayed:false};
  await db.run("INSERT INTO vat_filing_post_requests(request_id,action,actor_user_id,payload_hash,result_json) VALUES($1,'save',$2,$3,$4::jsonb)",[n.requestId,actor,payloadHash,JSON.stringify(result)]);
  await recordAuditLogInline(db,{actorUserId:actor,action:'finance_vat_filing_basis',targetTable:'vat_filing_post_revisions',targetId:p.revisionId,after:{action:'post_event',...result,requestId:n.requestId,payloadHash}});
  return result;
 });
}
