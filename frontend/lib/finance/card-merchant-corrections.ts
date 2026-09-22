import { randomUUID } from "node:crypto";
import { withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { lockAccountingWrite, validateAccountingRange } from "./write-lock";
import { applyCardMerchantCorrections, cardMerchantOriginalBasis, cardMerchantOriginalHash, merchantIdentity, merchantHash } from "./card-merchant-source";
import { normalizeVatParty } from "./vat-duplicate-review";
import { listVatFilingProtections, vatFilingProtectionOverlaps, vatFilingProtectionReferences, type VatFilingProtectionOrigin } from "./vat-filing-protection";

const fail = (message: string, status = 409) => Object.assign(new Error(message), {status});
const validId = (id: unknown): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 200;
const dateOf = (value: unknown) => String(value ?? "").slice(0,10);
const validDate = (value: string) => { try { validateAccountingRange(value,value); return true; } catch { return false; } };
const half = (date: string) => `${date.slice(0,4)}-${Number(date.slice(5,7)) <= 6 ? 1 : 2}`;
const json = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
const schemaFailure = (error: unknown): never => {
  const cause = error as {code?: string; message?: string};
  if (["42P01","42703"].includes(String(cause?.code))) {
    const missing = cause.message?.match(/(?:relation|column) "([A-Za-z_][A-Za-z0-9_.]*)"/)?.[1] ?? "관련 테이블·열";
    throw Object.assign(fail(`카드 정정 대사 자료구조가 준비되지 않았습니다: ${missing}. 225~228 및 관련 회계 마이그레이션 적용 상태를 확인하세요.`,503), {code:"card_merchant_schema_missing"});
  }
  throw error;
};

export interface MerchantCorrectionInput {
  action: "correct" | "withdraw"; cardTxnId: string; corpNum?: string; reason: string; evidence: string;
  reviewConfirmed: boolean; expectedVersion: number; expectedSourceHash: string; requestId: string;
}
export interface MerchantCorrectionImpact {
  canApply: boolean; blockers: Array<{code:string;message:string;sourceId?:string}>; affectedCardIds:string[];
  journalEntries:Array<{entryId:string;sourceKind:string;sourceId:string;date:string;status:string}>;
  vatReturns:Array<{returnId:string;from:string;to:string;status:string;origin?:VatFilingProtectionOrigin;subjectId?:string}>;
  closedYears:number[]; reviewRequiredIds:string[];
}

async function readCorrection(db: PgDatabase, cardTxnId: string) {
  const raw = rowsToObjects(await db.exec("SELECT * FROM card_transactions WHERE card_txn_id=$1",[cardTxnId]))[0];
  if (!raw) throw fail("카드 거래를 찾을 수 없습니다.",404);
  const current = (await applyCardMerchantCorrections(db,[raw]))[0], identity = merchantIdentity(current);
  const history = rowsToObjects(await db.exec("SELECT * FROM card_merchant_corrections WHERE card_txn_id=$1 ORDER BY version DESC",[cardTxnId]));
  return {raw,current,history,identity};
}

async function correctionImpact(db: PgDatabase, cardTxnId: string): Promise<MerchantCorrectionImpact> {
  const cards = rowsToObjects(await db.exec(`SELECT t.card_txn_id,t.card_id,t.approval_type,t.approval_num,t.approved_at,t.amount_total,t.doc_id,
    r.card_txn_id AS reviewed_card_id,r.tax_date,r.original_card_txn_id FROM card_transactions t LEFT JOIN card_tax_reviews r USING(card_txn_id)`));
  const target = cards.find(row => row.card_txn_id === cardTxnId)!;
  const affected = new Set([cardTxnId]);
  // 번호가 바뀌면 중복 후보·취소 검토도 바뀐다. 동일 승인 후보와 환불 참조를 함께 보호한다.
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of cards) {
      if (affected.has(String(card.card_txn_id))) {
        if (card.original_card_txn_id && !affected.has(String(card.original_card_txn_id))) {affected.add(String(card.original_card_txn_id));changed=true;}
        continue;
      }
      if ((card.original_card_txn_id && affected.has(String(card.original_card_txn_id)))
        || (target.approval_num && card.card_id === target.card_id && card.approval_num === target.approval_num
          && ((card.approved_at === target.approved_at && Math.abs(Number(card.amount_total)) === Math.abs(Number(target.amount_total)))
            || [card.approval_type,target.approval_type].some(type=>["취소","부분취소","환불"].includes(String(type)))))) {
        affected.add(String(card.card_txn_id)); changed=true;
      }
    }
  }
  const selected = cards.filter(card => affected.has(String(card.card_txn_id)));
  const impact: MerchantCorrectionImpact = {canApply:false,blockers:[],affectedCardIds:[...affected].sort(),journalEntries:[],vatReturns:[],closedYears:[],reviewRequiredIds:selected.filter(row=>row.reviewed_card_id).map(row=>String(row.card_txn_id)).sort()};
  const add = (code:string,message:string,sourceId?:string) => { if(!impact.blockers.some(b=>b.code===code&&b.sourceId===sourceId))impact.blockers.push({code,message,...(sourceId?{sourceId}:{})}); };
  const dates = new Set(selected.flatMap(card => [dateOf(card.approved_at),dateOf(card.tax_date)].filter(Boolean)));
  for (const card of selected) if (!validDate(dateOf(card.approved_at))) add("invalid_date","카드 승인일이 없거나 올바르지 않아 정정을 보류합니다.",String(card.card_txn_id));
  for (const date of dates) if (!validDate(date)) add("invalid_date","영향받는 원천의 일자를 확인할 수 없어 정정을 보류합니다.");
  for (const card of selected) if (card.doc_id) add("document_consumed","경비 문서에 사용된 거래입니다. 문서·정산의 정정 절차를 먼저 확인하세요.",String(card.card_txn_id));
  const links = rowsToObjects(await db.exec("SELECT * FROM transaction_links WHERE left_kind='card' AND left_id=ANY($1::text[])",[[...affected]]));
  const recognitions = new Set(rowsToObjects(await db.exec("SELECT canonical_invoice_key FROM transaction_invoice_recognitions WHERE canonical_invoice_key=ANY($1::text[])",[links.map(link=>String(link.canonical_invoice_key))])).map(row=>String(row.canonical_invoice_key)));
  for (const link of links) {
    if (link.state === "active") add("active_transaction_link","계산서 배부·별개 공급 검토에 사용 중입니다. 연결과 인식을 먼저 대사해야 하므로 정정을 저장하지 않습니다.",String(link.link_id));
    if (link.state === "cancelled" && link.relation === "card_invoice" && recognitions.has(String(link.canonical_invoice_key))) add("retained_recognition","취소된 배부의 매입 인식이 남아 있습니다. 인식 복구 절차를 먼저 완료하세요.",String(link.link_id));
    for (const side of ["left_snapshot","right_snapshot"]) {const snapshot=json(link[side]);for(const date of [snapshot?.date,snapshot?.taxDate].filter(Boolean)) dates.add(dateOf(date));}
  }
  const entries=rowsToObjects(await db.exec(`SELECT e.*,s.source_json FROM journal_entries e LEFT JOIN journal_source_snapshots s USING(entry_id)
    WHERE (e.source_kind='card' AND e.source_id=ANY($1::text[])) OR EXISTS(
      SELECT 1 FROM transaction_links l WHERE l.left_kind='card' AND l.left_id=ANY($1::text[])
      AND ((e.source_kind=l.right_snapshot->>'journalKind' AND e.source_id=l.right_snapshot->>'journalId')
        OR (e.source_kind='hometax_invoice' AND l.right_kind='hometax' AND e.source_id=l.right_id)))`,[[...affected]]));
  for(const entry of entries) {
    impact.journalEntries.push({entryId:String(entry.entry_id),sourceKind:String(entry.source_kind),sourceId:String(entry.source_id),date:String(entry.entry_date),status:String(entry.status)});
    dates.add(dateOf(entry.entry_date));
    const snapshot=json(entry.source_json);
    if(snapshot?.entryDate) dates.add(dateOf(snapshot.entryDate));
    if (["confirmed","excluded"].includes(String(entry.status))) add("protected_journal","확정·제외 전표가 연결되어 있습니다. 기존 전표를 보존하며 정정을 보류합니다.",String(entry.entry_id));
  }
  for(const date of dates) if(!validDate(date))add("invalid_date","관련 전표·연결의 영향 일자를 확인할 수 없어 정정을 보류합니다.");
  for(const row of rowsToObjects(await db.exec("SELECT fiscal_year FROM fiscal_closings WHERE status='closed'"))) {
    const year=Number(row.fiscal_year);
    if([...dates].some(date=>validDate(date)&&Number(date.slice(0,4))===year)) {impact.closedYears.push(year);add("closed_year",`${year}년 마감 자료에 영향을 주므로 정정을 보류합니다.`,String(year));}
  }
  const affectedHalves=new Set([...dates].filter(validDate).map(half));
  for(const row of await listVatFilingProtections(db,{includeLegacyDrafts:true})) {
    const claimed=vatFilingProtectionReferences(row,[...affected].map(id=>({kind:'card',id})));
    // B1 adds verified external receipts and sealed bases; it does not release the A half-year guard.
    const sameHalf=[...affectedHalves].some(key=>{const [year,term]=key.split('-');return vatFilingProtectionOverlaps(row,`${year}-${term==='1'?'01-01':'07-01'}`,`${year}-${term==='1'?'06-30':'12-31'}`);});
    if(claimed||sameHalf) {
      impact.vatReturns.push({returnId:row.id,from:row.from,to:row.to,status:row.status,...(row.origin==='legacy_return'?{}:{origin:row.origin,subjectId:row.subjectId})});
      if(row.status==='confirmed')add("confirmed_vat",row.origin==='legacy_return'
        ?"관련 반기 또는 원천을 참조한 신고서가 확정됐습니다. 과거 신고를 보존하는 후행 정정 절차가 필요합니다."
        :"관련 반기 또는 원천에 확인된 외부 신고 접수·봉인된 신고 근거가 있습니다. 과거 근거를 보존하는 후행 정정 절차가 필요합니다.",row.id);
    }
  }
  impact.journalEntries.sort((a,b)=>a.entryId.localeCompare(b.entryId));impact.closedYears.sort();
  impact.canApply=impact.blockers.length===0;
  return impact;
}

