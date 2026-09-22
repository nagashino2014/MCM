import { applyCardMerchantCorrections } from "./card-merchant-source";
import { createHash, randomUUID } from "node:crypto";
import { withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { assertAccountingDatesOpen, lockAccountingWrite, validateAccountingRange } from "./write-lock";
import { loadCardTaxRows, normalizeCardTransaction, cardOriginalHash } from "./card-tax";
import { assertVatFilingSourcesMutable } from "./vat-filing-protection";
import { assertSupplyGroupPrerequisites } from "./supply-group-prerequisites";

export type TransactionSourceKind = "card" | "bank" | "hometax" | "tax_invoice" | "manual_invoice";
export type TransactionLinkRelation = "card_invoice" | "bank_invoice" | "manual_invoice" | "distinct";
export interface TransactionSourceRef { kind: TransactionSourceKind; id: string }
export interface TransactionLinkIssue { code: string; message: string; linkId?: string; sourceKey?: string }
export interface TransactionLinkSource {
  kind: TransactionSourceKind; id: string; hash: string; partyName: string;
  journalKind: string; journalId: string; vatDeductible: number | null;
  ref: TransactionSourceRef; key: string; canonicalKey: string; name: string; date: string; taxDate: string;
  direction: "in" | "out" | "sales" | "purchase"; supply: number; tax: number; total: number;
  sourceHash: string; raw: Record<string, unknown>; issues: string[];
  allocated: { supply: number; tax: number; total: number }; residual: { supply: number; tax: number; total: number };
  legacyConfirmedReconBlock: boolean; legacyCollectionBlock: boolean;
}
export interface TransactionLink {
  id: string; relation: TransactionLinkRelation; left: TransactionSourceRef; right: TransactionSourceRef;
  supply: number; tax: number; total: number; expenseAccount: string | null; reason: string; evidence: string;
  leftHash: string; rightHash: string; leftSnapshot: TransactionLinkSource; rightSnapshot: TransactionLinkSource;
  state: "active" | "cancelled"; requestId: string; createdAt: string; cancelledAt: string | null;
  cancelReason: string | null; valid: boolean; issues: TransactionLinkIssue[];
}
export interface TransactionInvoiceRecognition {
  id: string; source: TransactionSourceRef; canonicalKey: string; sourceHash: string; sourceSnapshot: TransactionLinkSource;
  expenseAccount: string | null; reason: string; evidence: string; requestId: string; createdAt: string;
  valid: boolean; issues: TransactionLinkIssue[];
  review?: RecognitionReviewEvidence;
}
export interface RecognitionReviewEvidence { schemaVersion: 1; reviewId: string; reviewVersion: number; basisHash: string }
export interface TransactionLinkState { version: 1; links: TransactionLink[]; sources: TransactionLinkSource[]; issues: TransactionLinkIssue[]; recognitions: TransactionInvoiceRecognition[] }
export interface TransactionLinkInput {
  relation: TransactionLinkRelation; left: TransactionSourceRef; right: TransactionSourceRef;
  supply: number; tax: number; total: number; expenseAccount?: string | null; reason: string; evidence: string;
  expectedLeftHash: string; expectedRightHash: string;
}
export interface CreateTransactionLinksInput { requestId: string; links: TransactionLinkInput[] }
export interface CancelTransactionLinksInput { requestId: string; linkIds: string[]; reason: string }
export const transactionSourceKey = (ref: TransactionSourceRef): string => `${ref.kind}:${ref.id}`;
export const findTransactionSource = (state: TransactionLinkState, ref: TransactionSourceRef) => state.sources.find(source => source.key === transactionSourceKey(ref));
export function linksForTransactionSource(state: TransactionLinkState, ref: TransactionSourceRef): TransactionLink[] {
  const key = transactionSourceKey(ref), canonical = findTransactionSource(state, ref)?.canonicalKey;
  return state.links.filter(link => link.state === "active" && ([transactionSourceKey(link.left), transactionSourceKey(link.right)].includes(key)
    || (!!canonical && [link.leftSnapshot.canonicalKey, link.rightSnapshot.canonicalKey].includes(canonical))));
}

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const conflict = (message: string) => Object.assign(new Error(message), {status:409});
const invalid = (message: string) => Object.assign(new Error(message), {status:400});
const money = (value: unknown) => Number(value);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 4000;
const quarter = (date: string) => `${date.slice(0,4)}-${Math.ceil(Number(date.slice(5,7))/3)}`;
const active = (state: TransactionLinkState) => state.links.filter(link=>link.state==="active");
const sameRef = (a: TransactionSourceRef, b: TransactionSourceRef) => transactionSourceKey(a)===transactionSourceKey(b);
const invoiceKind = (kind: TransactionSourceKind) => kind==="hometax" || kind==="tax_invoice";
const asJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const validDate = (value:string) => { try{validateAccountingRange(value,value);return true;}catch{return false;} };
const addAmount = (a: number, b: number) => {const n=a+b;if(!Number.isSafeInteger(n))throw conflict("배부 합계가 안전한 원 단위 정수 범위를 넘습니다.");return n;};

/** The only review issue a completely allocated card can resolve through invoice evidence. */
export function isOnlyMissingCardTaxReview(row: Record<string,unknown> & {issues?: string[]}): boolean {
  return !row.review_source_hash && !!row.issues?.length && row.issues.every(issue=>issue==="공제 여부와 증빙을 검토해야 합니다.");
}

function sourceFromRow(kind: TransactionSourceKind, r: Record<string,unknown>): TransactionLinkSource {
  const id=String(r[kind==="card"?"card_txn_id":kind==="bank"?"txn_id":kind==="hometax"?"hti_id":kind==="tax_invoice"?"invoice_id":"milestone_id"]);
  const ref={kind,id};const key=transactionSourceKey(ref);const issues:string[]=[];
  const isInvoice=invoiceKind(kind), date=String(r[kind==="card"?"approved_at":kind==="bank"?"txn_at":kind==="manual_invoice"?"invoice_issued_at":"write_date"]??"").slice(0,10);
  const normalized=kind==="card"?normalizeCardTransaction(r):null;
  const supply=kind==="bank"?0:kind==="manual_invoice"?money(r.invoice_amount??r.amount):kind==="card"?normalized!.supplyAmount:money(r.amount_total);
  const tax=kind==="bank"||kind==="manual_invoice"?0:kind==="card"?normalized!.taxAmount:money(r.tax_total);
  const total=kind==="bank"?money(r.amount):kind==="manual_invoice"?supply+tax:kind==="card"?normalized!.amountTotal:money(r.total_amount);
  const direction=String(kind==="card"?"purchase":kind==="manual_invoice"?"sales":r.direction) as TransactionLinkSource["direction"];
  const canonicalKey=isInvoice?`invoice:${String(r.nts_send_key??"").trim()}`:key;
  const name=String(kind==="bank"?r.remitter_name_raw:kind==="card"?r.store_name:kind==="manual_invoice"?r.company_name:direction==="sales"?r.invoicee_corp_name:r.invoicer_corp_name??"");
  const taxDate=String(kind==="card"?r.review_tax_date||date:date).slice(0,10);
  if(!validDate(date)||!validDate(taxDate))issues.push("invalid_source_date");
  if(![supply,tax,total].every(integer)||total<=0||(kind!=="bank"&&supply+tax!==total))issues.push("unsupported_negative_or_invalid_amount");
  if(Number(r.excluded)||r.canceled_at)issues.push("source_excluded_or_cancelled");
  if(isInvoice&&!String(r.nts_send_key??"").trim())issues.push("official_invoice_key_required");
  if(isInvoice&&r.modify_code)issues.push("modified_invoice_not_supported");
  if(kind==='tax_invoice'&&Number(r.nts_send_state)!==4)issues.push("official_invoice_not_transmitted");
  if(isInvoice&&!['sales','purchase'].includes(direction))issues.push("invalid_invoice_direction");
  if(kind==="bank"&&!['in','out'].includes(direction))issues.push("invalid_bank_direction");
  if(kind==="manual_invoice"&&Number(r.invoice_issued)!==1)issues.push("manual_invoice_not_issued");
  if(kind==="card"){
    if(!normalized!.valid||normalized!.kind!=="purchase"||normalized!.serviceCharge!==0)issues.push("unsupported_card_type_or_service");
    if(Array.isArray(r.refund_references)&&r.refund_references.length)issues.push("card_with_refund_not_supported");
    const cardIssues=asJson<string[]>(r.card_issues??[]);
    for(const issue of cardIssues)issues.push(issue==="공제 여부와 증빙을 검토해야 합니다."&&!r.review_source_hash?"card_tax_review_required":issue);
  }
  const raw={...r,...(kind==='manual_invoice'?{gross_unknown:true}:{})};const sourceHash=hash({version:1,kind,raw});
  return {kind,id,hash:sourceHash,partyName:name,journalKind:kind==="bank"?`bank_${direction}`:kind==="hometax"?"hometax_invoice":kind==="manual_invoice"?"invoice_manual":kind,journalId:id,
    vatDeductible:r.vat_deductible==null?null:Number(r.vat_deductible),ref,key,canonicalKey,name,date,taxDate,direction,supply,tax,total,sourceHash,raw,issues,
    allocated:{supply:0,tax:0,total:0},residual:{supply,tax,total},legacyConfirmedReconBlock:!!r.legacy_confirmed_recon,legacyCollectionBlock:false};
}

async function loadSources(db: PgDatabase): Promise<TransactionLinkSource[]> {
  const sources:TransactionLinkSource[]=[];
  // Select calculation/evidence fields only. No provider raw JSON, account number, or credentials.
  const cardRows=await applyCardMerchantCorrections(db,rowsToObjects(await db.exec(`SELECT t.card_txn_id,t.card_id,t.approval_type,t.approval_num,t.approved_at,t.amount_total,t.supply_amount,t.tax_amount,t.service_charge,t.store_corp_num,t.store_name,t.store_tax_type,t.category_key,t.excluded,
    r.source_hash AS review_source_hash,r.decision AS review_decision,r.tax_date AS review_tax_date,r.reason AS review_reason,r.evidence_ref AS review_evidence,r.original_card_txn_id
    FROM card_transactions t LEFT JOIN card_tax_reviews r ON r.card_txn_id=t.card_txn_id`)));
  const cardReview=await loadCardTaxRows(db,{from:"1000-01-01",to:"9999-12-31",dateBasis:"accounting"});
  const reviews=new Map(cardReview.map(row=>[String(row.card_txn_id),row]));
  for(const row of cardRows){const reviewed=reviews.get(String(row.card_txn_id));const refunds=cardRows.filter(r=>!Number(r.excluded)&&['취소','부분취소','환불'].includes(String(r.approval_type))&&(r.original_card_txn_id===row.card_txn_id||(r.card_id===row.card_id&&!!r.approval_num&&r.approval_num===row.approval_num))).map(r=>String(r.card_txn_id)).sort();sources.push(sourceFromRow("card",{...row,card_issues:reviewed?.issues??[],card_review_hash:cardOriginalHash(row),refund_references:refunds}));}
  for(const row of rowsToObjects(await db.exec(`SELECT t.txn_id,t.txn_at,t.direction,t.amount,t.remitter_name_raw,t.remitter_name_norm,t.trans_type,t.recon_status,
    (t.recon_status='confirmed' OR EXISTS(SELECT 1 FROM recon_matches m WHERE m.txn_id=t.txn_id AND m.status='confirmed')) AS legacy_confirmed_recon
    FROM bank_transactions t`)))sources.push(sourceFromRow("bank",row));
  for(const row of rowsToObjects(await db.exec(`SELECT hti_id,direction,nts_send_key,write_date,modify_code,tax_type,invoicer_corp_num,invoicer_corp_name,invoicee_corp_num,invoicee_corp_name,
    amount_total,tax_total,total_amount,vat_deductible,excluded FROM hometax_tax_invoices`)))sources.push(sourceFromRow("hometax",row));
  for(const row of rowsToObjects(await db.exec(`SELECT invoice_id,direction,nts_send_key,write_date,modify_code,tax_type,invoicee_corp_num,invoicee_corp_name,
    amount_total,tax_total,total_amount,canceled_at,milestone_id,nts_send_state FROM tax_invoices`)))sources.push(sourceFromRow("tax_invoice",row));
  for(const row of rowsToObjects(await db.exec(`SELECT m.milestone_id,m.invoice_issued,m.invoice_issued_at,m.amount,m.invoice_amount,m.stage_label,m.contract_id,c.contract_title,f.company_name
    FROM contract_payment_milestones m JOIN contracts c ON c.contract_id=m.contract_id LEFT JOIN facilities f ON f.facility_id=c.counterparty_facility_id`)))sources.push(sourceFromRow("manual_invoice",row));
  const groups=new Map<string,TransactionLinkSource[]>();
  for(const source of sources.filter(s=>invoiceKind(s.kind)&&!s.issues.includes('source_excluded_or_cancelled')&&!s.issues.includes('official_invoice_not_transmitted'))){const group=groups.get(source.canonicalKey)??[];group.push(source);groups.set(source.canonicalKey,group);}
  const invoiceBasis=(s:TransactionLinkSource)=>hash([s.date,s.direction,s.supply,s.tax,s.total,Number(s.raw.tax_type??1),String(s.raw.modify_code??""),String(s.direction==="sales"?s.raw.invoicee_corp_num:s.raw.invoicer_corp_num??"").replace(/[^0-9]/g,"")]);
  for(const group of groups.values()){
    if(new Set(group.map(invoiceBasis)).size>1)for(const s of group)s.issues.push("official_invoice_content_conflict");
    const app=group.filter(s=>s.kind==="tax_invoice");
    if(app.length>1)for(const s of group)s.issues.push("multiple_active_app_invoice_rows");
    if(app.length===1&&app[0].direction==="sales")for(const s of group){s.journalKind="tax_invoice";s.journalId=app[0].id;}
  }
  return sources;
}

function readLink(r:Record<string,unknown>):TransactionLink {
  return {id:String(r.link_id),relation:String(r.relation) as TransactionLinkRelation,left:{kind:String(r.left_kind) as TransactionSourceKind,id:String(r.left_id)},right:{kind:String(r.right_kind) as TransactionSourceKind,id:String(r.right_id)},
    supply:Number(r.supply),tax:Number(r.tax),total:Number(r.total),expenseAccount:r.expense_account?String(r.expense_account):null,reason:String(r.reason),evidence:String(r.evidence),leftHash:String(r.left_hash),rightHash:String(r.right_hash),
    leftSnapshot:asJson<TransactionLinkSource>(r.left_snapshot),rightSnapshot:asJson<TransactionLinkSource>(r.right_snapshot),state:String(r.state) as TransactionLink["state"],requestId:String(r.request_id),createdAt:String(r.created_at),cancelledAt:r.cancelled_at?String(r.cancelled_at):null,cancelReason:r.cancel_reason?String(r.cancel_reason):null,valid:true,issues:[]};
}

function validateState(state: TransactionLinkState): void {
  const sources=new Map(state.sources.map(s=>[s.key,s]));
  const add=(link:TransactionLink,code:string,message:string)=>{if(!link.issues.some(i=>i.code===code))link.issues.push({code,message,linkId:link.id});link.valid=false;};
  const cardTotals=new Map<string,{supply:number;tax:number;total:number}>(), invoiceTotals=new Map<string,{cardSupply:number;cardTax:number;total:number;account:Set<string>}>(),bankTotals=new Map<string,number>(),manuals=new Set<string>(),pairs=new Map<string,TransactionLink[]>();
  for(const link of active(state)){
    const left=sources.get(transactionSourceKey(link.left)),right=sources.get(transactionSourceKey(link.right));
    if(!left||!right){add(link,"source_missing","연결 원천이 삭제되었습니다.");continue;}
    if(left.sourceHash!==link.leftHash||right.sourceHash!==link.rightHash)add(link,"source_stale","연결 후 원천 또는 검토 근거가 변경되었습니다.");
    if(!invoiceKind(right.kind))add(link,"invalid_relation","계산서 원천이 필요합니다.");
    const pair=`${left.canonicalKey}|${right.canonicalKey}`;pairs.set(pair,[...(pairs.get(pair)??[]),link]);
    if(link.relation==="card_invoice"){
      const t=cardTotals.get(left.key)??{supply:0,tax:0,total:0};t.supply=addAmount(t.supply,link.supply);t.tax=addAmount(t.tax,link.tax);t.total=addAmount(t.total,link.total);cardTotals.set(left.key,t);
      if(left.kind!=="card"||right.kind!=="hometax"||right.direction!=="purchase")add(link,"invalid_relation","카드와 홈택스 매입 계산서만 연결할 수 있습니다.");
      if(quarter(left.taxDate)!==quarter(right.date))add(link,"cross_vat_quarter","다른 부가세 분기 귀속의 카드·계산서 연결은 아직 지원하지 않습니다.");
    }else if(link.relation==="bank_invoice"){
      bankTotals.set(left.key,addAmount(bankTotals.get(left.key)??0,link.total));
      if(left.kind!=="bank"||!(left.direction==="in"&&right.direction==="sales"||left.direction==="out"&&right.kind==="hometax"&&right.direction==="purchase"))add(link,"invalid_relation","입금은 매출, 출금은 홈택스 매입 계산서에 연결하세요.");
      if(left.legacyConfirmedReconBlock)add(link,"legacy_recon_conflict","기존 확정 수금의 실제 배부 용량을 먼저 검토해야 합니다.");
      if(right.legacyCollectionBlock)add(link,"legacy_collection_conflict","계산서 관련 단계에 기존 수금이 있어 신규 배부 용량을 확인할 수 없습니다.");
    }else if(link.relation==="manual_invoice"){
      if(left.kind!=="manual_invoice"||right.direction!=="sales"||left.supply!==right.supply||link.supply!==right.supply||link.tax!==right.tax||link.total!==right.total)add(link,"invalid_manual_invoice","수기 매출 전체 공급가액이 같은 매출 계산서만 연결할 수 있습니다.");
      if(manuals.has(left.key))add(link,"duplicate_manual_invoice","수기 매출은 한 대표 계산서에만 연결할 수 있습니다.");manuals.add(left.key);
    }else if(link.relation==="distinct"){
      if(left.kind!=="card"||right.kind!=="hometax"||right.direction!=="purchase"||link.total||link.supply||link.tax)add(link,"invalid_distinct","별개 거래 확인은 카드와 홈택스 매입 계산서의 0원 관계입니다.");
    }else add(link,"invalid_relation","지원하지 않는 연결 종류입니다.");
    if(link.relation==="card_invoice"||link.relation==="bank_invoice"){
      if(left.date<right.date)add(link,"advance_payment_unsupported","계산서 작성일 이전 지급의 선급·선수 처리는 아직 지원하지 않습니다.");
      const t=invoiceTotals.get(right.canonicalKey)??{cardSupply:0,cardTax:0,total:0,account:new Set<string>()};
      t.total=addAmount(t.total,link.total);if(link.relation==="card_invoice"){t.cardSupply=addAmount(t.cardSupply,link.supply);t.cardTax=addAmount(t.cardTax,link.tax);}if(link.expenseAccount)t.account.add(link.expenseAccount);invoiceTotals.set(right.canonicalKey,t);
      if(right.direction==="purchase"&&!link.expenseAccount)add(link,"expense_account_required","매입 발생을 인식할 비용 계정이 필요합니다.");
    }
  }
  for(const link of active(state)){
    const left=sources.get(transactionSourceKey(link.left)),right=sources.get(transactionSourceKey(link.right));if(!left||!right)continue;
    const card=cardTotals.get(left.key);
    const canUseMissingReview=left.kind==="card"&&link.relation==="card_invoice"&&card?.total===left.total&&card.supply===left.supply&&card.tax===left.tax;
    for(const issue of [...left.issues.filter(i=>!(canUseMissingReview&&i==="card_tax_review_required")),...right.issues])add(link,"invalid_source",`원천 확인 필요: ${issue}`);
    if(card&&(card.supply>left.supply||card.tax>left.tax||card.total>left.total))add(link,"card_capacity_exceeded","카드 공급가액·세액·합계 배부가 원천을 초과합니다.");
    if((bankTotals.get(left.key)??0)>left.total)add(link,"bank_capacity_exceeded","은행 입출금액을 초과해 배부할 수 없습니다.");
    const inv=invoiceTotals.get(right.canonicalKey);if(inv&&(inv.total>right.total||inv.cardSupply>right.supply||inv.cardTax>right.tax))add(link,"invoice_capacity_exceeded","동일 공식 계산서의 카드·은행 누적 배부가 원천을 초과합니다.");
    if(inv&&inv.account.size>1)add(link,"expense_account_conflict","같은 매입 계산서의 비용 계정은 동일해야 합니다.");
    const pair=pairs.get(`${left.canonicalKey}|${right.canonicalKey}`)??[];
    if(pair.some(p=>p.relation==="distinct")&&pair.some(p=>p.relation!=="distinct"))add(link,"distinct_conflict","같은 두 원천에 동일 거래와 별개 거래를 동시에 지정할 수 없습니다.");
    if(pair.filter(p=>p.relation===link.relation).length>1)add(link,"duplicate_link","동일 활성 관계가 중복되었습니다.");
  }
  for(const source of state.sources){
    const card=cardTotals.get(source.key),inv=invoiceTotals.get(source.canonicalKey),bank=bankTotals.get(source.key);
    source.allocated=card?{...card}:invoiceKind(source.kind)?{supply:inv?.cardSupply??0,tax:inv?.cardTax??0,total:inv?.total??0}:{supply:0,tax:0,total:bank??0};
    source.residual={supply:source.supply-source.allocated.supply,tax:source.tax-source.allocated.tax,total:source.total-source.allocated.total};
  }
  state.issues=active(state).flatMap(link=>link.issues);
}

function recognitionReviewUnavailable(message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status: 503, code: 'recognition_review_unavailable' });
}

