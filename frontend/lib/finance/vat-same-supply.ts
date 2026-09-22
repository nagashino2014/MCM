import { rowsToObjects, type PgDatabase } from '@/lib/db';
import type { VatReturnForm } from './vat-return';
import type { VatClaimSource } from './vat-duplicate-review';
import type { VatSameSupplySelection, VatSameSupplyPlan, VatSameSupplyCalculation } from './vat-same-supply-types';
import { vatHashV2, vatTextHash } from './vat-canonical-v2';
import { assertVatUsePrerequisites } from './vat-use-prerequisites';

export type { VatSameSupplySelection, VatSameSupplyPlan, VatSameSupplyCalculation } from './vat-same-supply-types';
const fail = (message: string, status = 409, code = 'vat_same_supply_conflict') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('같은 공급의 부가세 사용 근거를 검증할 수 없습니다. 적용 구조와 저장 자료를 확인하세요.', 503, 'vat_same_supply_unavailable');
const ref = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const closed = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
const json = (v: unknown) => JSON.stringify(stable(v));
const key = (s: Pick<VatClaimSource, 'kind' | 'sourceId'>) => `${s.kind}:${s.sourceId}`;

export function parseSameSupplySelection(value: unknown): VatSameSupplySelection {
  if (!closed(value, ['version', 'subjectId', 'reviews'])) throw fail('같은 공급 검토의 정확한 판을 선택하세요.', 400, 'vat_same_supply_input');
  const v = value as VatSameSupplySelection;
  if (v.version !== 'vat-same-supply-selection-v1' || !ref(v.subjectId) || !Array.isArray(v.reviews) || v.reviews.length < 1 || v.reviews.length > 100
    || v.reviews.some(r => !closed(r, ['kind', 'caseId', 'revisionId']) || !['same', 'group'].includes(r.kind) || !ref(r.caseId) || !ref(r.revisionId))
    || new Set(v.reviews.map(r => `${r.kind}:${r.caseId}`)).size !== v.reviews.length) throw fail('같은 공급 검토의 판 또는 선택 범위를 확인하세요.', 400, 'vat_same_supply_input');
  return structuredClone(v);
}
export async function prepareSameSupplyPlan(db: PgDatabase, basisSnapshotId: string, selection: VatSameSupplySelection): Promise<VatSameSupplyPlan> {
  const input = parseSameSupplySelection(selection);
  try {
    await assertVatUsePrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public');
    const row = rowsToObjects(await db.exec('SELECT finance_vat_use_plan($1,$2::jsonb) AS plan', [basisSnapshotId, JSON.stringify(input.reviews)]))[0];
    const plan = (typeof row?.plan === 'string' ? JSON.parse(row.plan) : row?.plan) as VatSameSupplyPlan;
    assertSameSupplyPlan(plan);
    if (plan.subjectId !== input.subjectId || plan.basisSnapshotId !== basisSnapshotId) throw fail('선택한 검토와 신고 회사 기준이 다릅니다.');
    return plan;
  } catch (e) {
    const code = String((e as { code?: string }).code);
    if (['42P01', '42703', '42883', '55000'].includes(code)) throw unavailable();
    if (['23514', '23503', '23505'].includes(code)) throw fail('같은 공급의 원천·검토가 변경됐거나 첫 지원 범위에 맞지 않습니다. 최신 검토와 공제·귀속 판정을 확인하세요.');
    throw e;
  }
}
export async function sameSupplyLaterDiagnostics(db: PgDatabase, subjectId: string, from: string, to: string): Promise<Array<{sourceId:string;reason:string}>> {
  try {
    await assertVatUsePrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public');
    const row = rowsToObjects(await db.exec('SELECT finance_vat_use_diagnostics($1,$2,$3) AS issues', [subjectId,from,to]))[0];
    const value = typeof row?.issues === 'string' ? JSON.parse(row.issues) : row?.issues;
    if (!Array.isArray(value) || value.some(r => !r || typeof r.sourceId !== 'string' || typeof r.reason !== 'string')) throw unavailable();
    const messages: Record<string,string> = {
      same_supply_later_approval: '같은 공급으로 사용한 카드와 승인번호·일시가 같은 추가 승인이 수집됐습니다. 기존 확정본은 유지됩니다. 중복 또는 변경 내역인지 원천을 대조한 후 신고 정정을 검토하세요.',
      same_supply_later_cancellation: '같은 공급으로 공제를 조정한 카드에 새 취소 내역이 수집됐습니다. 과거 확정본을 보존하고 해당 신고의 후행 정정을 검토하세요. 자동 차감하지 않습니다.',
      same_supply_later_correction: '같은 공급으로 사용한 계산서에 새 수정계산서가 수집됐습니다. 과거 공제와 수정계보를 확인한 후 신고 정정을 검토하세요.',
      same_supply_correction_lineage_unknown: '같은 공급자의 수정계산서가 수집됐지만 원 계산서와의 관계가 확인되지 않았습니다. 이 자료를 보존하고 수정계보를 확인하세요.',
    };
    return value.map(r=>{if(!messages[r.reason])throw unavailable();return{sourceId:r.sourceId,reason:messages[r.reason]};});
  } catch(e) {
    if (['40001','40P01'].includes(String((e as {code?:string}).code))) throw e;
    throw unavailable();
  }
}
export function assertSameSupplyPlan(plan: VatSameSupplyPlan): void {
  if (!plan || plan.version !== 'vat-same-supply-plan-v1' || !ref(plan.basisSnapshotId) || !ref(plan.subjectId)
    || !ref(plan.taxpayerKey) || !hash(plan.scopeHash) || !hash(plan.planHash)
    || !Array.isArray(plan.effects) || plan.effects.length < 2 || !Array.isArray(plan.selections) || plan.selections.length < 1
    || !/^\d{4}-\d{2}-\d{2}$/.test(plan.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(plan.dateTo)) throw unavailable();
  const { planHash, ...body } = plan;
  if (vatHashV2(body) !== planHash) throw unavailable();
  const seen = new Set<string>(), whole = new Set<string>();
  for (const e of plan.effects) {
    if (!['hometax_invoice', 'card'].includes(e.sourceType) || !ref(e.sourceId) || !ref(e.wholeId) || !ref(e.documentId) || !ref(e.observationId)
      || !ref(e.canonicalKey) || !ref(e.representativeSourceId) || !hash(e.rawSourceHash) || !ref(e.sourceHashVersion)
      || e.taxDate < plan.dateFrom || e.taxDate > plan.dateTo
      || [e.rawSupplyAmount, e.rawTaxAmount, e.rawTotalAmount].some(n => !Number.isSafeInteger(n) || n <= 0)
      || e.rawSupplyAmount + e.rawTaxAmount !== e.rawTotalAmount
      || e.claimedSupplyAmount !== (e.sourceType === 'card' ? 0 : e.rawSupplyAmount)
      || e.claimedTaxAmount !== (e.sourceType === 'card' ? 0 : e.rawTaxAmount)
      || e.suppressedSupplyAmount !== e.rawSupplyAmount - e.claimedSupplyAmount || e.suppressedTaxAmount !== e.rawTaxAmount - e.claimedTaxAmount
      || seen.has(`${e.sourceType}:${e.sourceId}`) || whole.has(e.wholeId)) throw unavailable();
    seen.add(`${e.sourceType}:${e.sourceId}`); whole.add(e.wholeId);
  }
  for (const invoice of plan.effects.filter(e => e.sourceType === 'hometax_invoice')) {
    const cards = plan.effects.filter(e => e.sourceType === 'card' && e.representativeSourceId === invoice.sourceId);
    if (invoice.representativeSourceId !== invoice.sourceId || cards.length < 1 || cards.length > 20
      || cards.reduce((n, e) => n + e.rawSupplyAmount, 0) !== invoice.rawSupplyAmount
      || cards.reduce((n, e) => n + e.rawTaxAmount, 0) !== invoice.rawTaxAmount) throw unavailable();
  }
  if (plan.effects.some(e => e.sourceType === 'card' && !plan.effects.some(i => i.sourceType === 'hometax_invoice' && i.sourceId === e.representativeSourceId))) throw unavailable();
}

/** Match raw deductible populations, before any amount is suppressed. */
export function validateSameSupplyClaims(plan: VatSameSupplyPlan, claims: VatClaimSource[], prior: VatClaimSource[]): void {
  assertSameSupplyPlan(plan);
  for (const e of plan.effects) {
    const matches = claims.filter(s => s.kind === (e.sourceType === 'card' ? 'card' : 'hometax') && s.sourceId === e.sourceId);
    if (matches.length !== 1) throw fail('선택한 문서가 현재 신고의 공제 모집단에 정확히 한 번 포함되지 않습니다. 공제·귀속·기공제 여부를 확인하세요.');
    const s = matches[0];
    if (s.date !== e.taxDate || s.supply !== e.rawSupplyAmount || s.tax !== e.rawTaxAmount || s.total !== e.rawTotalAmount
      || s.canonicalKey !== e.canonicalKey
      || prior.some(p => key(p) === key(s) || p.canonicalKey === s.canonicalKey)) throw fail('선택한 문서의 금액·귀속 또는 과거 공제 내역이 사용 계획과 다릅니다.');
  }
}
export function sameSupplyResolvesPair(plan: VatSameSupplyPlan, card: VatClaimSource, invoice: VatClaimSource): boolean {
  if (card.origin !== 'current' || invoice.origin !== 'current') return false;
  return plan.effects.some(e => e.sourceType === 'card' && e.sourceId === card.sourceId && e.representativeSourceId === invoice.sourceId)
    && plan.effects.some(e => e.sourceType === 'hometax_invoice' && e.sourceId === invoice.sourceId);
}

/** The candidate graph still contains every raw card; only the financial result changes. */
export function applySameSupplyAmounts(form: VatReturnForm, plan: VatSameSupplyPlan, rawClaims: VatClaimSource[]): void {
  validateSameSupplyClaims(plan, rawClaims, form.filingBasis?.priorClaims ?? []);
  const cards = new Set(plan.effects.filter(e => e.sourceType === 'card').map(e => e.sourceId));
  const effective = rawClaims.map(s => cards.has(s.sourceId) && s.kind === 'card' ? { ...s, supply: 0, tax: 0 } : { ...s });
  const kept = effective.filter(s => s.kind === 'card' && !cards.has(s.sourceId));
  form.purchases.cardDeductible = { count: kept.length, supply: kept.reduce((n, s) => n + s.supply, 0), tax: kept.reduce((n, s) => n + s.tax, 0) };
  const merchants = new Map<string, VatReturnForm['cardByMerchant'][number]>();
  for (const s of kept) {
    const id = s.partyCorpNum || '-', item = merchants.get(id) ?? { corpNum: id, name: s.partyName, count: 0, supply: 0, tax: 0 };
    if (Buffer.compare(Buffer.from(s.partyName),Buffer.from(item.name)) < 0) item.name = s.partyName;
    item.count++; item.supply += s.supply; item.tax += s.tax; merchants.set(id, item);
  }
  form.cardByMerchant = [...merchants.values()].sort((a, b) => b.supply - a.supply || a.corpNum.localeCompare(b.corpNum));
  form.purchases.totalDeductibleTax = form.purchases.invoiceGeneral.tax - form.purchases.nonDeductible.tax - form.purchases.invoiceUndecided.tax + form.purchases.cardDeductible.tax;
  form.taxDue = form.sales.total.tax - form.purchases.totalDeductibleTax;
  const due = form.taxDue + form.manual.reduce((n, f) => n + (f.key === 'penalty' ? f.amount : -f.amount), 0) - (form.filingBasis?.noticeDeduction ?? 0);
  form.finalTaxDue = due > 0 ? Math.floor(due / 10) * 10 : due;
  form.recon.reportDeductibleTax = form.purchases.totalDeductibleTax + (form.filingBasis?.priorReportedClaimedTax ?? 0);
  form.recon.vatInDiff = form.recon.reportDeductibleTax - form.recon.journalVatInDebit;
  if (form.duplicateReview) form.duplicateReview.claimSources = effective;
  form.warnings.push('같은 공급의 카드 세액을 신고에서 조정했습니다. 전표에는 적용하지 않았으므로 원장과의 차이를 별도로 확인하세요.');
}

export function sameSupplyBaseProjection(form: VatReturnForm): unknown {
  const { generatedAt: _generated, warnings: _warnings, ledgerSnapshot, filingBasis, sameSupplyConsumption: _same, ...calculation } = form;
  const { calculationHash: _hash, ...basis } = filingBasis ?? {};
  return { ...calculation, filingBasis: basis, ledgerRows: ledgerSnapshot?.rows };
}
export function sameSupplyCalculationProof(c: VatSameSupplyCalculation): unknown {
  return { version: 'vat-same-supply-calculation-v1', baseCalculationHash: c.baseCalculationHash, planHash: c.plan.planHash,
    rawClaimsHash: vatHashV2(c.rawClaims), claimEffectsHash: vatHashV2(c.claimEffects) };
}
export function attachSameSupplyCalculation(form: VatReturnForm, plan: VatSameSupplyPlan, rawClaims: VatClaimSource[]): void {
  if (!form.filingBasis) throw unavailable();
  form.filingBasis.version = 'vat-return-basis-v3';
  const baseCalculationText = json(sameSupplyBaseProjection(form));
  const c: VatSameSupplyCalculation = { version: 'vat-same-supply-consumption-v1', canonicalVersion: 'vat-canonical-v2',
    plan: structuredClone(plan), rawClaims: structuredClone(rawClaims), claimEffects: structuredClone(plan.effects),
    baseCalculationText, baseCalculationHash: vatTextHash(baseCalculationText), calculationHash: '', journalDependencies: [], journalUseStatus: 'not_applied' };
  c.calculationHash = vatHashV2(sameSupplyCalculationProof(c));
  form.sameSupplyConsumption = c; form.filingBasis.calculationHash = c.calculationHash;
  assertSameSupplyCalculation(form);
}
export function assertSameSupplyCalculation(form: VatReturnForm): VatSameSupplyCalculation {
  try {
    const c = form.sameSupplyConsumption, b = form.filingBasis;
    if (!c || !b || b.version !== 'vat-return-basis-v3' || form.period.kind !== 'final'
      || !closed(c, ['version', 'canonicalVersion', 'plan', 'rawClaims', 'claimEffects', 'baseCalculationText', 'baseCalculationHash', 'calculationHash', 'journalDependencies', 'journalUseStatus'])
      || c.version !== 'vat-same-supply-consumption-v1' || c.canonicalVersion !== 'vat-canonical-v2' || c.journalUseStatus !== 'not_applied'
      || !Array.isArray(c.journalDependencies) || c.journalDependencies.length || !Array.isArray(c.rawClaims)
      || b.basisSnapshotId !== c.plan.basisSnapshotId || b.subjectId !== c.plan.subjectId || b.scopeHash !== c.plan.scopeHash
      || form.period.from !== c.plan.dateFrom || form.period.to !== c.plan.dateTo
      || b.calculationHash !== c.calculationHash || json(c.claimEffects) !== json(c.plan.effects)) throw unavailable();
    validateSameSupplyClaims(c.plan, c.rawClaims, b.priorClaims);
    if (new Set(c.rawClaims.map(key)).size !== c.rawClaims.length || c.rawClaims.some(s => !hash(s.sourceHash)
      || !['card', 'hometax'].includes(s.kind) || !ref(s.sourceId) || !ref(s.canonicalKey)
      || ![s.supply, s.tax, s.total].every(Number.isSafeInteger) || s.origin !== 'current')) throw unavailable();
    if (json(sameSupplyBaseProjection(form)) !== c.baseCalculationText || vatTextHash(c.baseCalculationText) !== c.baseCalculationHash
      || vatHashV2(sameSupplyCalculationProof(c)) !== c.calculationHash) throw unavailable();
    const clone = structuredClone(form);
    applySameSupplyAmounts(clone, c.plan, c.rawClaims);
    for (const field of ['purchases', 'taxDue', 'finalTaxDue', 'cardByMerchant', 'recon', 'duplicateReview'] as const) {
      if (json(clone[field]) !== json(form[field])) throw unavailable();
    }
    return c;
  } catch { throw unavailable(); }
}
export function selectionFromSameSupplyForm(form: VatReturnForm): VatSameSupplySelection | undefined {
  if (!form.sameSupplyConsumption) return undefined;
  const c = assertSameSupplyCalculation(form);
  return { version: 'vat-same-supply-selection-v1', subjectId: c.plan.subjectId,
    reviews: c.plan.selections.map(({ kind, caseId, revisionId }) => ({ kind, caseId, revisionId })) };
}
export async function persistSameSupplyConsumption(db: PgDatabase, form: VatReturnForm, confirmationId: string, actor: string): Promise<void> {
  if (!form.sameSupplyConsumption) return;
  assertSameSupplyCalculation(form);
  await db.exec('SELECT finance_vat_use_persist($1,$2)', [confirmationId, actor]);
}
