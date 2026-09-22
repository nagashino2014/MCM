import { recordAuditLogInline } from '@/lib/auth/audit';
import { rowsToObjects, withDbRead, withDbWrite, type PgDatabase } from '@/lib/db';
import { vatHashV2 } from './vat-canonical-v2';
import { assertAccountingRangeOpen, lockAccountingWrite } from './write-lock';
import { assertJournalUsePrerequisites } from './journal-use-prerequisites';
import type { JournalUseListPage, JournalUsePlan, JournalUsePreview, JournalUseResult } from './journal-use-types';

type DbError = { code?: string; status?: number; constraint?: string; message?: string };
const fail = (message: string, status = 400, code = 'journal_use_input') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('전표 사용 근거를 검증할 수 없습니다. 설치 구조와 보관 자료를 확인하세요.', 503, 'journal_use_unavailable');
const id = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw fail(`${label}을(를) 확인하세요.`);
  return value;
};
const schema = () => process.env.FINANCE_R1_SCHEMA ?? 'public';
function value<T>(result: Awaited<ReturnType<PgDatabase['exec']>>): T {
  const raw = result[0]?.values[0]?.[0];
  if (raw === undefined) throw unavailable();
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}
function mapped(error: unknown): never {
  const e = error as DbError;
  if ([400, 403, 404, 409, 503].includes(e.status ?? 0)) throw error;
  if (e.code === '23514' && e.constraint === 'finance_journal_use_period_closed') {
    throw fail('마감된 연도의 전표 사용입니다. 먼저 해당 연도의 마감을 해제한 뒤 다시 처리하세요.', 409, 'journal_use_period_closed');
  }
  if (['23503', '23505', '23514'].includes(e.code ?? '')) throw fail('전표·원천·사용 상태가 변경됐습니다. 최신 내용을 다시 확인하세요.', 409, 'journal_use_conflict');
  if (e.code === '55000') throw unavailable();
  throw error;
}
function checkedPlan(raw: JournalUsePlan, vatUseId: string): JournalUsePlan {
  if (!raw || raw.version !== 'finance-journal-use-plan-v1' || raw.vatUseId !== vatUseId || !/^[0-9a-f]{64}$/.test(raw.planHash)
    || !Array.isArray(raw.entries) || !raw.entries.length || raw.entries.some(row => !Number.isSafeInteger(row.effectNo)
      || !Number.isSafeInteger(row.supply) || !Number.isSafeInteger(row.tax) || !Number.isSafeInteger(row.total)
      || row.supply + row.tax !== row.total || !/^[0-9a-f]{64}$/.test(row.projectionHash) || !/^[0-9a-f]{64}$/.test(row.sourceHash))) throw unavailable();
  return raw;
}
async function prepare(db: PgDatabase, vatUseId: string): Promise<JournalUsePreview> {
  await assertJournalUsePrerequisites(db, schema());
  const plan = checkedPlan(value<JournalUsePlan>(await db.exec('SELECT finance_journal_use_plan($1)', [vatUseId])), vatUseId);
  const totals = plan.entries.reduce((sum, row) => ({ entries: sum.entries + 1, supply: sum.supply + row.supply, tax: sum.tax + row.tax, total: sum.total + row.total }), { entries: 0, supply: 0, tax: 0, total: 0 });
  if (![totals.supply, totals.tax, totals.total].every(Number.isSafeInteger) || totals.supply + totals.tax !== totals.total) throw unavailable();
  return { status: 'ready', plan, totals };
}
async function readRequest(requestId: string, action: 'apply' | 'release', actor: string, payloadHash: string): Promise<JournalUseResult | null> {
  return withDbRead(async db => {
    await assertJournalUsePrerequisites(db, schema());
    const row = rowsToObjects(await db.exec('SELECT action,actor_user_id,payload_hash,result_json FROM finance_journal_use_requests WHERE request_id=$1', [requestId]))[0];
    if (!row) return null;
    if (row.action !== action || row.actor_user_id !== actor || row.payload_hash !== payloadHash) throw fail('같은 요청 식별자에 다른 내용 또는 담당자가 있습니다.', 409, 'journal_use_request_conflict');
    const result = (typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json) as JournalUseResult;
    return { ...result, replayed: true };
  });
}

export async function previewJournalUse(vatUse: unknown): Promise<JournalUsePreview> {
  const vatUseId = id(vatUse, '부가세 사용 식별자');
  try { return await withDbRead(db => prepare(db, vatUseId)); } catch (error) { mapped(error); }
}

