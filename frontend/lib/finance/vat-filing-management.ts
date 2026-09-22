import {createHash} from 'node:crypto';
import {rowsToObjects, type PgDatabase} from '@/lib/db';
import {currentVatFilingSubject, vatFilingSubjectFacts, withVatFilingBasisTransaction, getVatFilingScope, readVatFilingArchive, saveVatFilingSubjectRevision, saveVatFilingFactRevision, sealVatFilingBasis, type VatFilingScopeQuery} from './vat-filing-basis';
import {resolveVatFilingScope, validateFact, validateSubject, type FactRevision, type SourceCoverage, type VatFilingScopeResult} from './vat-filing-scope';
import {requireVatFilingDocument} from './vat-filing-documents';
import {vatReturnCollectorCorpNum} from './vat-return-basis';
import {buildVatLedger} from './vat-return';
import {loadCardTaxRows} from './card-tax';
import {resolveVatCardRows} from '../barobill/vat';
import {loadTransactionLinkState} from './transaction-links';
import {prepareVatReturnBasisSources} from './vat-return-sources';

const fail=(message:string,status=400,code='vat_filing_management_input')=>Object.assign(new Error(message),{status,code});
const parse=(v:any)=>typeof v==='string'?JSON.parse(v):v;
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const id=(v:unknown,label:string):string=>{if(typeof v!=='string'||v.trim()!==v||!v||v.length>200)throw fail(`${label}가 필요합니다.`);return v;};
const object=(v:unknown,label:string):Record<string,any>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail(`${label} 형식이 올바르지 않습니다.`);return v as Record<string,any>;};
const keys=(v:Record<string,any>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))throw fail('지원하지 않는 입력 필드가 있습니다.');};
const version=(v:unknown):number=>{if(!Number.isInteger(v)||Number(v)<0||Number(v)>=2147483647)throw fail('확인한 판번호가 필요합니다.');return Number(v);};
const generated=(kind:string,requestId:string)=>`vfm-${kind}-${hash(requestId).slice(0,40)}`;
function review(needed:boolean,confirmed:unknown){if(needed&&confirmed!==true)throw fail('원문과 입력을 대조한 뒤 검토 확인을 선택하세요.');}
export function vatFilingManagementQuery(v:Record<string,any>):VatFilingScopeQuery{
  const year=Number(v.year),term=Number(v.term),kind=v.kind??'final';
  if(!Number.isInteger(year)||year<1900||year>9999||![1,2].includes(term)||!['preliminary','final'].includes(kind))throw fail('신고 연도·기수·종류를 확인하세요.');
  return {subjectId:id(v.subjectId,'신고 주체'),year,term:term as 1|2,kind,collectionCorpNum:vatReturnCollectorCorpNum()};
}
async function documentPair(db:PgDatabase,documentId:unknown,subjectId:string){
  if(documentId===null||documentId===undefined||documentId==='')return {evidenceRef:null,evidenceHash:null};
  const d=await requireVatFilingDocument(id(documentId,'증빙'),subjectId,db);
  return {evidenceRef:d.evidenceRef,evidenceHash:d.evidenceHash};
}
async function verifyPair(db:PgDatabase,subjectId:string,ref:unknown,evidenceHash:unknown){
  if(typeof ref!=='string'||!ref.startsWith('vat-document:'))throw fail('선언형 근거는 원문 확인 완료로 바꿀 수 없습니다. 서버에 보관한 증빙으로 새 판을 검토하세요.',409,'vat_filing_document_required');
  const d=await requireVatFilingDocument(ref.slice('vat-document:'.length),subjectId,db);
  if(d.evidenceHash!==evidenceHash)throw fail('증빙 원문 지문이 입력과 일치하지 않습니다.',503,'vat_filing_document_unavailable');
}
async function verifyFactDocuments(db:PgDatabase,f:FactRevision){
  if(f.state==='recorded')return;
  await verifyPair(db,f.subjectId,f.evidenceRef,f.evidenceHash);
  const d=f.data as any;
  for(const prefix of ['priorFiling','payment','nil'])if(d[`${prefix}EvidenceRef`]!=null)await verifyPair(db,f.subjectId,d[`${prefix}EvidenceRef`],d[`${prefix}EvidenceHash`]);
}

