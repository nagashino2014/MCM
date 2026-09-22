-- C-b2 선행 보호: 보관된 신고 주체 기준으로 납세자 경계를 비교한다.
-- 기존 229~234 원문/업무 행/해시를 재작성하거나 주체를 합치지 않는다.
BEGIN;

-- Earlier VAT definitions must not replace the sealed R1 installation.
DO $$ BEGIN
  IF pg_catalog.to_regprocedure(pg_catalog.format('%I.finance_assert_r1_definitions(text)', pg_catalog.current_schema())) IS NOT NULL THEN
    RAISE EXCEPTION 'VAT migration 235 cannot be reapplied after R1 installation' USING ERRCODE='55000';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_finalization_identity_version()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'vat-finalization-taxpayer-v1'::text $$;

CREATE OR REPLACE FUNCTION vat_finalization_basis_identity(p_snapshot_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE b vat_filing_basis_snapshots%ROWTYPE; s vat_filing_subject_revisions%ROWTYPE;
  subject_json jsonb; corp_num text; subject_from date; subject_to date;
  expected_from text; expected_to text;
BEGIN
  SELECT * INTO b FROM vat_filing_basis_snapshots WHERE snapshot_id=p_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VAT finalization identity unavailable: basis snapshot missing' USING ERRCODE='55000';
  END IF;
  SELECT * INTO s FROM vat_filing_subject_revisions
    WHERE revision_id=b.subject_revision_id AND subject_id=b.subject_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VAT finalization identity unavailable: subject revision missing' USING ERRCODE='55000';
  END IF;
  subject_json:=s.payload_json;
  corp_num:=subject_json->>'corpNum';
  IF jsonb_typeof(subject_json) IS DISTINCT FROM 'object'
    OR subject_json IS DISTINCT FROM b.scope_json#>'{evidenceSnapshot,subject}'
    OR subject_json->>'subjectId' IS DISTINCT FROM b.subject_id
    OR subject_json->>'revisionId' IS DISTINCT FROM b.subject_revision_id
    OR subject_json->'version' IS DISTINCT FROM to_jsonb(s.version)
    OR b.scope_json->>'subjectId' IS DISTINCT FROM b.subject_id
    OR b.scope_json->>'subjectRevisionId' IS DISTINCT FROM b.subject_revision_id
    OR b.scope_json->'year' IS DISTINCT FROM to_jsonb(b.period_year)
    OR b.scope_json->'term' IS DISTINCT FROM to_jsonb(b.period_term)
    OR b.scope_json->>'kind' IS DISTINCT FROM b.period_kind
    OR b.scope_json->>'dateFrom' IS DISTINCT FROM b.date_from
    OR b.scope_json->>'dateTo' IS DISTINCT FROM b.date_to
    OR b.scope_json->>'status' IS DISTINCT FROM 'ready'
    OR subject_json->>'state' IS DISTINCT FROM 'verified'
    OR subject_json->>'entityType' IS DISTINCT FROM 'corporation'
    OR subject_json->>'vatRegime' IS DISTINCT FROM 'general'
    OR subject_json->>'filingUnit' IS DISTINCT FROM 'single_business_place'
    OR jsonb_typeof(subject_json->'corpNum') IS DISTINCT FROM 'string'
    OR COALESCE(corp_num,'') !~ '^[0-9]{10}$' OR corp_num='0000000000'
    OR jsonb_typeof(b.scope_json#>'{evidenceSnapshot,collectionCorpNum}') IS DISTINCT FROM 'string'
    OR b.scope_json#>>'{evidenceSnapshot,collectionCorpNum}' IS DISTINCT FROM corp_num
  THEN
    RAISE EXCEPTION 'VAT finalization identity unavailable: stored taxpayer evidence mismatch or unsupported identity' USING ERRCODE='55000';
  END IF;
  -- 주체의 최신 판을 조회하지 않는다. 이 보관본의 적용기간과 고정된 판만 대조한다.
  expected_from:=b.period_year::text||CASE b.period_term WHEN 1 THEN '-01-01' ELSE '-07-01' END;
  expected_to:=b.period_year::text||CASE
    WHEN b.period_kind='preliminary' AND b.period_term=1 THEN '-03-31'
    WHEN b.period_kind='preliminary' THEN '-09-30'
    WHEN b.period_term=1 THEN '-06-30' ELSE '-12-31' END;
  IF b.date_from IS DISTINCT FROM expected_from OR b.date_to IS DISTINCT FROM expected_to
    OR COALESCE(subject_json->>'effectiveFrom','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR NOT(subject_json ? 'effectiveTo')
    OR (subject_json->'effectiveTo'<>'null'::jsonb AND
      COALESCE(subject_json->>'effectiveTo','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  THEN
    RAISE EXCEPTION 'VAT finalization identity unavailable: stored taxpayer period mismatch' USING ERRCODE='55000';
  END IF;
  BEGIN
    subject_from:=(subject_json->>'effectiveFrom')::date;
    subject_to:=(subject_json->>'effectiveTo')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'VAT finalization identity unavailable: invalid taxpayer effective date' USING ERRCODE='55000';
  END;
  IF subject_from::text IS DISTINCT FROM subject_json->>'effectiveFrom'
    OR (subject_to IS NOT NULL AND subject_to::text IS DISTINCT FROM subject_json->>'effectiveTo')
    OR subject_from>b.date_from::date OR (subject_to IS NOT NULL AND subject_to<b.date_to::date)
  THEN
    RAISE EXCEPTION 'VAT finalization identity unavailable: taxpayer does not cover stored period' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('snapshotId',b.snapshot_id,'subjectId',b.subject_id,
    'subjectRevisionId',b.subject_revision_id,'taxpayerCorpNum',corp_num,
    'filingUnit','single_business_place','year',b.period_year,'term',b.period_term,'kind',b.period_kind);
END $$;

-- 234의 공개 5인자 계약 및 VOLATILE 조회를 유지한다.
-- 모든 같은 기수의 B2 후보를 식별한 뒤 비교하므로, 잘못된 보관번호를 타회사로 넘기지 않는다.
CREATE OR REPLACE FUNCTION vat_finalization_conflicts(
  p_subject_id text,p_period_year integer,p_period_term integer,p_period_kind text,p_application_path text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE conflicts jsonb:='[]'::jsonb; target_snapshot_id text; target_identity jsonb;
  candidate record; candidate_identity jsonb; match_kind text;
BEGIN
  IF p_period_year IS NULL OR p_period_year NOT BETWEEN 1000 AND 9999
    OR p_period_term IS NULL OR p_period_term NOT IN(1,2)
    OR p_period_kind IS NULL OR p_period_kind NOT IN('pre','preliminary','final')
    OR p_application_path IS NULL OR p_application_path NOT IN('legacy','basis')
  THEN RAISE EXCEPTION 'VAT finalization scope is invalid' USING ERRCODE='23514'; END IF;
  IF p_period_kind<>'final' THEN RETURN conflicts; END IF;
  IF p_application_path='basis' THEN
    IF COALESCE(length(btrim(p_subject_id)),0)=0
    THEN RAISE EXCEPTION 'VAT finalization basis subject is required' USING ERRCODE='23514'; END IF;
    SELECT snapshot_id INTO target_snapshot_id FROM vat_filing_basis_snapshots
      WHERE subject_id=p_subject_id AND period_year=p_period_year AND period_term=p_period_term AND period_kind='final';
    target_identity:=vat_finalization_basis_identity(target_snapshot_id);
  END IF;
  FOR candidate IN
    SELECT r.return_id,r.period_year,r.period_term FROM vat_returns r
    WHERE r.period_year=p_period_year AND r.period_term=p_period_term
      AND r.period_kind='final' AND r.status='confirmed' ORDER BY r.return_id
  LOOP
    conflicts:=conflicts||jsonb_build_array(jsonb_build_object('origin','legacy','returnId',candidate.return_id,
      'confirmationId',NULL,'subjectId',NULL,'year',candidate.period_year,'term',candidate.period_term,
      'kind','final','subjectResolution','unresolved_legacy','taxpayerCorpNum',NULL,'filingUnit',NULL,
      'matchKind','legacy_unresolved'));
  END LOOP;
  FOR candidate IN
    SELECT c.return_id,c.confirmation_id,b.snapshot_id,b.subject_id,b.period_year,b.period_term
    FROM vat_filing_return_confirmations c JOIN vat_filing_basis_snapshots b ON b.snapshot_id=c.basis_snapshot_id
    WHERE b.period_year=p_period_year AND b.period_term=p_period_term AND b.period_kind='final'
    ORDER BY c.return_id
  LOOP
    candidate_identity:=vat_finalization_basis_identity(candidate.snapshot_id);
    match_kind:=CASE
      WHEN p_application_path='legacy' THEN 'legacy_global'
      WHEN candidate.subject_id=p_subject_id THEN 'same_subject'
      WHEN candidate_identity->>'taxpayerCorpNum'=target_identity->>'taxpayerCorpNum'
        AND candidate_identity->>'filingUnit'=target_identity->>'filingUnit' THEN 'same_taxpayer_unit'
      ELSE NULL END;
    IF match_kind IS NOT NULL THEN
      conflicts:=conflicts||jsonb_build_array(jsonb_build_object('origin','basis_return','returnId',candidate.return_id,
        'confirmationId',candidate.confirmation_id,'subjectId',candidate.subject_id,
        'year',candidate.period_year,'term',candidate.period_term,'kind','final','subjectResolution','exact',
        'taxpayerCorpNum',candidate_identity->>'taxpayerCorpNum','filingUnit',candidate_identity->>'filingUnit',
        'matchKind',match_kind));
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'origin',item->>'returnId'),'[]'::jsonb)
    INTO conflicts FROM jsonb_array_elements(conflicts) item;
  RETURN conflicts;
END $$;

CREATE OR REPLACE FUNCTION vat_legacy_confirmed_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='confirmed' THEN
    RAISE EXCEPTION 'Confirmed legacy VAT evidence cannot be deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS vat_legacy_confirmed_no_delete ON vat_returns;
CREATE TRIGGER vat_legacy_confirmed_no_delete BEFORE DELETE ON vat_returns
  FOR EACH ROW EXECUTE FUNCTION vat_legacy_confirmed_no_delete();

-- TRUNCATE는 행 트리거를 거치지 않는다. 현재 MVCC 조회에 따라 빈 표로 판단하여 허용하지 않는다.
CREATE OR REPLACE FUNCTION vat_legacy_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Legacy VAT evidence cannot be truncated' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS vat_legacy_no_truncate ON vat_returns;
CREATE TRIGGER vat_legacy_no_truncate BEFORE TRUNCATE ON vat_returns
  FOR EACH STATEMENT EXECUTE FUNCTION vat_legacy_no_truncate();

COMMIT;
