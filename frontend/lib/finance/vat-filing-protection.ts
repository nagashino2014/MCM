import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { validateAccountingRange } from "./write-lock";
import type { FactRevision, SourceCoverage, VatFilingScopeResult } from "./vat-filing-scope";

export type VatFilingProtectionOrigin = "legacy_return" | "external_filing" | "basis_snapshot";
export interface VatFilingProtection {
  id: string;
  origin: VatFilingProtectionOrigin;
  from: string;
  to: string;
  status: "draft" | "confirmed";
  /** Existing impact consumers can inspect duplicateReview.claimSources for source identity. */
  form: Record<string, unknown>;
  subjectId?: string;
}
export interface VatFilingProtectionOptions {
  includeLegacyDrafts?: boolean;
  /** Limit use in newly protected writers without changing their legacy-only policy. */
  origins?: readonly VatFilingProtectionOrigin[];
}
export interface VatFilingSourceRef { kind: string; id: string }
const B1_TABLES = ["vat_filing_subjects", "vat_filing_subject_revisions", "vat_filing_facts", "vat_filing_fact_revisions",
  "vat_filing_document_keys", "vat_filing_basis_snapshots", "vat_filing_basis_consumptions", "vat_filing_requests"];

const unavailable = (detail: string) => Object.assign(
  new Error(`부가세 신고·소비 근거를 검증할 수 없어 변경을 보류합니다. ${detail}`),
  { status: 503, code: "vat_filing_verification_unavailable", verificationUnavailable: true },
);
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const object = (value: unknown, label: string): Record<string, unknown> => {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { throw unavailable(`${label}의 저장 JSON을 확인하세요.`); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unavailable(`${label}의 저장 구조를 확인하세요.`);
  return parsed as Record<string, unknown>;
};
const requiredText = (value: unknown, label: string): string => {
  if (!nonempty(value)) throw unavailable(`${label}이 없습니다.`);
  return value;
};
function range(from: unknown, to: unknown, label: string): { from: string; to: string } {
  const start = requiredText(from, `${label} 시작일`), end = requiredText(to, `${label} 종료일`);
  try { validateAccountingRange(start, end); } catch { throw unavailable(`${label}의 기간이 올바르지 않습니다.`); }
  return { from: start, to: end };
}
function sourceCoverage(value: unknown, label: string): SourceCoverage[] {
  if (!Array.isArray(value)) throw unavailable(`${label}의 원천 명세가 없습니다.`);
  for (const source of value) {
    const row = object(source, label);
    requiredText(row.sourceKind, `${label} 원천 종류`);
    requiredText(row.sourceId, `${label} 원천 식별자`);
    range(row.date, row.date, `${label} 원천`);
  }
  return value as SourceCoverage[];
}
function withClaimAdapter(value: Record<string, unknown>, sources: SourceCoverage[]): Record<string, unknown> {
  return { ...value, duplicateReview: { claimSources: sources.map(source => ({ ...source, kind: source.sourceKind })) } };
}

/**
 * Read using the caller's accounting-locked transaction. Never creates a connection or writes.
 * B1 retains every verified filing revision, even after withdrawal, until an explicit later
 * correction workflow defines release. A notice alone is not a previously filed claim.
 * Legacy source ownership is unknown: callers conservatively protect periods across subjects.
 */
export async function listVatFilingProtections(
  db: PgDatabase,
  options: VatFilingProtectionOptions = {},
): Promise<VatFilingProtection[]> {
  try {
    const structure = rowsToObjects(await db.exec("SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name", [B1_TABLES]));
    if (B1_TABLES.some(name => !structure.some(row => row.name === name && row.present === true))) {
      throw unavailable("B1 신고 근거 마이그레이션 229의 필수 8개 테이블이 준비되지 않았습니다.");
    }
    // Read all required structures even if an origin filter is supplied: missing B1 schema
    // must not look like "no protected evidence" to an existing source writer.
    const legacy = rowsToObjects(await db.exec(
      "SELECT return_id,date_from::text AS date_from,date_to::text AS date_to,status,form_json FROM vat_returns ORDER BY date_from,return_id",
    ));
    const filings = rowsToObjects(await db.exec(`SELECT r.revision_id,r.fact_id,r.subject_id,r.kind,r.state,
      r.period_year,r.period_term,r.date_from::text AS date_from,r.date_to::text AS date_to,r.payload_json,
      f.fact_id AS parent_fact_id,f.subject_id AS parent_subject_id,f.kind AS parent_kind,f.external_key
      FROM vat_filing_fact_revisions r LEFT JOIN vat_filing_facts f ON f.fact_id=r.fact_id
      WHERE r.kind='filing' AND r.state='verified' ORDER BY r.date_from,r.revision_id`));
    const bases = rowsToObjects(await db.exec(`SELECT snapshot_id,subject_id,date_from::text AS date_from,
      date_to::text AS date_to,scope_json,schema_version,created_at
      FROM vat_filing_basis_snapshots ORDER BY date_from,snapshot_id`));
    const protections: VatFilingProtection[] = [];
    for (const row of legacy) {
      if (options.origins && !options.origins.includes("legacy_return")) continue;
      const id = requiredText(row.return_id, "기존 신고 식별자");
      if (row.status !== "draft" && row.status !== "confirmed") throw unavailable(`기존 신고 ${id}의 상태를 확인하세요.`);
      const dates = range(row.date_from, row.date_to, `기존 신고 ${id}`);
      const form = object(row.form_json, `기존 신고 ${id}`);
      if (row.status === "confirmed" || options.includeLegacyDrafts) protections.push({ id, origin: "legacy_return", ...dates, status: row.status, form });
    }
    for (const row of filings) {
      const id = requiredText(row.revision_id, "외부 신고 판 식별자"), subjectId = requiredText(row.subject_id, "외부 신고 주체");
      if (row.fact_id !== row.parent_fact_id || subjectId !== row.parent_subject_id || row.parent_kind !== "filing" || !nonempty(row.external_key)) {
        throw unavailable(`외부 신고 ${id}의 원본 사건과 주체를 확인하세요.`);
      }
      const dates = range(row.date_from, row.date_to, `외부 신고 ${id}`);
      const payload = object(row.payload_json, `외부 신고 ${id}`) as unknown as FactRevision;
      if (payload.kind !== "filing" || payload.state !== "verified" || payload.revisionId !== id || payload.factId !== row.fact_id
        || payload.subjectId !== subjectId || payload.from !== dates.from || payload.to !== dates.to
        || payload.year !== Number(row.period_year) || payload.term !== Number(row.period_term)
        || payload.data?.externalKey !== row.external_key) throw unavailable(`외부 신고 ${id}의 행과 저장 근거가 일치하지 않습니다.`);
      const sources = sourceCoverage(payload.sourceCoverage, `외부 신고 ${id}`);
      protections.push({ id, origin: "external_filing", subjectId, ...dates, status: "confirmed", form: withClaimAdapter(payload as unknown as Record<string, unknown>, sources) });
    }
    for (const row of bases) {
      const id = requiredText(row.snapshot_id, "봉인 근거 식별자"), subjectId = requiredText(row.subject_id, "봉인 근거 주체");
      const dates = range(row.date_from, row.date_to, `봉인 근거 ${id}`);
      if (row.schema_version !== "vat-filing-basis-v1" || row.created_at == null) throw unavailable(`봉인 근거 ${id}의 지원 버전과 봉인 시각을 확인하세요.`);
      const scope = object(row.scope_json, `봉인 근거 ${id}`) as unknown as VatFilingScopeResult;
      if (scope.schemaVersion !== row.schema_version || scope.subjectId !== subjectId || scope.dateFrom !== dates.from || scope.dateTo !== dates.to
        || scope.status !== "ready" || scope.canCalculate !== true) throw unavailable(`봉인 근거 ${id}의 행과 범위 결정본이 일치하지 않습니다.`);
      const evidence = object(scope.evidenceSnapshot, `봉인 근거 ${id}의 원본`);
      const subject = object(evidence.subject, `봉인 근거 ${id}의 주체`);
      if (subject.subjectId !== subjectId || !Array.isArray(evidence.facts)) throw unavailable(`봉인 근거 ${id}의 원본 주체와 사건 명세를 확인하세요.`);
      const sources = [...sourceCoverage(scope.excludedSources, `봉인 근거 ${id}의 기신고`)];
      for (const fact of evidence.facts) {
        const revision = object(fact, `봉인 근거 ${id}의 사건`) as unknown as FactRevision;
        if (revision.subjectId !== subjectId) throw unavailable(`봉인 근거 ${id}에 다른 주체의 사건이 있습니다.`);
        sources.push(...sourceCoverage(revision.sourceCoverage, `봉인 근거 ${id}의 사건`));
      }
      protections.push({ id, origin: "basis_snapshot", subjectId, ...dates, status: "confirmed", form: withClaimAdapter(scope as unknown as Record<string, unknown>, sources) });
    }
    return protections.filter(item => !options.origins || options.origins.includes(item.origin))
      .sort((a, b) => a.from.localeCompare(b.from) || a.origin.localeCompare(b.origin) || a.id.localeCompare(b.id));
  } catch (error) {
    if ((error as { code?: string })?.code === "vat_filing_verification_unavailable") throw error;
    // Avoid exposing SQL identifiers or treating failed reads as a normal empty history.
    throw unavailable("179 및 B1 신고 근거 마이그레이션과 조회 상태를 확인하세요.");
  }
}

/** Inclusive date overlap, including a stored range covering more than one calendar half. */
export function vatFilingProtectionOverlaps(protection: VatFilingProtection, from: string, to = from): boolean {
  const dates = range(from, to, "변경 영향");
  return protection.from <= dates.to && protection.to >= dates.from;
}

export function vatFilingProtectionReferences(protection: VatFilingProtection, refs: readonly VatFilingSourceRef[]): boolean {
  const review = protection.form.duplicateReview;
  if (review == null) return false; // Older internal returns can lack source-level snapshots.
  const claims = object(review, "신고 원천 명세").claimSources;
  if (claims == null) return false;
  if (!Array.isArray(claims)) throw unavailable("신고 원천별 소비 명세를 확인하세요.");
  return claims.some(claim => {
    const row = object(claim, "신고 소비 원천");
    return refs.some(ref => row.kind === ref.kind && row.sourceId === ref.id);
  });
}

/** Call before mutations, with all old/new tax dates and related source identities. */
export async function assertVatFilingSourcesMutable(
  db: PgDatabase,
  input: { dates: readonly string[]; refs?: readonly VatFilingSourceRef[]; origins?: readonly VatFilingProtectionOrigin[] },
): Promise<void> {
  for (const date of input.dates) range(date, date, "변경 영향");
  const protections = await listVatFilingProtections(db, { origins: input.origins });
  const blocked = protections.filter(protection => protection.status === "confirmed"
    && (input.dates.some(date => vatFilingProtectionOverlaps(protection, date))
      || vatFilingProtectionReferences(protection, input.refs ?? [])));
  if (blocked.length) throw Object.assign(new Error("확인된 신고 접수 또는 봉인된 신고 근거에 사용된 자료입니다. 과거 근거를 보존하는 후행 검토 절차가 필요합니다."),
    { status: 409, code: "vat_filing_protected", protectionIds: blocked.map(item => item.id) });
}

/** New B1 protection only; existing legacy-only classification policy remains unchanged. */
export async function assertNewVatFilingCardMutationsAllowed(
  db: PgDatabase,
  input: { cardTxnIds: readonly string[]; additionalDates?: readonly string[] },
): Promise<void> {
  if (!input.cardTxnIds.length) return;
  try {
    const ids = new Set(input.cardTxnIds.map(id => requiredText(id, "변경 카드 식별자")));
    const reviews = rowsToObjects(await db.exec("SELECT card_txn_id,original_card_txn_id,tax_date FROM card_tax_reviews"));
    // Both the old and new reversal relationship can consume an original card's evidence.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const review of reviews) {
        if (!review.original_card_txn_id) continue;
        const cardId = requiredText(review.card_txn_id, "검토 카드 식별자");
        const originalId = requiredText(review.original_card_txn_id, "원승인 카드 식별자");
        if (ids.has(cardId) || ids.has(originalId)) {
          for (const id of [cardId, originalId]) if (!ids.has(id)) { ids.add(id); expanded = true; }
        }
      }
    }
    const cards = rowsToObjects(await db.exec("SELECT card_txn_id,approved_at FROM card_transactions WHERE card_txn_id=ANY($1::text[])", [[...ids]]));
    const dates = new Set(input.additionalDates ?? []);
    for (const card of cards) dates.add(requiredText(card.approved_at, "카드 승인일").slice(0, 10));
    for (const review of reviews) if (ids.has(String(review.card_txn_id)) && review.tax_date != null) dates.add(requiredText(review.tax_date, "기존 카드 귀속일"));
    await assertVatFilingSourcesMutable(db, { dates: [...dates], refs: [...ids].map(id => ({ kind: "card", id })), origins: ["external_filing", "basis_snapshot"] });
  } catch (error) {
    if (["vat_filing_verification_unavailable", "vat_filing_protected"].includes(String((error as { code?: string })?.code))) throw error;
    throw unavailable("카드와 신고 소비 근거의 연결 자료를 확인하세요.");
  }
}