/** 구형 227은 그대로 읽되, R1이 일부만 설치된 상태를 legacy로 강등하지 않는다. */
async function loadRecognitionReviewEvidence(db: PgDatabase): Promise<Map<string, RecognitionReviewEvidence>> {
  try {
    const metadata = rowsToObjects(await db.exec(`SELECT
      (SELECT COUNT(*)::integer FROM pg_attribute WHERE attrelid=to_regclass('transaction_invoice_recognitions')
        AND attname IN ('review_version','applied_review_id') AND attnum>0 AND NOT attisdropped) AS columns,
      to_regclass('recognition_review_revisions')::text AS revisions,
      to_regclass('recognition_review_requests')::text AS requests,
      to_regprocedure('r1_assert_recognition_current(text)')::text AS verifier`))[0];
    if (!metadata) throw recognitionReviewUnavailable('인식 검토 구조를 확인할 수 없습니다.');
    if (metadata.columns === 0 && metadata.revisions == null && metadata.requests == null && metadata.verifier == null) return new Map();
    if (metadata.columns !== 2 || !metadata.revisions || !metadata.requests || !metadata.verifier) {
      throw recognitionReviewUnavailable('인식 검토 열·이력·현재판 검사 설치가 불완전합니다.');
    }
    const reviews = new Map<string, RecognitionReviewEvidence>();
    const rows = rowsToObjects(await db.exec(`SELECT recognition_id,r1_assert_recognition_current(recognition_id) AS review
      FROM transaction_invoice_recognitions ORDER BY recognition_id`));
    for (const row of rows) {
      if (row.review == null) continue;
      const review = row.review as RecognitionReviewEvidence;
      if (typeof review !== 'object' || Array.isArray(review)
        || Object.keys(review).sort().join(',') !== 'basisHash,reviewId,reviewVersion,schemaVersion'
        || review.schemaVersion !== 1 || typeof review.reviewId !== 'string' || !review.reviewId
        || typeof review.reviewVersion !== 'number' || !Number.isInteger(review.reviewVersion) || review.reviewVersion < 1 || review.reviewVersion > 2147483647
        || typeof review.basisHash !== 'string' || !/^[0-9a-f]{64}$/.test(review.basisHash)) {
        throw recognitionReviewUnavailable('인식 검토 현재판 근거의 형식이 올바르지 않습니다.');
      }
      reviews.set(String(row.recognition_id), review);
    }
    return reviews;
  } catch (error) {
    if (['40001','40P01'].includes(String((error as {code?:string}).code))) throw error;
    if ((error as {code?:string}).code === 'recognition_review_unavailable') throw error;
    throw recognitionReviewUnavailable('인식 검토 현재판을 검증할 수 없습니다. 설치 구조와 검토 이력을 확인하세요.');
  }
}