/** 원천 선택용 실제 자료. ready scope를 가공해서 만들지 않는다. */
async function liveSources(db:PgDatabase,q:VatFilingScopeQuery){
  const from=`${q.year}-${q.term===1?'01':'07'}-01`,to=`${q.year}-${q.term===1?'06-30':'12-31'}`;
  const ledger=await buildVatLedger({from,to},db),transactionLinks=await loadTransactionLinkState(db);
  const cards=resolveVatCardRows(await loadCardTaxRows(db,{from,to}),transactionLinks);
  const sources:SourceCoverage[]=[];
  for(const row of ledger.rows.filter(r=>!r.excluded)){
    const found=transactionLinks.sources.filter(s=>row.htiId?s.kind==='hometax'&&s.id===row.htiId:s.kind==='tax_invoice'&&s.canonicalKey===`invoice:${row.ntsSendKey.trim()}`&&!s.raw.canceled_at&&Number(s.raw.nts_send_state)===4);
    if(found.length!==1)continue;const source=found[0];
    sources.push({sourceKind:source.kind,sourceId:source.id,canonicalKey:source.canonicalKey,sourceHash:source.sourceHash,direction:row.direction,supply:row.amountTotal,tax:row.taxTotal,claimedTax:row.direction==='purchase'&&row.vatDeductible===1?row.taxTotal:0,date:row.writeDate});
  }
  for(const card of cards){
    if(card.taxDate<from||card.taxDate>to||card.excluded)continue;
    const source=transactionLinks.sources.find(s=>s.kind==='card'&&s.id===String(card.card_txn_id));if(!source)continue;
    sources.push({sourceKind:'card',sourceId:source.id,canonicalKey:source.canonicalKey,sourceHash:source.sourceHash,direction:'purchase',supply:card.vatResidual.supply,tax:card.vatResidual.tax,claimedTax:card.vatState==='deductible'&&!card.vatIssues.length?card.vatResidual.tax:0,date:card.taxDate});
  }
  return {sources,ledger,transactionLinks,cards};
}
/** Validate the real catalog even when other facts keep the scope blocked. Past
 * filing review follows its period, aliases and card allocations; unrelated
 * current-period issues remain the responsibility of the B2 return calculation. */
