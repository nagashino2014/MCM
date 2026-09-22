import { randomUUID } from 'node:crypto';
import { rowsToObjects, type PgDatabase } from '@/lib/db';
import { recordAuditLogInline } from '@/lib/auth/audit';
import type { VatReturnForm } from './vat-return';
import type { VatFollowupApplication } from './vat-followup-review-types';
import type { VatFollowupSelection, VatFollowupCalculation, VatFollowupConsumptionTarget, ValidatedVatFollowupConsumptionPlan } from './vat-followup-consumption-types';
import { vatHashV2, vatTextHash } from './vat-canonical-v2';

const fail = (message: string, status = 409, code = 'vat_followup_consumption_conflict') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('후행 검토의 계산·소비 구조를 검증할 수 없습니다. 마이그레이션236과 저장 근거를 확인하세요.', 503, 'vat_followup_consumption_unavailable');
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
const json = (value: unknown): string => JSON.stringify(stable(value));
const validHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const closed = (value: unknown, keys: string[]): boolean => !!value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const entry = Object.getOwnPropertyDescriptor(value, key);
    return !!entry?.enumerable && Object.hasOwn(entry, 'value');
  });
const reference = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200;

export async function assertVatFollowupConsumptionStructure(db: PgDatabase): Promise<void> {
  try {
    const r = rowsToObjects(await db.exec(`SELECT to_regclass('vat_followup_legacy_archives') IS NOT NULL AS archives,
      to_regprocedure('vat_followup_consumption_version()') IS NOT NULL AS version,
      to_regprocedure('vat_followup_hash_v2(jsonb)') IS NOT NULL AS hash`))[0];
    if (!r?.archives || !r.version || !r.hash) throw unavailable();
    if (rowsToObjects(await db.exec('SELECT vat_followup_consumption_version() AS version'))[0]?.version !== 'vat-followup-consumption-v2') throw unavailable();
    await db.exec('SELECT basis_confirmation_id,legacy_archive_id,calculation_hash,created_by FROM vat_followup_review_consumptions WHERE false');
  } catch (e) {
    if (['40001', '40P01'].includes(String((e as { code?: string }).code))) throw e;
    throw unavailable();
  }
}

export async function prepareVatFollowupConsumption(db: PgDatabase, application: VatFollowupApplication, selection: VatFollowupSelection): Promise<ValidatedVatFollowupConsumptionPlan> {
  await assertVatFollowupConsumptionStructure(db);
  const { loadVatFollowupConsumptionPlan } = await import('./vat-followup-review');
  try { return await loadVatFollowupConsumptionPlan(db, application, selection); }
  catch (e) {
    if (['42P01', '42703', '42883', '55000'].includes(String((e as { code?: string }).code))) throw unavailable();
    throw e;
  }
}

/** 원문 문자열과 새 proof 정규화는 별개 계약이다. 소수 필드를 정수로 바꾸지 않는다. */
export function vatFollowupBaseProjection(form: VatReturnForm): unknown {
  const { generatedAt: _generated, warnings: _warnings, ledgerSnapshot, filingBasis, followupConsumption: _followup, sameSupplyConsumption: _same, ...calculation } = form;
  if (filingBasis) {
    const { calculationHash: _hash, ...basis } = filingBasis;
    return { ...calculation, filingBasis: {...basis, ...(basis.version === 'vat-return-basis-v3' ? {version:'vat-return-basis-v2'} : {})}, ledgerRows: ledgerSnapshot?.rows };
  }
  return { ...calculation, ledgerRows: ledgerSnapshot?.rows };
}
export function vatFollowupCalculationProof(value: VatFollowupCalculation): unknown {
  return {
    version: 'vat-followup-calculation-v2', baseCalculationHash: value.baseCalculationHash, planHash: value.planHash,
    applicationHash: vatHashV2(value.application),
    pairs: value.pairs.map(p => ({ revisionId: p.revisionId, pairLineNo: p.pairLineNo, pairKey: p.pairKey,
      payloadHash: p.payloadHash, priorClaimedTax: p.priorClaimedTax, currentClaimableTax: p.currentClaimableTax })),
  };
}
export async function attachVatFollowupCalculation(form: VatReturnForm, plan: ValidatedVatFollowupConsumptionPlan): Promise<void> {
  if (form.filingBasis) form.filingBasis.version = 'vat-return-basis-v2';
  const baseCalculationText = json(vatFollowupBaseProjection(form));
  const planText = json({ application: plan.application, pairs: plan.pairs });
  const value: VatFollowupCalculation = { version: 'vat-followup-consumption-v2', canonicalVersion: 'vat-canonical-v2',
    application: structuredClone(plan.application), pairs: structuredClone(plan.pairs), baseCalculationText,
    baseCalculationHash: vatTextHash(baseCalculationText), planText, planHash: vatTextHash(planText), calculationHash: '' };
  value.calculationHash = vatHashV2(vatFollowupCalculationProof(value));
  form.followupConsumption = value;
  if (form.filingBasis) form.filingBasis.calculationHash = value.calculationHash;
  assertVatFollowupCalculation(form);
}