export async function loadTransactionLinkState(db: PgDatabase): Promise<TransactionLinkState> {
  const recognitionReviews = await loadRecognitionReviewEvidence(db);
  const sources=await loadSources(db),links=rowsToObjects(await db.exec("SELECT * FROM transaction_links ORDER BY created_at,link_id")).map(readLink);
  const milestones=rowsToObjects(await db.exec("SELECT milestone_id,collected_amount,payment_collected,partial_payments_json FROM contract_payment_milestones"));
  const legacy=new Set(milestones.filter(r=>Number(r.collected_amount)>0||Number(r.payment_collected)===1||(Array.isArray(r.partial_payments_json)&&r.partial_payments_json.length>0)).map(r=>String(r.milestone_id)));
  const byCanonical=new Map<string,Set<string>>();
  for(const source of sources.filter(s=>invoiceKind(s.kind))){if(source.raw.milestone_id){const ids=byCanonical.get(source.canonicalKey)??new Set<string>();ids.add(String(source.raw.milestone_id));byCanonical.set(source.canonicalKey,ids);}}
  for(const link of links.filter(l=>l.state==="active"&&l.relation==="manual_invoice")){const right=sources.find(s=>sameRef(s.ref,link.right));if(right){const ids=byCanonical.get(right.canonicalKey)??new Set<string>();ids.add(link.left.id);byCanonical.set(right.canonicalKey,ids);}}
  for(const source of sources)source.legacyCollectionBlock=source.kind==="manual_invoice"?legacy.has(source.id):[...(byCanonical.get(source.canonicalKey)??[])].some(id=>legacy.has(id));
  const recognitions=rowsToObjects(await db.exec("SELECT * FROM transaction_invoice_recognitions ORDER BY recognition_id")).map((r):TransactionInvoiceRecognition=>{
    const source={kind:String(r.source_kind) as TransactionSourceKind,id:String(r.source_id)},current=sources.find(s=>sameRef(s.ref,source)),issues:TransactionLinkIssue[]=[];
    if(!current||current.sourceHash!==String(r.source_hash)||current.issues.length)issues.push({code:"recognition_stale",message:"매출·매입 인식 근거가 변경되어 다시 검토해야 합니다.",sourceKey:transactionSourceKey(source)});
    const review = recognitionReviews.get(String(r.recognition_id));
    return{id:String(r.recognition_id),source,canonicalKey:String(r.canonical_invoice_key),sourceHash:String(r.source_hash),sourceSnapshot:asJson<TransactionLinkSource>(r.source_snapshot),expenseAccount:r.expense_account?String(r.expense_account):null,reason:String(r.reason),evidence:String(r.evidence),requestId:String(r.request_id),createdAt:String(r.created_at),valid:!issues.length,issues,...(review ? {review} : {})};
  });
  const state:TransactionLinkState={version:1,sources,links,issues:[],recognitions};validateState(state);
  const expenseAccounts=new Set(rowsToObjects(await db.exec("SELECT account_code FROM journal_accounts WHERE acct_type='expense' AND is_active=1")).map(r=>String(r.account_code)));
  for(const link of active(state))if(link.expenseAccount&&!expenseAccounts.has(link.expenseAccount)){const issue={code:'expense_account_inactive',message:'연결된 비용 계정이 비활성 또는 비용 계정이 아닙니다.',linkId:link.id};link.valid=false;link.issues.push(issue);state.issues.push(issue);}
  for(const recognition of recognitions)if(recognition.expenseAccount&&!expenseAccounts.has(recognition.expenseAccount)){recognition.valid=false;recognition.issues.push({code:'recognition_account_inactive',message:'발생 인식의 비용 계정이 비활성 또는 비용 계정이 아닙니다.',sourceKey:transactionSourceKey(recognition.source)});}
  state.issues.push(...recognitions.flatMap(r=>r.issues));return state;
}