export async function getCardMerchantCorrection(cardTxnId: string, transaction?: PgDatabase): Promise<any> {
  try {
  if(!validId(cardTxnId))throw fail("카드 거래 식별자가 올바르지 않습니다.",400);
  if(!transaction)return withDbWrite(db=>getCardMerchantCorrection(cardTxnId,db),{accountingSnapshot:true});
  await lockAccountingWrite(transaction);
  const {raw,current,history,identity}=await readCorrection(transaction,cardTxnId);
  return {cardTxnId,originalCorpNum:raw.store_corp_num??null,effectiveCorpNum:current.store_corp_num??null,version:identity?.version??0,
    sourceHash:cardMerchantOriginalHash(raw),active:identity?.action==='correct',merchantStatus:identity?.status??'original',
    history:history.map(row=>({eventId:String(row.event_id),version:Number(row.version),action:String(row.action),corpNum:row.corp_num??null,reason:String(row.reason),evidence:String(row.evidence),actorUserId:String(row.actor_user_id),createdAt:String(row.created_at)})),
    impact:await correctionImpact(transaction,cardTxnId)};
  } catch(error) {return schemaFailure(error);}
}

export async function changeCardMerchantCorrection(input: MerchantCorrectionInput, actorUserId: string) {
  if(!input||!validId(input.cardTxnId)||!validId(input.requestId)||!validId(actorUserId)||!["correct","withdraw"].includes(input.action))throw fail("정정 요청 형식이 올바르지 않습니다.",400);
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||!/^[0-9a-f]{64}$/.test(input.expectedSourceHash))throw fail("최신 원천과 정정 이력을 조회한 뒤 진행하세요.",400);
  if(input.reviewConfirmed!==true||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>2000||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.trim().length>1000)throw fail("정정 사유와 증빙 참조를 입력하고 실제 사업자 확인을 완료하세요.",400);
  let corpNum:string|null=null;
  if(input.action==='correct') {
    if(typeof input.corpNum!=='string'||! /^(?:\d{10}|\d{3}-\d{2}-\d{5})$/.test(input.corpNum.trim()))throw fail("사업자번호는 숫자 10자리 또는 000-00-00000 형식으로 입력하세요.",400);
    corpNum=input.corpNum.replaceAll('-','').trim();if(corpNum==='0000000000')throw fail("증빙에서 확인한 사업자번호를 입력하세요.",400);
  }
  const payloadHash=merchantHash([input.action,input.cardTxnId,corpNum,input.reason.trim(),input.evidence.trim(),input.expectedVersion,input.expectedSourceHash,actorUserId]);
  return withDbWrite(async db=>{
    await lockAccountingWrite(db);
    const before=await getCardMerchantCorrection(input.cardTxnId,db);
    const existing=rowsToObjects(await db.exec("SELECT payload_hash,version FROM card_merchant_corrections WHERE request_id=$1",[input.requestId]))[0];
    if(existing){if(existing.payload_hash!==payloadHash)throw fail("같은 요청 식별자로 다른 정정을 저장할 수 없습니다.");return{status:'already_applied',version:Number(existing.version)};}
    if(before.version!==input.expectedVersion||before.sourceHash!==input.expectedSourceHash)throw fail("조회 후 원천 또는 정정 이력이 바뀌었습니다. 다시 조회해 검토하세요.");
    if(!before.impact.canApply)throw Object.assign(fail(before.impact.blockers.map((item:any)=>item.message).join(' ')),{impact:before.impact});
    if(input.action==='withdraw'&&!before.active)throw fail("현재 적용 중인 정정이 없습니다.",400);
    if(input.action==='correct'&&normalizeVatParty(before.effectiveCorpNum)===corpNum&&before.merchantStatus!=='review_required')throw fail("현재 유효 번호와 같습니다. 변경할 번호를 확인하세요.",400);
    const raw=rowsToObjects(await db.exec("SELECT * FROM card_transactions WHERE card_txn_id=$1 FOR UPDATE",[input.cardTxnId]))[0];
    if(cardMerchantOriginalHash(raw)!==input.expectedSourceHash)throw fail("수집 원천이 바뀌었습니다. 정정 전에 다시 확인하세요.");
    const version=before.version+1,eventId=`cmc-${randomUUID()}`,now=new Date(Date.now()+9*3600*1000).toISOString().slice(0,19).replace('T',' ');
    await db.run(`INSERT INTO card_merchant_corrections(event_id,card_txn_id,version,action,corp_num,original_corp_num,original_source_hash,original_basis,reason,evidence,actor_user_id,reviewed_by,created_at,request_id,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$11,$12,$13,$14)`,[eventId,input.cardTxnId,version,input.action,corpNum,raw.store_corp_num??null,input.expectedSourceHash,JSON.stringify(cardMerchantOriginalBasis(raw)),input.reason.trim(),input.evidence.trim(),actorUserId,now,input.requestId,payloadHash]);
    await recordAuditLogInline(db,{actorUserId,action:'finance_card_merchant_correction',targetTable:'card_merchant_corrections',targetId:eventId,
      before:{cardTxnId:input.cardTxnId,version:before.version,effectiveCorpNum:before.effectiveCorpNum},after:{version,action:input.action,corpNum,reason:input.reason.trim(),evidence:input.evidence.trim()}});
    return{status:'applied',version};
  },{accountingSnapshot:true}).catch(schemaFailure);
}