/** 저장 v2의 무결성을 확인한다. 현재 원천 재검증은 동일 트랜잭션의 prepare에서 수행한다. */
export function assertVatFollowupCalculation(form: VatReturnForm): VatFollowupCalculation {
  try {
    const c = form.followupConsumption;
    if (!c || !closed(c, ['version', 'canonicalVersion', 'application', 'pairs', 'baseCalculationText', 'baseCalculationHash', 'planText', 'planHash', 'calculationHash'])
      || !closed(c.application, ['subjectId', 'year', 'term', 'kind', 'path', 'basisSnapshotId', 'collectorCorpNum', 'subjectRevisionId', 'subjectHash', 'dateFrom', 'dateTo', 'priorFrom', 'priorTo', 'currentFrom'])
      || c.version !== 'vat-followup-consumption-v2' || c.canonicalVersion !== 'vat-canonical-v2'
      || !Array.isArray(c.pairs) || c.pairs.length < 1 || c.pairs.length > 100 || !validHash(c.calculationHash)
      || !reference(c.application.subjectId) || !reference(c.application.subjectRevisionId) || !validHash(c.application.subjectHash)
      || !/^\d{10}$/.test(c.application.collectorCorpNum) || !['basis', 'legacy'].includes(c.application.path)
      || c.application.path === 'legacy' && c.application.basisSnapshotId !== null
      || c.application.path === 'legacy' && Object.hasOwn(form, 'filingBasis')
      || c.application.path === 'basis' && !reference(c.application.basisSnapshotId)
      || c.application.kind !== 'final' || form.period.kind !== 'final' || c.application.year !== form.period.year || c.application.term !== form.period.term
      || c.application.dateFrom !== form.period.from || c.application.dateTo !== form.period.to
      || (c.application.path === 'basis') !== !!form.filingBasis
      || form.filingBasis && (!['vat-return-basis-v2','vat-return-basis-v3'].includes(form.filingBasis.version) || form.filingBasis.basisSnapshotId !== c.application.basisSnapshotId
        || form.filingBasis.subjectId !== c.application.subjectId || form.filingBasis.version === 'vat-return-basis-v2' && form.filingBasis.calculationHash !== c.calculationHash)) throw unavailable();
    if (json(vatFollowupBaseProjection(form)) !== c.baseCalculationText || vatTextHash(c.baseCalculationText) !== c.baseCalculationHash) throw unavailable();
    if (json({ application: c.application, pairs: c.pairs }) !== c.planText || vatTextHash(c.planText) !== c.planHash) throw unavailable();
    if (vatHashV2(vatFollowupCalculationProof(c)) !== c.calculationHash) throw unavailable();
    const keys = new Set<string>(), positions = new Set<string>();
    let previous: VatFollowupCalculation['pairs'][number] | undefined;
    for (const p of c.pairs) {
      if (!closed(p, ['reviewId', 'revisionId', 'pairLineNo', 'pairKey', 'payloadHash', 'pair', 'priorClaimedTax', 'currentClaimableTax'])
        || !reference(p.reviewId) || !reference(p.revisionId)
        || !validHash(p.pairKey) || !validHash(p.payloadHash) || !Number.isSafeInteger(p.pairLineNo) || p.pairLineNo < 0 || p.pairLineNo > 99
        || p.pairKey !== p.pair.pairKey || !Number.isSafeInteger(p.priorClaimedTax) || p.priorClaimedTax <= 0
        || !Number.isSafeInteger(p.currentClaimableTax) || p.currentClaimableTax <= 0
        || p.priorClaimedTax !== p.pair.past.claim.claimedTax
        || p.currentClaimableTax !== (p.pair.historicalSide === 'card' ? p.pair.invoice.claimTax : p.pair.card.claimTax)
        || !['card', 'invoice'].includes(p.pair.historicalSide) || p.pair.issues.length !== 0
        || p.pair.past.origin !== c.application.path || keys.has(p.pairKey) || positions.has(`${p.revisionId}:${p.pairLineNo}`)
        || previous && (Buffer.compare(Buffer.from(previous.revisionId), Buffer.from(p.revisionId)) > 0
          || previous.revisionId === p.revisionId && previous.pairLineNo >= p.pairLineNo)) throw unavailable();
      keys.add(p.pairKey);
      positions.add(`${p.revisionId}:${p.pairLineNo}`);
      previous = p;
    }
    return c;
  } catch { throw unavailable(); }
}
export function selectionFromVatFollowupForm(form: VatReturnForm): VatFollowupSelection | undefined {
  if (!form.followupConsumption) return undefined;
  const c = assertVatFollowupCalculation(form);
  return { subjectId: c.application.subjectId, pairs: c.pairs.map(p => ({ revisionId: p.revisionId, pairKey: p.pairKey })) };
}