function connectedSources(state:TransactionLinkState, refs:TransactionSourceRef[]):TransactionLinkSource[] {
  const keys=new Set(refs.map(transactionSourceKey)),canonicals=new Set<string>();
  let changed=true;
  while(changed){changed=false;for(const source of state.sources)if(keys.has(source.key)||canonicals.has(source.canonicalKey)){if(!keys.has(source.key)){keys.add(source.key);changed=true;}canonicals.add(source.canonicalKey);}
    for(const link of active(state))if(keys.has(transactionSourceKey(link.left))||keys.has(transactionSourceKey(link.right))||canonicals.has(link.rightSnapshot.canonicalKey))for(const ref of [link.left,link.right])if(!keys.has(transactionSourceKey(ref))){keys.add(transactionSourceKey(ref));changed=true;}
  }
  return state.sources.filter(source=>keys.has(source.key));
}

async function lockSourceRows(db:PgDatabase,sources:TransactionLinkSource[]):Promise<void>{
  const tables:Record<TransactionSourceKind,[string,string]>={card:['card_transactions','card_txn_id'],bank:['bank_transactions','txn_id'],hometax:['hometax_tax_invoices','hti_id'],tax_invoice:['tax_invoices','invoice_id'],manual_invoice:['contract_payment_milestones','milestone_id']};
  for(const kind of ['bank','card','hometax','tax_invoice','manual_invoice'] as TransactionSourceKind[]){const ids=[...new Set(sources.filter(s=>s.kind===kind).map(s=>s.id))].sort();if(ids.length){const [table,id]=tables[kind];await db.exec(`SELECT ${id} FROM ${table} WHERE ${id}=ANY($1::text[]) ORDER BY ${id} FOR UPDATE`,[ids]);}}
  const milestones=[...new Set(sources.flatMap(s=>s.kind==='manual_invoice'?[s.id]:s.raw.milestone_id?[String(s.raw.milestone_id)]:[]))].sort();
  if(milestones.length)await db.exec("SELECT milestone_id FROM contract_payment_milestones WHERE milestone_id=ANY($1::text[]) ORDER BY milestone_id FOR UPDATE",[milestones]);
}

