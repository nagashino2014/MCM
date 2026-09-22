import { createHash } from "node:crypto";

/** B1 is evidence/scope resolution only. It does not calculate VAT or certify a live source population. */
export const VAT_FILING_SCOPE_VERSION = "g03b-r01-b1-v1" as const;
export type VatFilingTerm = 1 | 2;
export interface PeriodCoverage { from: string; to: string }
export interface SourceCoverage {
  sourceKind: string;
  sourceId: string;
  canonicalKey: string;
  sourceHash: string;
  direction: "sales" | "purchase";
  supply: number;
  tax: number;
  claimedTax: number;
  date: string;
}
export interface SubjectRevision {
  subjectId: string;
  revisionId: string;
  version: number;
  corpNum: string;
  state: "unknown" | "verified";
  effectiveFrom: string;
  effectiveTo: string | null;
  mode: "unknown" | "preliminary" | "notice";
  entityType: "corporation" | "individual" | "unknown";
  vatRegime: "general" | "simplified" | "exempt" | "unknown";
  filingUnit: "single_business_place" | "business_unit" | "consolidated_payment" | "unknown";
  evidenceRef: string | null;
  evidenceHash: string | null;
}
export interface FilingCoverageTotals {
  salesSupply: number;
  salesTax: number;
  purchaseSupply: number;
  purchaseTax: number;
  claimedTax: number;
}
export interface FactDataBase {
  /** Stable official document identity, not the request UUID or upload filename. */
  externalKey: string;
  amountSemantics: "total_replacement" | "delta";
  supersedesRevisionId: string | null;
}
export interface PriorFilingCheck {
  priorFilingStatus: "none" | "unknown";
  priorFilingEvidenceRef: string | null;
  priorFilingEvidenceHash: string | null;
}
export interface NoticeData extends FactDataBase, PriorFilingCheck {
  noticeNumber: string;
  noticeDate: string;
  previousPeriodSupply: number | null;
  /** Full payment reconciliation; unknown is never equivalent to zero paid. */
  paymentState: "unknown" | "complete";
  paymentEvidenceRef: string | null;
  paymentEvidenceHash: string | null;
}
export interface NoNoticeData extends FactDataBase, PriorFilingCheck {
  reason: "below_minimum" | "official_other";
  previousPeriodSupply: number | null;
  previousAdjustedTax: number | null;
  reasonDetail: string;
}
export interface FilingData extends FactDataBase {
  filingType: "preliminary" | "final" | "early_refund" | "amended" | "late" | "correction_claim";
  /** Required for late/amended claims when the document name alone does not identify the underlying return. */
  returnType?: "preliminary" | "final" | "early_refund";
  receiptNumber: string;
  receiptDate: string;
  sourceReconciliation: "unknown" | "partial" | "complete";
  declaredTotals: FilingCoverageTotals | null;
  isNilReturn: boolean;
  nilEvidenceRef: string | null;
  nilEvidenceHash: string | null;
}
export interface PaymentData extends FactDataBase {
  targetNoticeFactId: string;
  paidAt: string;
}
export interface RefundData extends FactDataBase {
  targetFilingFactId: string;
  stage: "claimed" | "received" | "unrefunded";
  eventDate: string;
}
interface FactRevisionBase {
  factId: string;
  revisionId: string;
  version: number;
  state: "recorded" | "verified" | "withdrawn";
  subjectId: string;
  year: number;
  term: VatFilingTerm;
  from: string;
  to: string;
  amount: number | null;
  evidenceRef: string | null;
  evidenceHash: string | null;
  periodCoverage: PeriodCoverage[];
  sourceCoverage: SourceCoverage[];
}
export type FactRevision = FactRevisionBase & (
  | { kind: "notice"; data: NoticeData }
  | { kind: "no_notice"; data: NoNoticeData }
  | { kind: "filing"; data: FilingData }
  | { kind: "payment"; data: PaymentData }
  | { kind: "refund"; data: RefundData }
);
export interface VatFilingScopeInput {
  subject: SubjectRevision;
  /** All selected-subject history, including withdrawn and superseded revisions. */
  facts: FactRevision[];
  year: number;
  term: VatFilingTerm;
  kind: "preliminary" | "final";
  /** Verified collector identity; null cannot be replaced by the subject number. */
  collectionCorpNum: string | null;
}
export interface VatFilingScopeIssue { code: string; message: string; factId?: string; revisionId?: string }
export interface VatFilingScopeResult {
  version: typeof VAT_FILING_SCOPE_VERSION;
  schemaVersion: "vat-filing-basis-v1";
  status: "ready" | "blocked";
  canCalculate: boolean;
  verificationBoundary: "declared_evidence_only_live_sources_not_checked";
  year: number;
  term: VatFilingTerm;
  kind: "preliminary" | "final";
  subjectId: string;
  subjectRevisionId: string;
  mode: SubjectRevision["mode"];
  legalPeriod: PeriodCoverage;
  populationPeriod: PeriodCoverage;
  dateFrom: string;
  dateTo: string;
  /** Never subtract this period blindly: only excludedSources are reconciled source claims. */
  priorPeriodCoverage: PeriodCoverage[];
  excludedSources: SourceCoverage[];
  noticeDeduction: number | null;
  noticeFactId: string | null;
  payment: { state: "unknown" | "complete"; paidPrincipal: number | null; outstandingPrincipal: number | null };
  effectiveFactRevisionIds: string[];
  consumptions: Array<{ factId: string; revisionId: string; kind: "notice" | "refund" | "filing"; amount: number }>;
  evidenceSnapshot: { subject: SubjectRevision; facts: FactRevision[]; collectionCorpNum: string | null };
  issues: VatFilingScopeIssue[];
  scopeHash: string;
}