/** 확정·정확한 쌍 소비·감사는 호출자의 한 트랜잭션에서 완료된다. */
export async function persistVatFollowupConsumption(db: PgDatabase, form: VatReturnForm, target: VatFollowupConsumptionTarget, actor: string): Promise<void> {
  if (!form.followupConsumption) return;
  const { assertSupplyGroupPrerequisites } = await import('./supply-group-prerequisites');
  await assertSupplyGroupPrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public');
  await assertVatFollowupConsumptionStructure(db);
  const c = assertVatFollowupCalculation(form);
  if (c.application.path !== target.path || form.blockingIssues.length) throw fail('검토가 끝난 신고 경로와 정확한 확정 대상을 확인하세요.');
  let archiveId: string | null = null;
  if (target.path === 'legacy') {
    archiveId = `vfla-${randomUUID()}`;
    const archived = rowsToObjects(await db.exec(`INSERT INTO vat_followup_legacy_archives
      (archive_id,return_id,schema_version,calculation_hash,form_json,row_json,created_by)
      SELECT $1,r.return_id,'vat-return-legacy-v2',$3,r.form_json,to_jsonb(r),$4 FROM vat_returns r
      WHERE r.return_id=$2 AND r.status='confirmed' RETURNING archive_id`, [archiveId, target.returnId, c.calculationHash, actor]));
    if (archived.length !== 1) throw fail('확정된 내부 신고 원문을 보관할 수 없습니다.');
  }
  for (const p of c.pairs) {
    await db.run(`INSERT INTO vat_followup_review_consumptions
      (consumption_id,revision_id,pair_line_no,payload_json,basis_confirmation_id,legacy_archive_id,calculation_hash,created_by)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`, [`vfc-${randomUUID()}`, p.revisionId, p.pairLineNo, JSON.stringify(p),
      target.path === 'basis' ? target.confirmationId : null, archiveId, form.filingBasis?.version==='vat-return-basis-v3' ? form.filingBasis.calculationHash : c.calculationHash, actor]);
  }
  await recordAuditLogInline(db, { actorUserId: actor, action: 'vat_return_confirm', targetTable: 'vat_followup_review_consumptions', targetId: target.returnId,
    after: { path: target.path, calculationHash: c.calculationHash, pairs: c.pairs.map(p => ({ revisionId: p.revisionId, pairKey: p.pairKey })), legacyArchiveId: archiveId } });
}