async function assertMutableSources(db:PgDatabase,state:TransactionLinkState,refs:TransactionSourceRef[],snapshots:TransactionLinkSource[]=[],changedJournalSources?:Set<string>):Promise<void>{
  const connected=connectedSources(state,refs),all=[...connected,...snapshots];
  const canonicalKeys=new Set(all.map(s=>s.canonicalKey));
  all.push(...state.recognitions.filter(r=>canonicalKeys.has(r.canonicalKey)).map(r=>r.sourceSnapshot));
  const dates=[...new Set(all.flatMap(s=>[s.date,s.taxDate]).filter(validDate))];
  await assertAccountingDatesOpen(db,dates);
  await lockSourceRows(db,connected);
  const journalRefs=new Map<string,{kind:string;id:string}>();
  for(const source of all){const refs=[{kind:source.journalKind,id:source.journalId},...(source.kind==='hometax'?[{kind:'hometax_invoice',id:source.id}]:[]),...(source.raw.milestone_id?[{kind:'invoice_manual',id:String(source.raw.milestone_id)}]:[])];for(const ref of refs)journalRefs.set(`${ref.kind}:${ref.id}`,ref);}
  const values=[...journalRefs.values()];
  const entries=rowsToObjects(await db.exec(`SELECT e.entry_id,e.entry_date,e.status FROM journal_entries e WHERE EXISTS(
    SELECT 1 FROM unnest($1::text[],$2::text[]) source(kind,id) WHERE source.kind=e.source_kind AND source.id=e.source_id) ORDER BY e.entry_id FOR UPDATE OF e`,[values.map(v=>v.kind),values.map(v=>v.id)]));
  await assertAccountingDatesOpen(db,entries.map(e=>String(e.entry_date)));
  if(changedJournalSources){
    const protectedEntries=rowsToObjects(await db.exec("SELECT e.source_kind,e.source_id,e.status,s.source_json FROM journal_entries e LEFT JOIN journal_source_snapshots s USING(entry_id) WHERE e.entry_id=ANY($1::text[])",[entries.map(e=>String(e.entry_id))]));
    for(const entry of protectedEntries.filter(e=>['confirmed','excluded'].includes(String(e.status)))){
      if(changedJournalSources.has(`${entry.source_kind}:${entry.source_id}`))throw conflict("변경할 원천에 확정·제외 전표가 있어 연결을 바꿀 수 없습니다.");
      if(entry.source_kind==='tax_invoice'){
        const current=state.sources.find(s=>s.kind==='tax_invoice'&&s.id===String(entry.source_id));
        const evidence=entry.source_json?asJson<{evidence?:Record<string,unknown>}>(entry.source_json).evidence:null;
        if(!current||!evidence||Object.entries(evidence).some(([key,value])=>String(value??'')!==String(current.raw[key]??'')))throw conflict("기존 확정 계산서의 원천 근거를 확인할 수 없거나 변경되었습니다.");
      }
    }
  }else if(entries.some(e=>['confirmed','excluded'].includes(String(e.status))))throw conflict("연결된 원천에 확정·제외 전표가 있어 연결을 변경할 수 없습니다. 기존 전표를 검토한 뒤 진행하세요.");
  await assertVatFilingSourcesMutable(db,{dates,refs:all.map(source=>({kind:source.kind,id:source.id}))});
}