export async function applyJournalUse(input: unknown, actorUserId: string): Promise<JournalUseResult> {
  const raw = input as Record<string, unknown>, vatUseId = id(raw?.vatUseId, '부가세 사용 식별자');
  const expectedPlanHash = id(raw?.expectedPlanHash, '미리보기 지문'), requestId = id(raw?.requestId, '요청 식별자'), actor = id(actorUserId, '담당자');
  if (!/^[0-9a-f]{64}$/.test(expectedPlanHash)) throw fail('미리보기 지문을 확인하세요.');
  const payloadHash = vatHashV2({ action: 'apply', vatUseId, expectedPlanHash, requestId });
  const replay = await readRequest(requestId, 'apply', actor, payloadHash); if (replay) return replay;
  for (let attempt = 0; ; attempt++) try {
    return await withDbWrite(async db => {
      await lockAccountingWrite(db); await assertJournalUsePrerequisites(db, schema());
      const preview = await prepare(db, vatUseId);
      if (preview.plan.planHash !== expectedPlanHash) throw fail('미리보기 뒤 원천 또는 전표가 변경됐습니다.', 409, 'journal_use_preview_stale');
      await assertAccountingRangeOpen(db, preview.plan.periodFrom, preview.plan.periodTo);
      const result = value<JournalUseResult>(await db.exec('SELECT finance_journal_use_apply($1,$2,$3,$4,$5)', [vatUseId, expectedPlanHash, requestId, actor, payloadHash]));
      if (!result.replayed) await recordAuditLogInline(db, { actorUserId: actor, action: 'finance_journal_use', targetTable: 'finance_journal_uses', targetId: result.journalUseId, after: { ...result, entries: preview.totals.entries } });
      return result;
    }, { accountingSnapshot: true });
  } catch (error) {
    if (['40001', '40P01'].includes((error as DbError).code ?? '') && attempt < 2) continue;
    mapped(error);
  }
}

export async function releaseJournalUse(input: unknown, actorUserId: string): Promise<JournalUseResult> {
  const raw = input as Record<string, unknown>, journalUseId = id(raw?.journalUseId, '전표 사용 식별자');
  const reason = id(raw?.reason, '해제 사유'), requestId = id(raw?.requestId, '요청 식별자'), actor = id(actorUserId, '담당자');
  if (reason.length < 5 || reason.length > 1000) throw fail('해제 사유는 5자 이상 1,000자 이하로 입력하세요.');
  const payloadHash = vatHashV2({ action: 'release', journalUseId, reason, requestId });
  const replay = await readRequest(requestId, 'release', actor, payloadHash); if (replay) return replay;
  for (let attempt = 0; ; attempt++) try {
    return await withDbWrite(async db => {
      await lockAccountingWrite(db); await assertJournalUsePrerequisites(db, schema());
      const result = value<JournalUseResult>(await db.exec('SELECT finance_journal_use_release($1,$2,$3,$4,$5)', [journalUseId, reason, requestId, actor, payloadHash]));
      if (!result.replayed) await recordAuditLogInline(db, { actorUserId: actor, action: 'finance_journal_use', targetTable: 'finance_journal_uses', targetId: journalUseId, before: { status: result.releaseSourceStatus ?? 'applied' }, after: { status: 'released', releaseId: result.releaseId, reason, releaseSourceStatus: result.releaseSourceStatus } });
      return result;
    }, { accountingSnapshot: true });
  } catch (error) {
    if (['40001', '40P01'].includes((error as DbError).code ?? '') && attempt < 2) continue;
    mapped(error);
  }
}

export async function listJournalUsePage(subject: unknown, requestedVatUseIds: unknown[] = []): Promise<JournalUseListPage> {
  const subjectId = id(subject, '신고 주체');
  const vatUseIds = [...new Set(requestedVatUseIds.map(value => id(value, '부가세 사용 식별자')))];
  if (vatUseIds.length > 100) throw fail('한 번에 조회할 전표 사용은 100건 이하여야 합니다.');
  try {
    return await withDbRead(async db => {
      await assertJournalUsePrerequisites(db, schema());
      const result = value<JournalUseListPage>(vatUseIds.length
        ? await db.exec('SELECT finance_journal_use_lookup($1,$2::text[])', [subjectId, vatUseIds])
        : await db.exec('SELECT finance_journal_use_list($1)', [subjectId]));
      if (!result || !Array.isArray(result.uses) || typeof result.limited !== 'boolean'
        || result.uses.some(row => row.subjectId !== subjectId || !['applied', 'stale', 'released'].includes(row.status))) throw unavailable();
      return result;
    });
  } catch (error) { mapped(error); }
}

// Preserve the library contract used by accounting jobs and existing tests.
// HTTP callers use listJournalUsePage so a capped company-wide result is explicit.
export async function listJournalUses(subject: unknown, requestedVatUseIds: unknown[] = []) {
  return (await listJournalUsePage(subject, requestedVatUseIds)).uses;
}
