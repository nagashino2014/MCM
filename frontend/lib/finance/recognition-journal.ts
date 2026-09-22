import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { rowsToObjects, type PgDatabase } from '@/lib/db';
import { buildExactRecognitionDraft } from './journal';
import { journalConflict, sourceFingerprint, validateJournalDrafts } from './journal-source';
import type { TransactionLinkState } from './transaction-links';
import { assertAccountingDatesOpen } from './write-lock';
import { assertVatFilingSourcesMutable } from './vat-filing-protection';

export interface RecognitionJournalEntryRow {
  entry_id: string; entry_date: string; source_kind: string; source_id: string;
  description: string | null; party_name: string | null; status: string; doc_id: string | null;
  confirmed_by: string | null; confirmed_at: string | null; memo: string | null;
  created_at: string; updated_at: string | null;
}
export interface RecognitionJournalLineRow {
  line_id: string; entry_id: string; line_no: number; account_code: string;
  debit: number; credit: number; memo: string | null;
}
export interface RecognitionJournalSnapshotRow {
  entry_id: string; snapshot_version: 1; source_hash: string;
  source_json: unknown; captured_at: string;
}
export interface RecognitionJournalRows {
  entry: RecognitionJournalEntryRow;
  lines: RecognitionJournalLineRow[];
  snapshot: RecognitionJournalSnapshotRow;
}
export interface RecognitionJournalExecution extends RecognitionJournalRows { schemaVersion: 1 }
export interface RecognitionJournalPlan {
  recognitionId: string;
  targetEntryId: string;
  before: RecognitionJournalRows;
  executionResult: RecognitionJournalExecution;
}

const hashId = (prefix: string, value: string) => `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0,12)}`;
const unavailable = (message: string) => Object.assign(new Error(message), {status:503,code:'recognition_review_unavailable'});
// 계획은 같은 caller DB에서 만든 바로 그 객체만 쓸 수 있다. HTTP 입력이나
// 사후에 수정한 실행결과를 SQL 쓰기 계획으로 승격하지 않는다.
const prepared = new WeakMap<RecognitionJournalPlan, {db:PgDatabase; plan:RecognitionJournalPlan; dates:string[]}>();

async function readExactRows(db: PgDatabase, entryId: string, sourceId: string): Promise<RecognitionJournalRows | null> {
  const entries = rowsToObjects(await db.exec(`SELECT entry_id FROM journal_entries
    WHERE entry_id=$1 OR (source_kind='hometax_invoice' AND source_id=$2) ORDER BY entry_id FOR UPDATE`, [entryId,sourceId]));
  if (!entries.length) return null;
  if (entries.length !== 1 || entries[0].entry_id !== entryId) throw journalConflict('기존 전표 식별자가 예상한 대표 전표와 다릅니다.');
  await db.exec('SELECT line_id FROM journal_lines WHERE entry_id=$1 ORDER BY line_no,line_id FOR UPDATE', [entryId]);
  await db.exec('SELECT entry_id FROM journal_source_snapshots WHERE entry_id=$1 FOR UPDATE', [entryId]);
  const rows = rowsToObjects(await db.exec(`SELECT jsonb_build_object(
    'entry',to_jsonb(e),
    'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no,l.line_id) FROM journal_lines l WHERE l.entry_id=e.entry_id),'[]'::jsonb),
    'snapshot',(SELECT to_jsonb(s) FROM journal_source_snapshots s WHERE s.entry_id=e.entry_id)) AS value
    FROM journal_entries e WHERE e.entry_id=$1`, [entryId]));
  if (rows.length !== 1 || !rows[0].value) throw unavailable('전표 보관 행을 읽을 수 없습니다.');
  return rows[0].value as RecognitionJournalRows;
}

/** 상위 서비스가 accounting transaction/공통 잠금/원천·227 잠금을 소유한다.
 * supplied state는 서버가 검증한 after 인식 한 건을 교체한 메모리 후보다.
 * 이 함수는 실제 builder와 같은 DB의 SELECT만 사용하고 업무 행을 쓰지 않는다. */