function validateRef(ref:TransactionSourceRef):void{
  if(!ref||!['card','bank','hometax','tax_invoice','manual_invoice'].includes(ref.kind)||!nonempty(ref.id)||ref.id.length>200)throw invalid("원천 종류와 식별자가 올바르지 않습니다.");
}
function validateInput(input:CreateTransactionLinksInput):void{
  if(!input||!nonempty(input.requestId)||input.requestId.length>200||!Array.isArray(input.links)||!input.links.length||input.links.length>100)throw invalid("요청 식별자와 1~100개의 연결이 필요합니다.");
  for(const link of input.links){if(!link||typeof link!=='object')throw invalid("연결 항목이 올바르지 않습니다.");validateRef(link.left);validateRef(link.right);if(!['card_invoice','bank_invoice','manual_invoice','distinct'].includes(link.relation)||!nonempty(link.reason)||!nonempty(link.evidence))throw invalid("연결 종류·사유·증빙 참조가 필요합니다.");
    if(link.expenseAccount!=null&&typeof link.expenseAccount!=='string')throw invalid("비용 계정 형식이 올바르지 않습니다.");
    if(![link.supply,link.tax,link.total].every(integer))throw invalid("공급가액·세액·합계는 0 이상의 안전한 원 단위 정수여야 합니다.");
    if(link.relation==='distinct'?(link.supply!==0||link.tax!==0||link.total!==0):link.relation==='bank_invoice'?(link.supply!==0||link.tax!==0||link.total<=0):(link.total<=0||link.supply+link.tax!==link.total))throw invalid("관계 종류별 배부 금액이 올바르지 않습니다.");
    if(!/^[0-9a-f]{64}$/.test(link.expectedLeftHash??'')||!/^[0-9a-f]{64}$/.test(link.expectedRightHash??''))throw invalid("선택 시 확인한 양쪽 원천 해시가 필요합니다.");
  }
}
export interface TransactionLinkMutationResult { links:TransactionLink[];requestId:string;replayed:boolean }
async function retryWrite<T>(fn:(db:PgDatabase)=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++)try{return await withDbWrite(fn,{accountingSnapshot:true});}catch(error){
    const pg=error as {code?:string;constraint?:string};
    if(attempt<2&&['40001','40P01'].includes(String(pg.code)))continue;
    if(pg.code==='23514'&&pg.constraint==='finance_group_relation')throw conflict('이미 확인한 문서 묶음과 관계가 충돌합니다. 최신 근거를 다시 확인해 주세요.');
    throw error;
  }
}
async function priorRequest(db:PgDatabase,requestId:string,action:string,payloadHash:string):Promise<TransactionLinkMutationResult|null>{
  const previous=rowsToObjects(await db.exec("SELECT action,payload_hash,result_json FROM transaction_link_requests WHERE request_id=$1",[requestId]))[0];
  if(!previous)return null;if(previous.action!==action||previous.payload_hash!==payloadHash)throw conflict("같은 요청 식별자에 다른 내용이 있습니다. 새 요청으로 다시 시도하세요.");
  return{...asJson<TransactionLinkMutationResult>(previous.result_json),replayed:true};
}
async function rememberRequest(db:PgDatabase,input:{requestId:string},action:string,payloadHash:string,result:TransactionLinkMutationResult,actor:string,now:string){
  await db.run("INSERT INTO transaction_link_requests(request_id,action,payload_hash,result_json,actor_user_id,created_at)VALUES($1,$2,$3,$4,$5,$6)",[input.requestId,action,payloadHash,JSON.stringify(result),actor,now]);
}

