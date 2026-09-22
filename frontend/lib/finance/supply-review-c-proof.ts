import { rowsToObjects, type PgDatabase } from "@/lib/db";

interface SupplyCTargetRow {
  basis_confirmation_id: unknown; legacy_archive_id: unknown; calculation_hash: unknown;
  subject_id: unknown; consumption_id: unknown;
}
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\x00-\x20\x7f]/.test(value);
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const unavailable = () => Object.assign(new Error("C 소비가 참조한 확정 보관판과 원문 근거를 확인할 수 없습니다."), { status: 503, code: "supply_review_c_target_unavailable" });

/** Validate stored confirmation/archive evidence, never current sources or a fresh VAT calculation.
 * Text hashes are computed in PostgreSQL from the original jsonb text. Financial
 * decimals are not parsed in JavaScript or fed into the integer-only proof format.
 * The caller owns the read snapshot and has already checked the fixed definitions.
 */
export async function assertSupplyCReferenceTarget(db: PgDatabase, row: SupplyCTargetRow | Record<string, unknown>, revisionId: string, pairLineNo: number): Promise<string> {
  try {
    const basis = row.basis_confirmation_id, legacy = row.legacy_archive_id;
    if (!validId(revisionId) || !Number.isSafeInteger(pairLineNo) || pairLineNo < 0 || pairLineNo > 99
      || !validId(row.subject_id) || !validId(row.consumption_id) || !validHash(row.calculation_hash)
      || !((validId(basis) && legacy === null) || (validId(legacy) && basis === null))) throw unavailable();
    if (basis !== null) {
      const result = rowsToObjects(await db.exec(`WITH proof AS MATERIALIZED (
        SELECT vat_post_confirmed_return_hash($1) AS verified_hash
      )
      SELECT proof.verified_hash,bs.subject_id,rr.form_json#>>'{followupConsumption,application,subjectId}' AS application_subject,
        c.calculation_hash,c.consumption_id,
        jsonb_build_object('version','de0-c-target-v1','origin','basis','confirmationId',rc.confirmation_id,
          'returnId',rr.return_id,'basisSnapshotId',bs.snapshot_id,'calculationHash',proof.verified_hash,
          'subjectId',bs.subject_id,'consumptionId',c.consumption_id,'revisionId',c.revision_id,'pairLineNo',c.pair_line_no,
          'formTextHash',encode(sha256(convert_to(rr.form_json::text,'UTF8')),'hex'))::text AS target_text
      FROM proof JOIN vat_filing_return_confirmations rc ON rc.confirmation_id=$1
      JOIN vat_filing_return_revisions rr ON rr.return_id=rc.return_id
      JOIN vat_filing_basis_snapshots bs ON bs.snapshot_id=rr.basis_snapshot_id
      JOIN vat_followup_review_consumptions c ON c.basis_confirmation_id=rc.confirmation_id
      WHERE c.consumption_id=$2 AND c.revision_id=$3 AND c.pair_line_no=$4`, [basis, row.consumption_id, revisionId, pairLineNo]));
      const value = result[0];
      if (result.length !== 1 || value.subject_id !== row.subject_id || value.application_subject !== row.subject_id
        || value.verified_hash !== row.calculation_hash || value.calculation_hash !== row.calculation_hash || typeof value.target_text !== "string") throw unavailable();
      return value.target_text;
    }
    const result = rowsToObjects(await db.exec(`WITH archive AS MATERIALIZED (
      SELECT a.*,to_jsonb(r) AS current_row,vat_followup_validate_form_v2(a.form_json,'legacy',NULL) AS fc
      FROM vat_followup_legacy_archives a JOIN vat_returns r ON r.return_id=a.return_id WHERE a.archive_id=$1
    ), evidence AS MATERIALIZED (
      SELECT a.*,
        (SELECT COALESCE(jsonb_agg(c.payload_json ORDER BY c.payload_json->>'revisionId' COLLATE "C",c.pair_line_no),'[]'::jsonb)
          FROM vat_followup_review_consumptions c WHERE c.legacy_archive_id=a.archive_id) AS actual_pairs,
        NOT EXISTS(SELECT 1 FROM vat_followup_review_consumptions c
          LEFT JOIN vat_followup_review_revisions v ON v.revision_id=c.revision_id
          LEFT JOIN vat_followup_review_roots r ON r.review_id=v.review_id
          WHERE c.legacy_archive_id=a.archive_id AND (
            c.basis_confirmation_id IS NOT NULL OR c.calculation_hash IS DISTINCT FROM a.calculation_hash
            OR c.created_by IS DISTINCT FROM a.created_by OR c.payload_json->>'revisionId' IS DISTINCT FROM c.revision_id
            OR c.payload_json->'pairLineNo' IS DISTINCT FROM to_jsonb(c.pair_line_no)
            OR v.schema_version IS DISTINCT FROM 'vat-followup-review-v1' OR v.state IS DISTINCT FROM 'verified'
            OR v.payload_hash IS DISTINCT FROM vat_followup_hash(v.payload_json)
            OR v.payload_json#>ARRAY['pairs',c.pair_line_no::text] IS DISTINCT FROM c.payload_json->'pair'
            OR r.subject_id IS DISTINCT FROM a.fc#>>'{application,subjectId}'
            OR v.payload_json#>>'{application,subjectId}' IS DISTINCT FROM r.subject_id)) AS rows_valid
      FROM archive a
    ) SELECT e.fc#>>'{application,subjectId}' AS subject_id,e.calculation_hash,
      (e.schema_version='vat-return-legacy-v2'
       AND e.row_json=e.current_row AND e.row_json->'form_json'=e.form_json
       AND e.row_json->>'return_id'=e.return_id AND e.row_json->>'status'='confirmed' AND e.row_json->>'period_kind'='final'
       AND e.created_by=e.row_json->>'confirmed_by' AND e.calculation_hash=e.fc->>'calculationHash'
       AND e.row_json->'period_year'=e.fc#>'{application,year}' AND e.row_json->'period_term'=e.fc#>'{application,term}'
       AND e.row_json->>'date_from'=e.fc#>>'{application,dateFrom}' AND e.row_json->>'date_to'=e.fc#>>'{application,dateTo}'
       AND e.form_json->'blockingIssues'='[]'::jsonb AND e.actual_pairs=e.fc->'pairs' AND e.rows_valid) IS TRUE AS valid,
      jsonb_build_object('version','de0-c-target-v1','origin','legacy','archiveId',e.archive_id,'returnId',e.return_id,
        'calculationHash',e.calculation_hash,'subjectId',e.fc#>>'{application,subjectId}',
        'consumptionId',c.consumption_id,'revisionId',c.revision_id,'pairLineNo',c.pair_line_no,
        'formTextHash',encode(sha256(convert_to(e.form_json::text,'UTF8')),'hex'),
        'rowTextHash',encode(sha256(convert_to(e.row_json::text,'UTF8')),'hex'),
        'consumptionSetTextHash',encode(sha256(convert_to(e.actual_pairs::text,'UTF8')),'hex'))::text AS target_text
    FROM evidence e JOIN vat_followup_review_consumptions c ON c.legacy_archive_id=e.archive_id
    WHERE c.consumption_id=$2 AND c.revision_id=$3 AND c.pair_line_no=$4`, [legacy, row.consumption_id, revisionId, pairLineNo]));
    const value = result[0];
    if (result.length !== 1 || value.valid !== true || value.subject_id !== row.subject_id
      || value.calculation_hash !== row.calculation_hash || typeof value.target_text !== "string") throw unavailable();
    return value.target_text;
  } catch (error) {
    if (["40001", "40P01"].includes(String((error as { code?: string }).code))) throw error;
    throw unavailable();
  }
}