export async function prepareRecognitionJournal(db: PgDatabase, input: {
  state: TransactionLinkState; recognitionId: string; createdAt: string;
}): Promise<RecognitionJournalPlan> {
  if (typeof input.createdAt !== 'string' || !input.createdAt || input.createdAt.length > 100) throw unavailable('서버 실행시각이 필요합니다.');
  const recognition = input.state.recognitions.find(row => row.id === input.recognitionId);
  if (!recognition?.review) throw unavailable('적용할 인식 검토판 근거가 필요합니다.');
  const draft = await buildExactRecognitionDraft(db,input.state,input.recognitionId);
  const source = input.state.sources.find(row => row.ref.kind === recognition.source.kind && row.ref.id === recognition.source.id)!;
  const accounts = new Set(rowsToObjects(await db.exec('SELECT account_code FROM journal_accounts WHERE is_active=1')).map(row => String(row.account_code)));
  validateJournalDrafts([draft],accounts);
  const entryId = hashId('je',`${draft.sourceKind}:${draft.sourceId}`);
  const before = await readExactRows(db,entryId,draft.sourceId);
  if (!before || !before.snapshot || before.lines.length < 2) throw journalConflict('기존 전표·라인·생성 근거가 있는 인식만 재검토할 수 있습니다.');
  if (before.entry.source_kind !== draft.sourceKind || before.entry.source_id !== draft.sourceId
    || before.entry.entry_date !== draft.entryDate || !['auto','pending'].includes(before.entry.status)) {
    throw journalConflict('기존 전표의 대표·일자·상태가 재검토 가능한 조건과 다릅니다.');
  }
  const dates = [...new Set([draft.entryDate,source.taxDate,recognition.sourceSnapshot.date,recognition.sourceSnapshot.taxDate])];
  await assertAccountingDatesOpen(db,dates);
  await assertVatFilingSourcesMutable(db,{dates,refs:[{kind:'hometax',id:draft.sourceId}]});
  const fingerprint = sourceFingerprint(draft,draft.entryDate,draft.sourceEvidence);
  const executionResult: RecognitionJournalExecution = {
    schemaVersion:1,
    entry:{entry_id:entryId,entry_date:draft.entryDate,source_kind:draft.sourceKind,source_id:draft.sourceId,
      description:draft.description,party_name:draft.partyName,status:draft.status,doc_id:draft.docId??null,
      confirmed_by:null,confirmed_at:null,memo:null,created_at:input.createdAt,updated_at:null},
    lines:draft.lines.map((line,index) => ({line_id:hashId('jl',`${entryId}:${index+1}`),entry_id:entryId,line_no:index+1,
      account_code:line.accountCode,debit:line.debit,credit:line.credit,memo:line.memo??null})),
    snapshot:{entry_id:entryId,snapshot_version:1,source_hash:fingerprint.hash,source_json:fingerprint.source,captured_at:input.createdAt},
  };
  const plan: RecognitionJournalPlan = {recognitionId:input.recognitionId,targetEntryId:entryId,before,executionResult};
  prepared.set(plan,{db,plan:structuredClone(plan),dates});
  return plan;
}

/** revision INSERT/227 CAS 뒤 호출한다. transaction·pool·별도 audit를 만들지 않는다.
 * 해당 entry 하나만 바꾸며 반환값은 INSERT 입력이 아니라 실제 DB readback이다. */
export async function writeRecognitionJournal(db: PgDatabase, plan: RecognitionJournalPlan): Promise<RecognitionJournalExecution> {
  const trusted = prepared.get(plan);
  if (!trusted || trusted.db !== db || !isDeepStrictEqual(plan,trusted.plan)) throw unavailable('같은 거래에서 준비한 변경되지 않은 전표 계획이 필요합니다.');
  const expected = trusted.plan.executionResult;
  const before = await readExactRows(db,plan.targetEntryId,expected.entry.source_id);
  if (!isDeepStrictEqual(before,trusted.plan.before)) throw journalConflict('전표 계획 이후 기존 전표가 변경되었습니다. 다시 검토하세요.');
  await assertAccountingDatesOpen(db,trusted.dates);
  await assertVatFilingSourcesMutable(db,{dates:trusted.dates,refs:[{kind:'hometax',id:expected.entry.source_id}]});
  const removed = rowsToObjects(await db.exec(`DELETE FROM journal_entries
    WHERE entry_id=$1 AND source_kind='hometax_invoice' AND source_id=$2 AND status IN ('auto','pending') RETURNING entry_id`,
    [plan.targetEntryId,expected.entry.source_id]));
  if (removed.length !== 1) throw journalConflict('교체할 기존 전표가 없어졌거나 보호 상태로 변경되었습니다.');
  const e = expected.entry;
  await db.run(`INSERT INTO journal_entries(entry_id,entry_date,source_kind,source_id,description,party_name,status,doc_id,confirmed_by,confirmed_at,memo,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [e.entry_id,e.entry_date,e.source_kind,e.source_id,e.description,e.party_name,e.status,e.doc_id,e.confirmed_by,e.confirmed_at,e.memo,e.created_at,e.updated_at]);
  for (const line of expected.lines) await db.run(`INSERT INTO journal_lines(line_id,entry_id,line_no,account_code,debit,credit,memo)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[line.line_id,line.entry_id,line.line_no,line.account_code,line.debit,line.credit,line.memo]);
  const s = expected.snapshot;
  await db.run(`INSERT INTO journal_source_snapshots(entry_id,snapshot_version,source_hash,source_json,captured_at) VALUES($1,$2,$3,$4,$5)`,
    [s.entry_id,s.snapshot_version,s.source_hash,JSON.stringify(s.source_json),s.captured_at]);
  const actual = await readExactRows(db,plan.targetEntryId,expected.entry.source_id);
  if (!actual) throw unavailable('저장된 대상 전표를 찾을 수 없습니다.');
  const executionResult: RecognitionJournalExecution = {schemaVersion:1,...actual};
  if (!isDeepStrictEqual(executionResult,expected)) throw unavailable('계획한 전표·라인·생성 근거와 실제 저장 결과가 다릅니다.');
  prepared.delete(plan);
  return executionResult;
}