export async function createTransactionLinks(input:CreateTransactionLinksInput,actorUserId:string):Promise<TransactionLinkMutationResult>{
  validateInput(input);if(!nonempty(actorUserId))throw invalid("실행자가 필요합니다.");const payloadHash=hash(input);
  return retryWrite(async db=>{
    await lockAccountingWrite(db);const previous=await priorRequest(db,input.requestId,'create',payloadHash);if(previous)return previous;
    await assertSupplyGroupPrerequisites(db,process.env.FINANCE_R1_SCHEMA??'public');
    const state=await loadTransactionLinkState(db),refs=input.links.flatMap(link=>[link.left,link.right]);
    for (const item of input.links.filter(link => link.relation !== 'distinct')) {
      const right = findTransactionSource(state, item.right);
      const recognition = right && state.recognitions.find(row => row.canonicalKey === right.canonicalKey);
      if (recognition?.review && (!recognition.valid || recognition.sourceHash !== right!.sourceHash
        || recognition.source.kind !== right!.ref.kind || recognition.source.id !== right!.ref.id
        || recognition.expenseAccount !== (item.expenseAccount?.trim() || null)
        || recognition.sourceSnapshot.journalKind !== right!.journalKind || recognition.sourceSnapshot.journalId !== right!.journalId)) {
        throw conflict('검토 이력이 있는 인식의 원천·계정·대표가 변경되었습니다. 인식을 먼저 재검토한 뒤 연결하세요.');
      }
    }
    const connected=connectedSources(state,refs),keys=new Set(connected.map(s=>s.key)),canonicalKeys=new Set(connected.map(s=>s.canonicalKey));
    if(active(state).some(link=>!link.valid&&(keys.has(transactionSourceKey(link.left))||canonicalKeys.has(link.rightSnapshot.canonicalKey))))throw conflict("기존 활성 연결의 원천이 변경되었습니다. 연결을 검토·취소한 뒤 다시 진행하세요.");
    const changedJournalSources=new Set<string>();
    for(const item of input.links){const left=findTransactionSource(state,item.left),right=findTransactionSource(state,item.right);if(left)changedJournalSources.add(`${left.journalKind}:${left.journalId}`);if(right){const rec=state.recognitions.find(r=>r.canonicalKey===right.canonicalKey);if(item.relation!=='distinct'&&right.journalKind!=='tax_invoice'&&(!rec||rec.sourceHash!==right.sourceHash||rec.expenseAccount!==(item.expenseAccount?.trim()||null)||rec.sourceSnapshot.journalKind!==right.journalKind||rec.sourceSnapshot.journalId!==right.journalId))changedJournalSources.add(`${right.journalKind}:${right.journalId}`);}}
    await assertMutableSources(db,state,refs,[],changedJournalSources);
    const now=new Date().toISOString(),created:TransactionLink[]=[];
    const accounts=new Set(rowsToObjects(await db.exec("SELECT account_code FROM journal_accounts WHERE acct_type='expense' AND is_active=1")).map(row=>String(row.account_code)));
    for(const item of input.links){const left=findTransactionSource(state,item.left),right=findTransactionSource(state,item.right);if(!left||!right)throw conflict("선택한 원천이 없어졌습니다. 목록을 다시 조회하세요.");
      if(left.sourceHash!==item.expectedLeftHash||right.sourceHash!==item.expectedRightHash)throw conflict("선택 후 원천이 변경되었습니다. 최신 목록에서 다시 확인하세요.");
      const expenseAccount=item.expenseAccount?.trim()||null;
      if(expenseAccount&&!accounts.has(expenseAccount))throw invalid("활성 비용 계정을 선택하세요.");
      if(item.relation==='card_invoice'&&left.supply===right.supply&&left.tax===right.tax&&left.total===right.total&&(item.supply!==left.supply||item.tax!==left.tax||item.total!==left.total))throw conflict("금액 성분이 모두 같은 카드·계산서는 전체 동일 거래 또는 별개 거래로 확인하세요. 일부만 연결하면 잔여가 중복될 수 있습니다.");
      created.push({id:`tl-${randomUUID()}`,relation:item.relation,left:item.left,right:item.right,supply:item.supply,tax:item.tax,total:item.total,expenseAccount,reason:item.reason.trim(),evidence:item.evidence.trim(),leftHash:left.sourceHash,rightHash:right.sourceHash,leftSnapshot:structuredClone(left),rightSnapshot:structuredClone(right),state:'active',requestId:input.requestId,createdAt:now,cancelledAt:null,cancelReason:null,valid:true,issues:[]});
    }
    state.links.push(...created);validateState(state);
    const relevant=active(state).filter(link=>created.includes(link)||keys.has(transactionSourceKey(link.left))||canonicalKeys.has(link.rightSnapshot.canonicalKey));
    if(relevant.some(link=>!link.valid))throw conflict(relevant.flatMap(link=>link.issues.map(issue=>issue.message)).join(' / '));
    for(const link of created){await db.run(`INSERT INTO transaction_links(link_id,relation,left_kind,left_id,right_kind,right_id,canonical_invoice_key,supply,tax,total,expense_account,reason,evidence,left_hash,right_hash,left_snapshot,right_snapshot,state,request_id,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active',$18,$19,$20)`,[link.id,link.relation,link.left.kind,link.left.id,link.right.kind,link.right.id,link.rightSnapshot.canonicalKey,link.supply,link.tax,link.total,link.expenseAccount,link.reason,link.evidence,link.leftHash,link.rightHash,JSON.stringify(link.leftSnapshot),JSON.stringify(link.rightSnapshot),input.requestId,actorUserId,now]);
      await db.run("INSERT INTO transaction_link_history(history_id,link_id,action,request_id,actor_user_id,reason,snapshot,created_at)VALUES($1,$2,'create',$3,$4,$5,$6,$7)",[`tlh-${randomUUID()}`,link.id,input.requestId,actorUserId,link.reason,JSON.stringify(link),now]);
      if(link.relation!=='distinct'){
        const recognition=state.recognitions.find(r=>r.canonicalKey===link.rightSnapshot.canonicalKey);
        if(recognition&&recognition.sourceHash===link.rightHash&&recognition.expenseAccount===link.expenseAccount&&recognition.sourceSnapshot.journalKind===link.rightSnapshot.journalKind&&recognition.sourceSnapshot.journalId===link.rightSnapshot.journalId)continue;
        if(recognition?.review)throw conflict('검토된 인식은 거래 연결에서 덮어쓸 수 없습니다. 인식을 먼저 재검토하세요.');
        if(recognition?.expenseAccount&&recognition.expenseAccount!==link.expenseAccount&&active(state).some(l=>!created.includes(l)&&l.rightSnapshot.canonicalKey===recognition.canonicalKey))throw conflict("기존 매입 인식의 비용 계정을 활성 지급 연결과 다르게 바꿀 수 없습니다.");
        await db.run(`INSERT INTO transaction_invoice_recognitions(recognition_id,canonical_invoice_key,source_kind,source_id,source_hash,source_snapshot,expense_account,reason,evidence,request_id,created_by,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(canonical_invoice_key) DO UPDATE SET source_kind=EXCLUDED.source_kind,source_id=EXCLUDED.source_id,source_hash=EXCLUDED.source_hash,source_snapshot=EXCLUDED.source_snapshot,expense_account=EXCLUDED.expense_account,reason=EXCLUDED.reason,evidence=EXCLUDED.evidence,request_id=EXCLUDED.request_id,created_by=EXCLUDED.created_by,created_at=EXCLUDED.created_at`,
          [recognition?.id??`tir-${randomUUID()}`,link.rightSnapshot.canonicalKey,link.right.kind,link.right.id,link.rightHash,JSON.stringify(link.rightSnapshot),link.expenseAccount,link.reason,link.evidence,input.requestId,actorUserId,now]);
        const saved=rowsToObjects(await db.exec("SELECT recognition_id FROM transaction_invoice_recognitions WHERE canonical_invoice_key=$1",[link.rightSnapshot.canonicalKey]))[0];
        const snapshot:TransactionInvoiceRecognition={id:String(saved.recognition_id),source:link.right,canonicalKey:link.rightSnapshot.canonicalKey,sourceHash:link.rightHash,sourceSnapshot:link.rightSnapshot,expenseAccount:link.expenseAccount,reason:link.reason,evidence:link.evidence,requestId:input.requestId,createdAt:now,valid:true,issues:[]};
        const index=state.recognitions.findIndex(r=>r.canonicalKey===snapshot.canonicalKey);if(index>=0)state.recognitions[index]=snapshot;else state.recognitions.push(snapshot);
      }
    }
    const result={links:created,requestId:input.requestId,replayed:false};await rememberRequest(db,input,'create',payloadHash,result,actorUserId,now);return result;
  });
}