function pastSourceReview(live:Awaited<ReturnType<typeof liveSources>>,scope:VatFilingScopeResult,periods:Array<{from:string;to:string}>,covered:SourceCoverage[]){
  const inPeriod=(date:string)=>periods.some(p=>date>=p.from&&date<=p.to);
  const refs=new Set(covered.map(s=>`${s.sourceKind}:${s.sourceId}`));
  const canonicals=new Set(covered.map(s=>s.canonicalKey));
  for(const source of live.transactionLinks.sources){
    if(['hometax','tax_invoice','card'].includes(source.kind)&&inPeriod(source.kind==='card'?source.taxDate:source.date)){
      refs.add(source.key);canonicals.add(source.canonicalKey);
    }
  }
  // Missing catalog representatives must still leave a period-scoped error.
  const issueIds=new Set<string>();
  for(const row of live.ledger.rows)if(inPeriod(row.writeDate)){
    canonicals.add(`invoice:${row.ntsSendKey.trim()}`);
    if(row.htiId)issueIds.add(row.htiId);
  }
  let changed=true;
  while(changed){
    changed=false;
    const add=(ref:string,canonical:string)=>{if(!refs.has(ref)){refs.add(ref);changed=true;}if(!canonicals.has(canonical)){canonicals.add(canonical);changed=true;}};
    for(const source of live.transactionLinks.sources)if(refs.has(source.key)||canonicals.has(source.canonicalKey))add(source.key,source.canonicalKey);
    for(const link of live.transactionLinks.links)if(link.state==='active'&&link.relation==='card_invoice'&&[link.leftSnapshot,link.rightSnapshot].some(s=>refs.has(s.key)||canonicals.has(s.canonicalKey))){
      add(`${link.left.kind}:${link.left.id}`,link.leftSnapshot.canonicalKey);
      add(`${link.right.kind}:${link.right.id}`,link.rightSnapshot.canonicalKey);
    }
  }
  for(const ref of refs){issueIds.add(ref);issueIds.add(ref.slice(ref.indexOf(':')+1));}
  for(const canonical of canonicals)issueIds.add(canonical);
  const prepared=prepareVatReturnBasisSources({scope,ledger:live.ledger,cards:live.cards,transactionLinks:live.transactionLinks});
  const issues=prepared.issues.filter(i=>issueIds.has(i.sourceId));
  const sourceStateHash=hash({
    sources:live.sources.filter(s=>refs.has(`${s.sourceKind}:${s.sourceId}`)||canonicals.has(s.canonicalKey)),
    catalog:live.transactionLinks.sources.filter(s=>refs.has(s.key)).map(s=>({key:s.key,canonicalKey:s.canonicalKey,sourceHash:s.sourceHash})),
    links:live.transactionLinks.links.filter(l=>l.state==='active'&&l.relation==='card_invoice'&&(refs.has(`${l.left.kind}:${l.left.id}`)||refs.has(`${l.right.kind}:${l.right.id}`))),
    manifest:prepared.manifest.filter(s=>refs.has(`${s.kind}:${s.id}`)||canonicals.has(s.canonicalKey)),issues,
  });
  return {issues,sourceStateHash};
}
export async function listVatFilingSourceCandidates(input:Record<string,any>){
  const q=vatFilingManagementQuery(input);
  return withVatFilingBasisTransaction(async db=>{await currentVatFilingSubject(db,q.subjectId);const result=await liveSources(db,q);return {sources:result.sources,issues:result.ledger.blockingIssues};});
}
export async function getVatFilingManagementOverview(input:Record<string,any>){return withVatFilingBasisTransaction(async db=>{
  const subjects=rowsToObjects(await db.exec('SELECT DISTINCT ON(subject_id) payload_json FROM vat_filing_subject_revisions ORDER BY subject_id,version DESC')).map(r=>validateSubject(parse(r.payload_json)));
  if(!input.subjectId)return {subjects,subject:null,applicableSubject:null,subjectRevisions:[],facts:[],archives:[],scope:null,scopeError:null};
  const q=vatFilingManagementQuery(input),subject=await currentVatFilingSubject(db,q.subjectId),allFacts=await vatFilingSubjectFacts(db,q.subjectId);
  const consumed=new Set(rowsToObjects(await db.exec('SELECT fact_id FROM vat_filing_basis_consumptions WHERE subject_id=$1',[q.subjectId])).map(r=>r.fact_id));
  const latest=new Map<string,FactRevision>();for(const fact of allFacts)latest.set(fact.factId,fact);
  const subjectRevisions=rowsToObjects(await db.exec('SELECT payload_json FROM vat_filing_subject_revisions WHERE subject_id=$1 ORDER BY version DESC',[q.subjectId])).map(r=>validateSubject(parse(r.payload_json)));
  const archives=rowsToObjects(await db.exec('SELECT snapshot_id,scope_hash,period_year,period_term,period_kind FROM vat_filing_basis_snapshots WHERE subject_id=$1 ORDER BY period_year DESC,period_term DESC,period_kind',[q.subjectId])).map(r=>({snapshotId:r.snapshot_id,scopeHash:r.scope_hash,year:Number(r.period_year),term:Number(r.period_term),kind:r.period_kind}));
  const scope=await getVatFilingScope(q,db);
  return {subjects,subject,applicableSubject:scope.evidenceSnapshot.subject,subjectRevisions,facts:[...latest.values()].map(fact=>({fact,consumed:consumed.has(fact.factId)})),archives,scope,scopeError:null};
});}
export async function getManagedVatFilingArchive(snapshotId:string){return {archive:await readVatFilingArchive({origin:'basis',id:snapshotId})};}