export class VatFilingScopeValidationError extends Error {
  readonly status = 400;
  constructor(message: string) { super(message); this.name = "VatFilingScopeValidationError"; }
}

const fail = (message: string): never => { throw new VatFilingScopeValidationError(message); };
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}: 객체가 필요합니다.`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  const unsupported = Object.keys(value).filter(key => !keys.includes(key));
  if (unsupported.length) fail(`${label}: 지원하지 않는 필드가 있습니다: ${unsupported.slice(0, 5).join(", ")}`);
};
const textValue = (value: unknown, label: string, max = 2000, allowEmpty = false): string => {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label}: 올바른 문자열이 필요합니다.`);
  return (value as string).trim();
};
const nullableText = (value: unknown, label: string, max = 2000): string | null => value === null ? null : textValue(value, label, max);
const enumValue = <T extends string>(value: unknown, choices: readonly T[], label: string): T => {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(`${label}: 지원하지 않는 값입니다.`);
  return value as T;
};
const integer = (value: unknown, label: string, minimum = -Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) fail(`${label}: 안전한 원 단위 정수가 필요합니다.`);
  return value as number;
};
const bool = (value: unknown, label: string): boolean => typeof value === "boolean" ? value : fail(`${label}: 참/거짓 값이 필요합니다.`);
const nullableInteger = (value: unknown, label: string, minimum = -Number.MAX_SAFE_INTEGER) => value === null ? null : integer(value, label, minimum);
const revisionNumber = (value: unknown, label: string) => { const result = integer(value, label, 1); if (result > 2147483647) fail(`${label}: 판번호 범위를 초과했습니다.`); return result; };
const day = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label}: YYYY-MM-DD 날짜가 필요합니다.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || (value as string) < "1900-01-01") fail(`${label}: 실제 달력 날짜가 필요합니다.`);
  return value as string;
};
const digestValue = (value: unknown, label: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) fail(`${label}: SHA-256 지문이 필요합니다.`);
  return (value as string).toLowerCase();
};
const evidence = (ref: unknown, hash: unknown, label: string, required = false) => {
  const evidenceRef = nullableText(ref, `${label}.evidenceRef`);
  const evidenceHash = digestValue(hash, `${label}.evidenceHash`);
  if ((evidenceRef === null) !== (evidenceHash === null) || (required && evidenceRef === null)) fail(`${label}: 증빙 참조와 지문을 함께 제공해야 합니다.`);
  return { evidenceRef, evidenceHash };
};
const list = (value: unknown, label: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}: 최대 ${maximum}개 배열이 필요합니다.`);
  return value as unknown[];
};
const range = (from: unknown, to: unknown, label: string): PeriodCoverage => {
  const result = { from: day(from, `${label}.from`), to: day(to, `${label}.to`) };
  if (result.from > result.to) fail(`${label}: 시작일이 종료일보다 늦습니다.`);
  return result;
};
const inside = (outer: PeriodCoverage, inner: PeriodCoverage) => outer.from <= inner.from && outer.to >= inner.to;
const equalRange = (a: PeriodCoverage, b: PeriodCoverage) => a.from === b.from && a.to === b.to;
const overlaps = (a: PeriodCoverage, b: PeriodCoverage) => a.from <= b.to && b.from <= a.to;
const half = (year: number, term: VatFilingTerm): PeriodCoverage => ({ from: `${year}-${term === 1 ? "01" : "07"}-01`, to: `${year}-${term === 1 ? "06-30" : "12-31"}` });
const preliminary = (year: number, term: VatFilingTerm): PeriodCoverage => ({ from: `${year}-${term === 1 ? "01" : "07"}-01`, to: `${year}-${term === 1 ? "03" : "09"}-${term === 1 ? "31" : "30"}` });
const termValue = (value: unknown): VatFilingTerm => value === 1 || value === 2 ? value : fail("term: 숫자 1 또는 2가 필요합니다.");
const normalizedCorpNum = (value: unknown, allowUnknown = false): string => {
  if (allowUnknown && value === "") return "";
  if (typeof value !== "string" || !/^(\d{10}|\d{3}-\d{2}-\d{5})$/.test(value)) fail("corpNum: 10자리 사업자등록번호가 필요합니다.");
  const normalized = (value as string).replace(/-/g, "");
  if (/^0{10}$/.test(normalized)) fail("corpNum: 0으로만 된 번호를 사용할 수 없습니다.");
  return normalized;
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sortSources = (rows: SourceCoverage[]) => rows.sort((a, b) => compare(`${a.canonicalKey}\0${a.sourceKind}\0${a.sourceId}`, `${b.canonicalKey}\0${b.sourceKind}\0${b.sourceId}`));

export function validateSubject(value: unknown): SubjectRevision {
  const v = object(value, "subject");
  exactKeys(v, ["subjectId", "revisionId", "version", "corpNum", "state", "effectiveFrom", "effectiveTo", "mode", "entityType", "vatRegime", "filingUnit", "evidenceRef", "evidenceHash"], "subject");
  const state = enumValue(v.state, ["unknown", "verified"] as const, "subject.state");
  const effectiveFrom = day(v.effectiveFrom, "subject.effectiveFrom");
  const effectiveTo = v.effectiveTo === null ? null : day(v.effectiveTo, "subject.effectiveTo");
  if (effectiveTo !== null && effectiveTo < effectiveFrom) fail("subject: 적용 종료일이 시작일보다 늦거나 같아야 합니다.");
  return {
    subjectId: textValue(v.subjectId, "subject.subjectId", 200), revisionId: textValue(v.revisionId, "subject.revisionId", 200),
    version: revisionNumber(v.version, "subject.version"), corpNum: normalizedCorpNum(v.corpNum, state === "unknown"), state,
    effectiveFrom, effectiveTo,
    mode: enumValue(v.mode, ["unknown", "preliminary", "notice"] as const, "subject.mode"),
    entityType: enumValue(v.entityType, ["corporation", "individual", "unknown"] as const, "subject.entityType"),
    vatRegime: enumValue(v.vatRegime, ["general", "simplified", "exempt", "unknown"] as const, "subject.vatRegime"),
    filingUnit: enumValue(v.filingUnit, ["single_business_place", "business_unit", "consolidated_payment", "unknown"] as const, "subject.filingUnit"),
    ...evidence(v.evidenceRef, v.evidenceHash, "subject", state === "verified"),
  };
}

function validateSource(value: unknown, periods: PeriodCoverage[], label: string): SourceCoverage {
  const v = object(value, label);
  exactKeys(v, ["sourceKind", "sourceId", "canonicalKey", "sourceHash", "direction", "supply", "tax", "claimedTax", "date"], label);
  const row: SourceCoverage = {
    sourceKind: textValue(v.sourceKind, `${label}.sourceKind`, 100), sourceId: textValue(v.sourceId, `${label}.sourceId`, 200),
    canonicalKey: textValue(v.canonicalKey, `${label}.canonicalKey`, 500), sourceHash: digestValue(v.sourceHash, `${label}.sourceHash`) ?? fail(`${label}: 원천 지문이 필요합니다.`),
    direction: enumValue(v.direction, ["sales", "purchase"] as const, `${label}.direction`),
    supply: integer(v.supply, `${label}.supply`), tax: integer(v.tax, `${label}.tax`), claimedTax: integer(v.claimedTax, `${label}.claimedTax`), date: day(v.date, `${label}.date`),
  };
  if (!periods.some(p => p.from <= row.date && row.date <= p.to)) fail(`${label}: 원천 귀속일이 신고 기간 커버리지에 포함되지 않습니다.`);
  if (row.direction === "sales" && row.claimedTax !== 0) fail(`${label}: 매출에는 매입 공제세액을 지정할 수 없습니다.`);
  if (Math.abs(row.claimedTax) > Math.abs(row.tax) || (row.claimedTax !== 0 && Math.sign(row.claimedTax) !== Math.sign(row.tax))) fail(`${label}: 공제세액 부호 또는 한도가 잘못되었습니다.`);
  if (row.supply !== 0 && row.tax !== 0 && Math.sign(row.supply) !== Math.sign(row.tax)) fail(`${label}: 공급가액과 세액의 부호가 다릅니다.`);
  return row;
}

export function validateFact(value: unknown): FactRevision {
  const v = object(value, "fact");
  exactKeys(v, ["factId", "revisionId", "version", "state", "subjectId", "year", "term", "from", "to", "amount", "evidenceRef", "evidenceHash", "periodCoverage", "sourceCoverage", "kind", "data"], "fact");
  const kind = enumValue(v.kind, ["notice", "filing", "refund", "payment", "no_notice"] as const, "fact.kind");
  const state = enumValue(v.state, ["recorded", "verified", "withdrawn"] as const, "fact.state");
  const year = integer(v.year, "fact.year", 1900), term = termValue(v.term);
  if (year > 9999) fail("fact.year: 네 자리 연도가 필요합니다.");
  const period = range(v.from, v.to, "fact");
  if (!inside(half(year, term), period)) fail("fact: 귀속 기간과 연도·기수가 일치하지 않습니다.");
  const periodCoverage = list(v.periodCoverage, "fact.periodCoverage", 24).map((entry, index) => {
    const item = object(entry, `periodCoverage[${index}]`), p = range(item.from, item.to, `periodCoverage[${index}]`);
    exactKeys(item, ["from", "to"], `periodCoverage[${index}]`);
    if (!inside(period, p)) fail("fact.periodCoverage: 대상기간 밖의 범위입니다.");
    return p;
  }).sort((a, b) => compare(a.from, b.from));
  for (let i = 1; i < periodCoverage.length; i++) if (overlaps(periodCoverage[i - 1], periodCoverage[i])) fail("fact.periodCoverage: 기간이 중복됩니다.");
  const sourceCoverage = sortSources(list(v.sourceCoverage, "fact.sourceCoverage", 50000).map((row, index) => validateSource(row, periodCoverage, `sourceCoverage[${index}]`)));
  const seen = new Set<string>();
  for (const row of sourceCoverage) {
    const key = `${row.sourceKind}\0${row.sourceId}`;
    if (seen.has(key)) fail("fact.sourceCoverage: 같은 원천이 두 번 입력되었습니다.");
    seen.add(key);
  }
  const base: FactRevisionBase = {
    factId: textValue(v.factId, "fact.factId", 200), revisionId: textValue(v.revisionId, "fact.revisionId", 200), version: revisionNumber(v.version, "fact.version"),
    state, subjectId: textValue(v.subjectId, "fact.subjectId", 200), year, term, ...period,
    amount: nullableInteger(v.amount, "fact.amount"),
    ...evidence(v.evidenceRef, v.evidenceHash, "fact", state !== "recorded"), periodCoverage, sourceCoverage,
  };
  const d = object(v.data, "fact.data");
  const commonKeys = ["externalKey", "amountSemantics", "supersedesRevisionId"];
  const priorKeys = ["priorFilingStatus", "priorFilingEvidenceRef", "priorFilingEvidenceHash"];
  const dataKeys = kind === "notice" ? [...priorKeys, "noticeNumber", "noticeDate", "previousPeriodSupply", "paymentState", "paymentEvidenceRef", "paymentEvidenceHash"]
    : kind === "no_notice" ? [...priorKeys, "reason", "previousPeriodSupply", "previousAdjustedTax", "reasonDetail"]
    : kind === "filing" ? ["filingType", "returnType", "receiptNumber", "receiptDate", "sourceReconciliation", "declaredTotals", "isNilReturn", "nilEvidenceRef", "nilEvidenceHash"]
    : kind === "payment" ? ["targetNoticeFactId", "paidAt"] : ["targetFilingFactId", "stage", "eventDate"];
  exactKeys(d, [...commonKeys, ...dataKeys], "fact.data");
  const dataBase: FactDataBase = {
    externalKey: textValue(d.externalKey, "fact.data.externalKey", 300),
    amountSemantics: enumValue(d.amountSemantics, ["total_replacement", "delta"] as const, "fact.data.amountSemantics"),
    supersedesRevisionId: nullableText(d.supersedesRevisionId, "fact.data.supersedesRevisionId", 200),
  };
  if (dataBase.amountSemantics === "total_replacement" && kind !== "filing" && base.amount !== null && base.amount < 0) fail("fact.amount: 전체 금액은 음수가 될 수 없습니다.");
  if (kind !== "filing" && (sourceCoverage.length || periodCoverage.length)) fail("fact: 신고 사실에만 기간·원천 커버리지를 지정할 수 있습니다.");
  if (kind === "filing") {
    let declaredTotals: FilingCoverageTotals | null = null;
    if (d.declaredTotals !== null) {
      const totals = object(d.declaredTotals, "declaredTotals");
      exactKeys(totals, ["salesSupply", "salesTax", "purchaseSupply", "purchaseTax", "claimedTax"], "declaredTotals");
      declaredTotals = { salesSupply: integer(totals.salesSupply, "declaredTotals.salesSupply"), salesTax: integer(totals.salesTax, "declaredTotals.salesTax"), purchaseSupply: integer(totals.purchaseSupply, "declaredTotals.purchaseSupply"), purchaseTax: integer(totals.purchaseTax, "declaredTotals.purchaseTax"), claimedTax: integer(totals.claimedTax, "declaredTotals.claimedTax") };
    }
    const nil = evidence(d.nilEvidenceRef, d.nilEvidenceHash, "nilReturn");
    const data: FilingData = {
      ...dataBase, filingType: enumValue(d.filingType, ["preliminary", "final", "early_refund", "amended", "late", "correction_claim"] as const, "filingType"),
      ...(d.returnType === undefined ? {} : { returnType: enumValue(d.returnType, ["preliminary", "final", "early_refund"] as const, "returnType") }),
      receiptNumber: textValue(d.receiptNumber, "receiptNumber", 200), receiptDate: day(d.receiptDate, "receiptDate"),
      sourceReconciliation: enumValue(d.sourceReconciliation, ["unknown", "partial", "complete"] as const, "sourceReconciliation"), declaredTotals,
      isNilReturn: bool(d.isNilReturn, "isNilReturn"), nilEvidenceRef: nil.evidenceRef, nilEvidenceHash: nil.evidenceHash,
    };
    return { ...base, kind, data };
  }
  if (kind === "payment") return { ...base, kind, data: { ...dataBase, targetNoticeFactId: textValue(d.targetNoticeFactId, "targetNoticeFactId", 200), paidAt: day(d.paidAt, "paidAt") } };
  if (kind === "refund") return { ...base, kind, data: { ...dataBase, targetFilingFactId: textValue(d.targetFilingFactId, "targetFilingFactId", 200), stage: enumValue(d.stage, ["claimed", "received", "unrefunded"] as const, "refund.stage"), eventDate: day(d.eventDate, "refund.eventDate") } };
  const priorEvidence = evidence(d.priorFilingEvidenceRef, d.priorFilingEvidenceHash, "priorFiling");
  const prior: PriorFilingCheck = { priorFilingStatus: enumValue(d.priorFilingStatus, ["none", "unknown"] as const, "priorFilingStatus"), priorFilingEvidenceRef: priorEvidence.evidenceRef, priorFilingEvidenceHash: priorEvidence.evidenceHash };
  if (kind === "no_notice") return { ...base, kind, data: { ...dataBase, ...prior,
    reason: enumValue(d.reason, ["below_minimum", "official_other"] as const, "noNotice.reason"), previousPeriodSupply: nullableInteger(d.previousPeriodSupply, "previousPeriodSupply", 0),
    previousAdjustedTax: nullableInteger(d.previousAdjustedTax, "previousAdjustedTax", 0), reasonDetail: textValue(d.reasonDetail, "reasonDetail"),
  } };
  const payments = evidence(d.paymentEvidenceRef, d.paymentEvidenceHash, "paymentReconciliation");
  return { ...base, kind, data: { ...dataBase, ...prior,
    noticeNumber: textValue(d.noticeNumber, "noticeNumber", 200), noticeDate: day(d.noticeDate, "noticeDate"), previousPeriodSupply: nullableInteger(d.previousPeriodSupply, "previousPeriodSupply", 0),
    paymentState: enumValue(d.paymentState, ["unknown", "complete"] as const, "paymentState"), paymentEvidenceRef: payments.evidenceRef, paymentEvidenceHash: payments.evidenceHash,
  } };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
const scopeDigest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const sumSafe = (values: number[]): number | null => {
  const result = values.reduce((sum, n) => sum + BigInt(n), BigInt(0));
  return result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(-Number.MAX_SAFE_INTEGER) ? null : Number(result);
};
function completePeriodCoverage(periods: PeriodCoverage[], target: PeriodCoverage): boolean {
  if (!periods.length || periods[0].from !== target.from || periods[periods.length - 1].to !== target.to) return false;
  for (let i = 1; i < periods.length; i++) {
    const previousEnd = new Date(`${periods[i - 1].to}T00:00:00.000Z`);
    previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
    if (previousEnd.toISOString().slice(0, 10) !== periods[i].from) return false;
  }
  return true;
}

/** Pure, deterministic B1 contract. "ready" means the declared evidence is internally consistent, not an external filing or live-source audit. */
export function resolveVatFilingScope(value: unknown): VatFilingScopeResult {
  const input = object(value, "scope");
  exactKeys(input, ["subject", "facts", "year", "term", "kind", "collectionCorpNum"], "scope");
  const subject = validateSubject(input.subject);
  const facts = list(input.facts, "scope.facts", 10000).map(validateFact).sort((a, b) => compare(a.factId, b.factId) || a.version - b.version || compare(a.revisionId, b.revisionId));
  const year = integer(input.year, "scope.year", 1900);
  if (year > 9999) fail("scope.year: 네 자리 연도가 필요합니다.");
  const term = termValue(input.term), kind = enumValue(input.kind, ["preliminary", "final"] as const, "scope.kind");
  const collectionCorpNum = input.collectionCorpNum === null ? null : normalizedCorpNum(input.collectionCorpNum);
  const legalPeriod = half(year, term), prior = preliminary(year, term), populationPeriod = kind === "preliminary" ? prior : legalPeriod;
  const issues: VatFilingScopeIssue[] = [];
  const add = (code: string, message: string, fact?: FactRevision) => {
    const issue = { code, message, ...(fact ? { factId: fact.factId, revisionId: fact.revisionId } : {}) };
    if (!issues.some(i => canonical(i) === canonical(issue))) issues.push(issue);
  };
  if (![2025, 2026].includes(year)) add("unsupported_year", "B1은 2025·2026년 신고 근거만 지원합니다.");
  if (subject.state !== "verified" || subject.mode === "unknown") add("subject_unverified", "신고 주체와 예정신고·예정고지 방식을 증빙으로 확인해야 합니다.");
  if (subject.entityType !== "corporation" || subject.vatRegime !== "general" || subject.filingUnit !== "single_business_place") add("unsupported_subject", "B1은 단일 사업장의 일반과세 법인만 지원합니다. 다른 제도의 근거는 보존하고 별도 검토해야 합니다.");
  if (subject.effectiveFrom > populationPeriod.from || (subject.effectiveTo !== null && subject.effectiveTo < populationPeriod.to)) add("subject_period_boundary", "주체 적용기간이 신고 모집단 전체를 포함하지 않습니다. 개업·폐업·적용 변경의 기간 계산은 별도 검토가 필요합니다.");
  if (collectionCorpNum === null || collectionCorpNum !== subject.corpNum) add("collection_subject_mismatch", "수집 주체의 등록번호를 확인하고 신고 주체와 일치시켜야 합니다.");

  const relevantIds = new Set(facts.filter(f => f.year === year && f.term === term).map(f => f.factId));
  const relevant = facts.filter(f => relevantIds.has(f.factId));
  const byRevision = new Map<string, FactRevision>();
  for (const fact of facts) {
    if (byRevision.has(fact.revisionId) && (relevantIds.has(fact.factId) || relevantIds.has(byRevision.get(fact.revisionId)!.factId))) add("duplicate_revision", "서로 다른 입력이 같은 근거 버전 식별자를 사용합니다.", fact);
    byRevision.set(fact.revisionId, fact);
  }
  const groups = new Map<string, FactRevision[]>();
  for (const fact of relevant) {
    if (fact.subjectId !== subject.subjectId) add("fact_subject_mismatch", "다른 신고 주체의 근거가 선택되었습니다.", fact);
    const group = groups.get(fact.factId) ?? []; group.push(fact); groups.set(fact.factId, group);
  }
  const effective: FactRevision[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    for (let i = 0; i < group.length; i++) {
      const fact = group[i], previous = i === 0 ? null : group[i - 1];
      if (fact.kind !== first.kind || fact.subjectId !== first.subjectId || fact.year !== first.year || fact.term !== first.term || fact.data.externalKey !== first.data.externalKey) add("fact_identity_changed", "같은 사실 계보에서 종류·주체·귀속기간·외부 식별자가 달라졌습니다.", fact);
      if (fact.version !== i + 1 || fact.data.supersedesRevisionId !== (previous?.revisionId ?? null)) add("revision_chain_conflict", "원본부터 유효 말단까지 단일 연속 버전과 대체 연결이 필요합니다.", fact);
      if (fact.data.supersedesRevisionId !== null && byRevision.get(fact.data.supersedesRevisionId)?.factId !== fact.factId) add("revision_parent_mismatch", "근거 대체의 기준 버전이 없거나 다른 사실의 버전입니다.", fact);
    }
    const latest = group[group.length - 1];
    if (latest.state === "withdrawn") continue;
    effective.push(latest);
    if (latest.state !== "verified") add("fact_unverified", "기록된 사실의 증빙 검토가 완료되지 않았습니다.", latest);
    if (latest.data.amountSemantics === "delta") add("delta_requires_effective_total", "증감 명세는 보존하되 B1에서 자동 합산하지 않습니다. 기준본과 대사된 전체 유효 명세가 필요합니다.", latest);
  }
  const externalIdentities = new Map<string, Set<string>>();
  for (const fact of facts) {
    const keys = [`${fact.subjectId}\0${fact.kind}\0${fact.data.externalKey}`];
    if (fact.kind === "notice") keys.push(`${fact.subjectId}\0notice-number\0${fact.data.noticeNumber}`);
    if (fact.kind === "filing") keys.push(`${fact.subjectId}\0filing-receipt\0${fact.data.receiptNumber}`);
    for (const key of keys) { const ids = externalIdentities.get(key) ?? new Set<string>(); ids.add(fact.factId); externalIdentities.set(key, ids); }
  }
  for (const ids of externalIdentities.values()) if (ids.size > 1 && [...ids].some(id => relevantIds.has(id))) add("duplicate_external_fact", "동일 외부 문서가 둘 이상의 사실로 등록되어 있습니다. 요청 ID가 달라도 중복 소비할 수 없습니다.");

  const notices = effective.filter((f): f is FactRevision & { kind: "notice"; data: NoticeData } => f.kind === "notice");
  const noNotices = effective.filter((f): f is FactRevision & { kind: "no_notice"; data: NoNoticeData } => f.kind === "no_notice");
  const filings = effective.filter((f): f is FactRevision & { kind: "filing"; data: FilingData } => f.kind === "filing");
  const refunds = effective.filter(f => f.kind === "refund");
  for (const filing of filings) {
    if (filing.data.receiptDate < filing.to) add("filing_receipt_date_mismatch", "신고 대상기간이 끝나기 전의 접수일입니다. 문서 종류·대상기간·접수일을 확인해야 합니다.", filing);
    if (["preliminary", "final", "early_refund"].includes(filing.data.filingType) && filing.data.returnType && filing.data.returnType !== filing.data.filingType) add("filing_type_conflict", "신고 문서 종류와 본래 신고 유형이 다릅니다.", filing);
  }
  if (refunds.length || filings.some(f => f.data.filingType === "early_refund" || f.data.returnType === "early_refund")) add("early_refund_unsupported", "조기환급의 기간·원천 명세는 보존했습니다. 월별 신고 실적과 환급·미환급 잔액 계산은 B1에서 지원하지 않습니다.");
  if (filings.some(f => f.data.filingType === "correction_claim")) add("correction_claim_unsupported", "경정청구 접수만으로 유효 신고액을 바꿀 수 없습니다. 결정·경정 결과의 대사가 필요합니다.");

  let noticeDeduction: number | null = null, noticeFactId: string | null = null;
  let priorPeriodCoverage: PeriodCoverage[] = [], excludedSources: SourceCoverage[] = [];
  let payment: VatFilingScopeResult["payment"] = { state: "unknown", paidPrincipal: null, outstandingPrincipal: null };
  const consumptions: VatFilingScopeResult["consumptions"] = [];
  if (kind === "preliminary") {
    if (subject.mode === "notice") add("no_return_required", "예정고지 방식에서는 일반 예정신고를 생성하지 않습니다. 적법한 선택 예정신고의 근거와 적용 방식 변경을 먼저 확인해야 합니다.");
    else if (subject.mode === "preliminary") noticeDeduction = 0;
    if (notices.length) add("notice_mode_conflict", "유효 예정고지가 존재합니다. 예정신고 선택 및 고지 취소 근거를 확인해야 합니다.");
    if (filings.length) add("existing_filing_requires_reconciliation", "같은 과세기간에 외부 신고 근거가 존재합니다. 이미 신고한 실적과 후속 신고 종류를 확인해야 합니다.");
  } else if (subject.mode === "notice") {
    if (notices.length + noNotices.length !== 1) add("notice_basis_missing_or_conflicting", "유효 예정고지 또는 검증된 미징수 근거 하나가 필요합니다.");
    const basis = notices.length ? notices[0] : noNotices[0];
    if (basis) {
      if (!equalRange(basis, prior)) add("notice_period_mismatch", "예정고지·미징수 근거가 해당 기수의 예정기간과 정확히 일치해야 합니다.", basis);
      if (basis.data.priorFilingStatus !== "none" || !basis.data.priorFilingEvidenceRef || !basis.data.priorFilingEvidenceHash) add("prior_filing_check_missing", "해당 반기의 예정·조기신고가 없다는 조회·검토 증빙이 필요합니다.", basis);
      if (basis.data.previousPeriodSupply === null || basis.data.previousPeriodSupply >= 150000000) add("notice_eligibility_unverified", "직전 과세기간 공급가액이 1억 5천만 원 미만인 법인인지 확인해야 합니다.", basis);
      if (filings.length || relevant.some(f => f.kind === "filing" && f.state === "verified")) add("notice_prior_filing_conflict", "예정·조기신고 없음 주장과 외부 신고 이력이 충돌합니다. 철회만으로 실제 신고 이력을 지울 수 없습니다.", basis);
      if (basis.kind === "notice") {
        noticeFactId = basis.factId;
        if (basis.data.noticeDate < prior.to) add("notice_date_mismatch", "예정기간 종료 전 고지일입니다. 공식 고지의 대상기간과 일자를 확인해야 합니다.", basis);
        if (basis.amount === null || basis.amount < 500000 || basis.amount % 1000 !== 0) add("notice_amount_requires_review", "통상 예정고지의 금액·끝수 기준과 맞지 않습니다. 특별 변경 근거의 유효 금액은 별도 검토가 필요합니다.", basis);
        else { noticeDeduction = basis.amount; consumptions.push({ factId: basis.factId, revisionId: basis.revisionId, kind: "notice", amount: basis.amount }); }
        const paymentFacts = effective.filter((f): f is FactRevision & { kind: "payment"; data: PaymentData } => f.kind === "payment");
        const matching = paymentFacts.filter(f => f.data.targetNoticeFactId === basis.factId);
        for (const fact of paymentFacts) if (fact.data.targetNoticeFactId !== basis.factId) add("payment_notice_mismatch", "납부 내역이 현재 유효 고지와 연결되지 않습니다.", fact);
        if (basis.data.paymentState === "complete") {
          if (!basis.data.paymentEvidenceRef || !basis.data.paymentEvidenceHash) add("payment_reconciliation_evidence_missing", "납부 완료 범위의 증빙이 없어 납부 0원과 미확인을 구별할 수 없습니다.", basis);
          else if (matching.some(f => f.amount === null)) add("payment_amount_unknown", "납부 대사를 완료하려면 각 원금 납부액을 확인해야 합니다.", basis);
          else {
            const paid = sumSafe(matching.map(f => f.amount!));
            if (paid === null || basis.amount === null || paid < 0 || paid > basis.amount) add("payment_principal_mismatch", "고지 원금과 납부 배부액이 맞지 않습니다. 초과 납부·충당은 별도 대사가 필요합니다.", basis);
            else payment = { state: "complete", paidPrincipal: paid, outstandingPrincipal: basis.amount - paid };
          }
        }
      } else {
        if (basis.amount !== 0) add("no_notice_amount_invalid", "미징수 근거의 고지 차감액은 명시적 0원이어야 합니다.", basis);
        if (basis.data.reason !== "below_minimum") add("no_notice_exception_unsupported", "50만원 미만 외의 미징수 예외는 B1에서 별도 검토가 필요합니다.", basis);
        else if (basis.data.previousAdjustedTax === null) add("no_notice_base_unknown", "조정된 직전 납부세액을 확인해야 미징수 기준을 검증할 수 있습니다.", basis);
        else {
          const expected = (BigInt(basis.data.previousAdjustedTax) / BigInt(2000)) * BigInt(1000);
          if (expected >= BigInt(500000)) add("no_notice_threshold_mismatch", "직전 기준 세액으로 계산한 예정고지액이 미징수 금액 기준에 해당하지 않습니다.", basis);
          else noticeDeduction = 0;
        }
        if (effective.some(f => f.kind === "payment")) add("no_notice_payment_conflict", "미징수 근거와 같은 기간의 고지 납부 내역을 대사해야 합니다.", basis);
      }
    }
  } else if (subject.mode === "preliminary") {
    noticeDeduction = 0;
    if (notices.length) add("notice_mode_conflict", "유효 예정고지와 예정신고 적용 방식이 충돌합니다.");
    if (filings.length !== 1) add("prior_filing_missing_or_conflicting", "해당 예정기간의 유효 외부 신고 접수와 완전한 명세 하나가 필요합니다.");
    const filing = filings[0];
    if (filing) {
      priorPeriodCoverage = filing.periodCoverage;
      excludedSources = filing.sourceCoverage;
      const type = filing.data.returnType ?? (["preliminary", "final", "early_refund"].includes(filing.data.filingType) ? filing.data.filingType : null);
      if (type !== "preliminary" || !equalRange(filing, prior) || !completePeriodCoverage(filing.periodCoverage, prior)) add("prior_filing_period_incomplete", "예정신고 접수의 종류·기간 커버리지가 해당 예정기간 전체와 정확히 일치해야 합니다.", filing);
      if (filing.data.sourceReconciliation !== "complete" || filing.data.declaredTotals === null) add("source_reconciliation_incomplete", "접수 총액만으로 기공제를 판정할 수 없습니다. 매출·매입 원천 명세와 신고 합계의 대사가 필요합니다.", filing);
      else {
        const rows = filing.sourceCoverage, canonicalKeys = new Set<string>();
        for (const row of rows) { if (canonicalKeys.has(row.canonicalKey)) add("duplicate_canonical_source", "같은 경제적 원천을 나타내는 정규 식별자가 중복됩니다.", filing); canonicalKeys.add(row.canonicalKey); }
        const actual = { salesSupply: sumSafe(rows.filter(r => r.direction === "sales").map(r => r.supply)), salesTax: sumSafe(rows.filter(r => r.direction === "sales").map(r => r.tax)), purchaseSupply: sumSafe(rows.filter(r => r.direction === "purchase").map(r => r.supply)), purchaseTax: sumSafe(rows.filter(r => r.direction === "purchase").map(r => r.tax)), claimedTax: sumSafe(rows.filter(r => r.direction === "purchase").map(r => r.claimedTax)) };
        if ((Object.keys(actual) as Array<keyof FilingCoverageTotals>).some(key => actual[key] === null || actual[key] !== filing.data.declaredTotals![key])) add("source_totals_mismatch", "매출·매입 원천 공급가액/세액/공제액이 제출 명세의 선언 합계와 일치하지 않습니다.", filing);
        if (!rows.length && (!filing.data.isNilReturn || !filing.data.nilEvidenceRef || !filing.data.nilEvidenceHash)) add("nil_return_evidence_missing", "원천이 0건인 경우 실제 무실적 신고와 전체 범위 확인 증빙이 필요합니다.", filing);
        if (rows.length && filing.data.isNilReturn) add("nil_return_has_sources", "상쇄 합계가 0이어도 원천 실적이 있으면 무실적이 아닙니다.", filing);
        if (actual.claimedTax !== null) consumptions.push({ factId: filing.factId, revisionId: filing.revisionId, kind: "filing", amount: actual.claimedTax });
      }
    }
  }

  issues.sort((a, b) => compare(`${a.code}\0${a.factId ?? ""}\0${a.revisionId ?? ""}`, `${b.code}\0${b.factId ?? ""}\0${b.revisionId ?? ""}`));
  const ready = issues.length === 0;
  const result: Omit<VatFilingScopeResult, "scopeHash"> = {
    version: VAT_FILING_SCOPE_VERSION, schemaVersion: "vat-filing-basis-v1", status: ready ? "ready" : "blocked", canCalculate: ready, verificationBoundary: "declared_evidence_only_live_sources_not_checked",
    year, term, kind, subjectId: subject.subjectId, subjectRevisionId: subject.revisionId, mode: subject.mode,
    legalPeriod, populationPeriod, dateFrom: populationPeriod.from, dateTo: populationPeriod.to,
    priorPeriodCoverage, excludedSources, noticeDeduction: ready ? noticeDeduction : null, noticeFactId,
    payment, effectiveFactRevisionIds: effective.map(f => f.revisionId).sort(), consumptions: ready ? consumptions : [], issues,
    evidenceSnapshot: { subject, facts: relevant, collectionCorpNum },
  };
  // Validators rebuilt all objects; callers cannot mutate the original input to change this snapshot.
  return { ...result, scopeHash: scopeDigest(result) };
}