export async function cancelTransactionLinks(input:CancelTransactionLinksInput,actorUserId:string):Promise<TransactionLinkMutationResult>{
  if(!input||!nonempty(input.requestId)||input.requestId.length>200||!nonempty(input.reason)||!Array.isArray(input.linkIds)||!input.linkIds.length||input.linkIds.length>100||input.linkIds.some(id=>!nonempty(id)))throw invalid("요청 식별자·취소 대상·취소 사유가 필요합니다.");
  if(new Set(input.linkIds).size!==input.linkIds.length)throw invalid("취소 대상이 중복되었습니다.");if(!nonempty(actorUserId))throw invalid("실행자가 필요합니다.");const payloadHash=hash(input);
  return retryWrite(async db=>{await lockAccountingWrite(db);const previous=await priorRequest(db,input.requestId,'cancel',payloadHash);if(previous)return previous;
    await assertSupplyGroupPrerequisites(db,process.env.FINANCE_R1_SCHEMA??'public');
    const state=await loadTransactionLinkState(db),selected=state.links.filter(link=>input.linkIds.includes(link.id));if(selected.length!==input.linkIds.length)throw conflict("취소할 연결을 찾을 수 없습니다.");
    const changedJournalSources=new Set(selected.map(link=>`${link.leftSnapshot.journalKind}:${link.leftSnapshot.journalId}`));
    await assertMutableSources(db,state,selected.flatMap(link=>[link.left,link.right]),selected.flatMap(link=>[link.leftSnapshot,link.rightSnapshot]),changedJournalSources);
    const now=new Date().toISOString();for(const link of selected){if(link.state==='cancelled')continue;
      await db.run("UPDATE transaction_links SET state='cancelled',cancelled_by=$2,cancelled_at=$3,cancel_reason=$4 WHERE link_id=$1 AND state='active'",[link.id,actorUserId,now,input.reason.trim()]);
      link.state='cancelled';link.cancelledAt=now;link.cancelReason=input.reason.trim();link.valid=true;link.issues=[];
      await db.run("INSERT INTO transaction_link_history(history_id,link_id,action,request_id,actor_user_id,reason,snapshot,created_at)VALUES($1,$2,'cancel',$3,$4,$5,$6,$7)",[`tlh-${randomUUID()}`,link.id,input.requestId,actorUserId,input.reason.trim(),JSON.stringify(link),now]);
    }
    const result={links:selected,requestId:input.requestId,replayed:false};await rememberRequest(db,input,'cancel',payloadHash,result,actorUserId,now);return result;
  });
}

/** Legacy reconciliation cannot mutate the bank state while a new explicit allocation is active. */
export async function assertNoActiveBankTransactionLinks(db:PgDatabase,txnIds:string[]):Promise<void>{
  if(!txnIds.length)return;
  const rows=rowsToObjects(await db.exec("SELECT left_id FROM transaction_links WHERE left_kind='bank' AND left_id=ANY($1::text[]) AND state='active' LIMIT 1",[txnIds]));
  if(rows.length)throw conflict("새 거래 연결에서 배부한 은행 건입니다. 해당 연결을 먼저 검토·취소한 뒤 기존 수금 대조를 변경하세요.");
}
export async function listTransactionLinks(params:{from?:string;to?:string}={}):Promise<TransactionLinkState & {expenseAccounts:Array<{accountCode:string;name:string}>}>{
  if(params.from||params.to)validateAccountingRange(params.from??'1000-01-01',params.to??'9999-12-31');
  return withDbWrite(async db=>{const state=await loadTransactionLinkState(db);
  const expenseAccounts=rowsToObjects(await db.exec("SELECT account_code,name FROM journal_accounts WHERE acct_type='expense' AND is_active=1 ORDER BY sort_order,account_code")).map(r=>({accountCode:String(r.account_code),name:String(r.name)}));
  // Linked sources remain available outside the visible period for meaningful review/cancellation.
  const linked=new Set(state.links.flatMap(l=>[transactionSourceKey(l.left),transactionSourceKey(l.right)]));
  if(params.from||params.to)state.sources=state.sources.filter(s=>linked.has(s.key)||(s.date>=(params.from??'1000-01-01')&&s.date<=(params.to??'9999-12-31')));
  return {...state,expenseAccounts};},{accountingSnapshot:true});
}