export async function saveManagedVatFilingSubject(input:Record<string,any>,actor:string){
  keys(input,['action','requestId','expectedVersion','subjectId','subject','reviewConfirmed']);
  const requestId=id(input.requestId,'요청'),expectedVersion=version(input.expectedVersion),subjectId=input.subjectId?id(input.subjectId,'주체'):generated('subject',requestId),s=object(input.subject,'주체');
  keys(s,['corpNum','state','effectiveFrom','effectiveTo','mode','entityType','vatRegime','filingUnit','evidenceDocumentId']);
  review(s.state==='verified',input.reviewConfirmed);
  const normalize=async(db:PgDatabase)=>{const {evidenceDocumentId,...fields}=s;return validateSubject({...fields,subjectId,revisionId:generated('subject-revision',requestId),version:expectedVersion+1,...await documentPair(db,evidenceDocumentId,subjectId)});};
  const subject=await withVatFilingBasisTransaction(normalize);
  return saveVatFilingSubjectRevision({requestId,expectedVersion,subject},actor,async db=>{
    if(hash(await normalize(db))!==hash(subject))throw fail('검토 이후 주체 증빙이 변경되었습니다.',409);
    if(subject.corpNum&&rowsToObjects(await db.exec("SELECT subject_id FROM vat_filing_subject_revisions WHERE subject_id<>$1 AND replace(payload_json->>'corpNum','-','')=$2 LIMIT 1",[subjectId,subject.corpNum])).length)throw fail('같은 사업자번호의 신고 주체가 이미 있습니다. 기존 주체를 선택해 판을 추가하세요.',409,'vat_filing_subject_already_exists');
  });
}

async function normalizeFact(input:Record<string,any>,db:PgDatabase){
  const requestId=id(input.requestId,'검토 요청'),expectedVersion=version(input.expectedVersion),subjectId=id(input.subjectId,'주체'),f=object(input.fact,'근거');
  keys(f,['kind','state','year','term','from','to','amount','evidenceDocumentId','periodCoverage','sourceCoverage','data']);
  const factId=input.factId?id(input.factId,'사실'):generated('fact',requestId),data={...object(f.data,'근거 항목')};
  if(Object.keys(data).some(k=>/Evidence(?:Ref|Hash)$/.test(k)||k==='supersedesRevisionId'))throw fail('증빙 지문과 이전 판은 서버에서 결정합니다.');
  for(const prefix of f.kind==='notice'?['priorFiling','payment']:f.kind==='no_notice'?['priorFiling']:f.kind==='filing'?['nil']:[]){
    const key=`${prefix}EvidenceDocumentId`,pair=await documentPair(db,data[key],subjectId);delete data[key];data[`${prefix}EvidenceRef`]=pair.evidenceRef;data[`${prefix}EvidenceHash`]=pair.evidenceHash;
  }
  const parent=expectedVersion?rowsToObjects(await db.exec('SELECT revision_id FROM vat_filing_fact_revisions WHERE fact_id=$1 AND version=$2',[factId,expectedVersion]))[0]:null;
  if(expectedVersion&&!parent)throw fail('이전 근거 판을 찾을 수 없습니다.',409);
  data.supersedesRevisionId=parent?.revision_id??null;
  const {evidenceDocumentId,...fields}=f;
  const fact=validateFact({...fields,factId,subjectId,revisionId:generated('fact-revision',requestId),version:expectedVersion+1,...await documentPair(db,evidenceDocumentId,subjectId),data});
  return {requestId,expectedVersion,fact};
}
async function factPreview(input:Record<string,any>,db:PgDatabase){
  const normalized=await normalizeFact(input,db),fact=normalized.fact;
  const from=`${fact.year}-${fact.term===1?'01':'07'}-01`,to=`${fact.year}-${fact.term===1?'06-30':'12-31'}`;
  const subject=await currentVatFilingSubject(db,fact.subjectId,{from,to}),stored=await vatFilingSubjectFacts(db,fact.subjectId);
  const facts=stored.filter(f=>f.revisionId!==fact.revisionId);facts.push(fact);
  const collectionCorpNum=vatReturnCollectorCorpNum();
  const scope=resolveVatFilingScope({subject,facts,year:fact.year,term:fact.term,kind:'final',collectionCorpNum});
  const sourceIssues:Array<{sourceId:string;reason:string}>=[];
  let sourceStateHash:string|null=null;
  if(fact.kind==='payment'&&fact.state!=='withdrawn'){
    const effective=facts.filter(f=>scope.effectiveFactRevisionIds.includes(f.revisionId));
    const target=effective.find(f=>f.factId===fact.data.targetNoticeFactId);
    const reject=(reason:string)=>sourceIssues.push({sourceId:fact.factId,reason});
    const priorTo=`${fact.year}-${fact.term===1?'03-31':'09-30'}`;
    if(!target||target.kind!=='notice'||target.state!=='verified'||target.subjectId!==fact.subjectId||target.year!==fact.year||target.term!==fact.term){
      reject('납부를 대조할 같은 주체·기수의 검토 완료된 유효 고지가 필요합니다. 미확인 내역은 기록 상태로 보관하세요.');
    }else{
      if(target.from!==from||target.to!==priorTo||fact.from!==target.from||fact.to!==target.to)reject('납부와 대상 고지의 예정기간이 정확히 일치해야 합니다.');
      if(target.data.amountSemantics!=='total_replacement'||target.amount===null||target.amount<500000||target.amount%1000!==0||scope.issues.some(i=>i.factId===target.factId))reject('대상 고지의 원금·근거 검토가 완료되지 않았습니다.');
      try{await verifyFactDocuments(db,target);}catch(error){if((error as any)?.status===409)reject('대상 고지의 원문을 서버 증빙으로 확인해야 합니다.');else throw error;}
      // Latest effective revisions only: replacing one payment never adds its old
      // amount again. Unknown/unallocated evidence may remain recorded, not verified.
      const payments=effective.filter(f=>f.kind==='payment'&&f.data.targetNoticeFactId===target.factId&&(f.state==='verified'||f.revisionId===fact.revisionId));
      if(payments.some(f=>f.amount===null)||target.amount===null)reject('검토 완료할 고지 원금 납부액을 확인하세요.');
      else if(payments.reduce((sum,f)=>sum+BigInt(f.amount!),BigInt(0))>BigInt(target.amount))reject('검토 완료된 납부와 이번 배부의 합계가 고지 원금을 넘습니다. 초과·미대사 원문은 기록 상태로 보관하세요.');
    }
  }
  if(fact.kind==='filing'&&fact.state!=='withdrawn'){
    const live=await liveSources(db,{subjectId:fact.subjectId,year:fact.year,term:fact.term,kind:'final',collectionCorpNum});
    const checked=pastSourceReview(live,scope,fact.periodCoverage,fact.sourceCoverage);
    sourceStateHash=checked.sourceStateHash;
    const inScope=live.sources.filter(s=>fact.periodCoverage.some(p=>s.date>=p.from&&s.date<=p.to));
    for(const row of fact.sourceCoverage){
      const same=inScope.filter(s=>s.sourceKind===row.sourceKind&&s.sourceId===row.sourceId);
      if(same.length!==1||['canonicalKey','sourceHash','direction','supply','tax','date'].some(k=>(same[0] as any)?.[k]!== (row as any)[k])||row.claimedTax!==0&&(Math.sign(row.claimedTax)!==Math.sign(same[0].claimedTax)||Math.abs(row.claimedTax)>Math.abs(same[0].claimedTax)))sourceIssues.push({sourceId:row.sourceId,reason:'과거 명세와 현재 원천의 식별·기간·금액·공제 검토가 일치하지 않습니다.'});
    }
    for(const row of inScope)if((row.supply!==0||row.tax!==0)&&!fact.sourceCoverage.some(s=>s.canonicalKey===row.canonicalKey))sourceIssues.push({sourceId:row.sourceId,reason:'과거 신고 기간의 원천이 명세에서 누락되었습니다.'});
    sourceIssues.push(...checked.issues);
  }
  const relevantIssues=scope.issues.filter(i=>i.factId===fact.factId&&i.code!=='fact_unverified'||['duplicate_external_fact','subject_unverified','collection_subject_mismatch','unsupported_subject'].includes(i.code));
  return {previewHash:hash({expectedVersion:normalized.expectedVersion,fact,scope,sourceStateHash}),normalizedFact:fact,scope,sourceIssues,canReview:sourceIssues.length===0&&relevantIssues.length===0};
}
export async function previewManagedVatFilingFact(input:Record<string,any>){return withVatFilingBasisTransaction(db=>factPreview(input,db));}
export async function saveManagedVatFilingFact(input:Record<string,any>,actor:string){
  keys(input,['action','requestId','expectedVersion','subjectId','factId','fact','reviewConfirmed','expectedPreviewHash']);
  const normalized=await withVatFilingBasisTransaction(db=>normalizeFact(input,db));
  review(normalized.fact.state!=='recorded',input.reviewConfirmed);
  if(!/^[a-f0-9]{64}$/.test(input.expectedPreviewHash??''))throw fail('확인한 근거 미리보기가 필요합니다.');
  return saveVatFilingFactRevision({requestId:normalized.requestId,expectedVersion:normalized.expectedVersion,fact:normalized.fact},actor,async db=>{
    const current=await factPreview(input,db);
    if(current.previewHash!==input.expectedPreviewHash)throw fail('미리보기 이후 근거·원천이 변경되었습니다. 다시 대조하세요.',409,'vat_filing_preview_changed');
    if(normalized.fact.state!=='recorded'&&!current.canReview)throw Object.assign(fail('근거와 원천의 대사가 완료되지 않았습니다.',409,'vat_filing_review_incomplete'),{issues:current.sourceIssues});
    await verifyFactDocuments(db,normalized.fact);
  });
}
export async function sealManagedVatFilingBasis(input:Record<string,any>,actor:string){
  keys(input,['action','requestId','subjectId','year','term','kind','expectedScopeHash','reviewConfirmed']);review(true,input.reviewConfirmed);
  const q=vatFilingManagementQuery(input);
  return sealVatFilingBasis({...q,requestId:id(input.requestId,'요청'),expectedScopeHash:input.expectedScopeHash},actor,async db=>{
    const scope=await getVatFilingScope(q,db);await verifyPair(db,q.subjectId,scope.evidenceSnapshot.subject.evidenceRef,scope.evidenceSnapshot.subject.evidenceHash);
    for(const fact of scope.evidenceSnapshot.facts.filter(f=>scope.effectiveFactRevisionIds.includes(f.revisionId)))await verifyFactDocuments(db,fact);
    if(scope.excludedSources.length||scope.priorPeriodCoverage.length){
      const live=await liveSources(db,q),result=pastSourceReview(live,scope,scope.priorPeriodCoverage,scope.excludedSources);
      if(result.issues.length)throw Object.assign(fail('봉인 전에 과거 신고 명세와 현재 원천을 대조해야 합니다.',409,'vat_filing_review_incomplete'),{issues:result.issues});
    }
  });
}
