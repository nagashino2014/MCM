-- C-b1: 경로 공통 확정 배타성과 C-a 기록판의 사실 투영 보호.
-- 기존 229~233, 과거 확정본/검토판, canonical/hash 의미는 변경하지 않는다.
BEGIN;

-- Earlier VAT definitions must not replace the sealed R1 installation.
DO $$ BEGIN
  IF pg_catalog.to_regprocedure(pg_catalog.format('%I.finance_assert_r1_definitions(text)', pg_catalog.current_schema())) IS NOT NULL THEN
    RAISE EXCEPTION 'VAT migration 234 cannot be reapplied after R1 installation' USING ERRCODE='55000';
  END IF;
END $$;

-- 주체 없는 legacy와 주체 있는 basis가 같은 잠금 범위를 사용한다.
-- 과거 점유를 추정하여 백필하지 않는 기술용 직렬화 표다.
CREATE TABLE IF NOT EXISTS vat_finalization_fences (
  key text PRIMARY KEY CHECK(length(key)>0),
  generation bigint NOT NULL CHECK(generation>0)
);

CREATE OR REPLACE FUNCTION vat_finalization_fence(p_period_year integer,p_period_term integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_period_year IS NULL OR p_period_year NOT BETWEEN 1000 AND 9999
    OR p_period_term IS NULL OR p_period_term NOT IN(1,2)
  THEN RAISE EXCEPTION 'VAT finalization period is invalid' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(1296256326,1);
  INSERT INTO vat_finalization_fences(key,generation)
    VALUES('final:'||p_period_year::text||':'||p_period_term::text,1)
    ON CONFLICT(key) DO UPDATE SET generation=vat_finalization_fences.generation+1;
END $$;

CREATE OR REPLACE FUNCTION vat_finalization_conflicts(
  p_subject_id text,p_period_year integer,p_period_term integer,p_period_kind text,p_application_path text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE conflicts jsonb;
BEGIN
  IF p_period_year IS NULL OR p_period_year NOT BETWEEN 1000 AND 9999
    OR p_period_term IS NULL OR p_period_term NOT IN(1,2)
    OR p_period_kind IS NULL OR p_period_kind NOT IN('pre','preliminary','final')
    OR p_application_path IS NULL OR p_application_path NOT IN('legacy','basis')
  THEN RAISE EXCEPTION 'VAT finalization scope is invalid' USING ERRCODE='23514'; END IF;
  IF p_period_kind<>'final' THEN RETURN '[]'::jsonb; END IF;
  IF p_application_path='basis' AND COALESCE(length(btrim(p_subject_id)),0)=0
  THEN RAISE EXCEPTION 'VAT finalization basis subject is required' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.origin,x.return_id),'[]'::jsonb) INTO conflicts
  FROM (
    SELECT 'legacy'::text AS origin,r.return_id,
      jsonb_build_object('origin','legacy','returnId',r.return_id,'confirmationId',NULL,
        'subjectId',NULL,'year',r.period_year,'term',r.period_term,'kind','final',
        'subjectResolution','unresolved_legacy') AS item
    FROM vat_returns r
    WHERE r.period_year=p_period_year AND r.period_term=p_period_term
      AND r.period_kind='final' AND r.status='confirmed'
    UNION ALL
    SELECT 'basis_return'::text,c.return_id,
      jsonb_build_object('origin','basis_return','returnId',c.return_id,'confirmationId',c.confirmation_id,
        'subjectId',b.subject_id,'year',b.period_year,'term',b.period_term,'kind','final',
        'subjectResolution','exact')
    FROM vat_filing_return_confirmations c
    JOIN vat_filing_basis_snapshots b ON b.snapshot_id=c.basis_snapshot_id
    WHERE b.period_year=p_period_year AND b.period_term=p_period_term AND b.period_kind='final'
      AND (p_application_path='legacy' OR b.subject_id=p_subject_id)
  ) x;
  RETURN conflicts;
END $$;

CREATE OR REPLACE FUNCTION vat_assert_finalization_open(
  p_subject_id text,p_period_year integer,p_period_term integer,p_period_kind text,p_application_path text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE conflicts jsonb;
BEGIN
  IF p_period_kind='final' THEN PERFORM vat_finalization_fence(p_period_year,p_period_term); END IF;
  conflicts:=vat_finalization_conflicts(p_subject_id,p_period_year,p_period_term,p_period_kind,p_application_path);
  IF jsonb_array_length(conflicts)>0
  THEN RAISE EXCEPTION 'VAT finalization conflict across filing paths'
    USING ERRCODE='23514',DETAIL=conflicts::text; END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_legacy_finalization_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  IF TG_OP='UPDATE' AND OLD.status='confirmed' THEN
    -- 기존 명시 해제는 금액/기간/원문을 그대로 두고 확정 표시만 비운다.
    -- C-b2 소비 후 해제 보호는 별도 계약이며 여기서 소비를 활성화하지 않는다.
    IF NEW.status='draft' AND NEW.confirmed_by IS NULL AND NEW.confirmed_at IS NULL
      AND (to_jsonb(NEW)-ARRAY['status','confirmed_by','confirmed_at','updated_at'])
        IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','confirmed_by','confirmed_at','updated_at'])
    THEN
      IF OLD.period_kind='final' THEN PERFORM vat_finalization_fence(OLD.period_year,OLD.period_term); END IF;
      RETURN NEW;
    END IF;
    IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Confirmed legacy VAT evidence cannot be changed' USING ERRCODE='23514';
  END IF;
  PERFORM vat_assert_finalization_open(NULL,NEW.period_year,NEW.period_term,NEW.period_kind,'legacy');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_legacy_finalization_boundary ON vat_returns;
CREATE TRIGGER vat_legacy_finalization_boundary BEFORE INSERT OR UPDATE ON vat_returns
  FOR EACH ROW EXECUTE FUNCTION vat_legacy_finalization_boundary();

CREATE OR REPLACE FUNCTION vat_basis_finalization_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE basis vat_filing_basis_snapshots%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  SELECT * INTO STRICT basis FROM vat_filing_basis_snapshots WHERE snapshot_id=NEW.basis_snapshot_id;
  PERFORM vat_assert_finalization_open(basis.subject_id,basis.period_year,basis.period_term,basis.period_kind,'basis');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_basis_finalization_boundary ON vat_filing_return_revisions;
CREATE TRIGGER vat_basis_finalization_boundary BEFORE INSERT ON vat_filing_return_revisions
  FOR EACH ROW EXECUTE FUNCTION vat_basis_finalization_boundary();
DROP TRIGGER IF EXISTS vat_basis_finalization_boundary ON vat_filing_return_confirmations;
CREATE TRIGGER vat_basis_finalization_boundary BEFORE INSERT ON vat_filing_return_confirmations
  FOR EACH ROW EXECUTE FUNCTION vat_basis_finalization_boundary();

-- 같은 SQL 명령의 여러 쓰기에서도 최종 커밋 상태의 경로 공존을 허용하지 않는다.
-- 기존 행은 스캔/재작성하지 않으며 새 확정 쓰기에만 적용한다.
CREATE OR REPLACE FUNCTION vat_finalization_complete_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conflicts jsonb; basis vat_filing_basis_snapshots%ROWTYPE; current_status text;
BEGIN
  IF TG_TABLE_NAME='vat_returns' THEN
    SELECT status INTO current_status FROM vat_returns WHERE return_id=NEW.return_id;
    IF NEW.period_kind<>'final' OR current_status IS DISTINCT FROM 'confirmed' THEN RETURN NULL; END IF;
    conflicts:=vat_finalization_conflicts(NULL,NEW.period_year,NEW.period_term,'final','legacy');
    IF jsonb_array_length(conflicts)=1 AND conflicts#>>'{0,origin}'='legacy'
      AND conflicts#>>'{0,returnId}'=NEW.return_id THEN RETURN NULL; END IF;
  ELSE
    SELECT * INTO STRICT basis FROM vat_filing_basis_snapshots WHERE snapshot_id=NEW.basis_snapshot_id;
    IF basis.period_kind<>'final' THEN RETURN NULL; END IF;
    conflicts:=vat_finalization_conflicts(basis.subject_id,basis.period_year,basis.period_term,'final','basis');
    IF jsonb_array_length(conflicts)=1 AND conflicts#>>'{0,origin}'='basis_return'
      AND conflicts#>>'{0,confirmationId}'=NEW.confirmation_id THEN RETURN NULL; END IF;
  END IF;
  RAISE EXCEPTION 'VAT finalization commit conflict across filing paths' USING ERRCODE='23514',DETAIL=conflicts::text;
END $$;
DROP TRIGGER IF EXISTS vat_legacy_finalization_complete ON vat_returns;
CREATE CONSTRAINT TRIGGER vat_legacy_finalization_complete AFTER INSERT OR UPDATE ON vat_returns
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_finalization_complete_boundary();
DROP TRIGGER IF EXISTS vat_basis_finalization_complete ON vat_filing_return_confirmations;
CREATE CONSTRAINT TRIGGER vat_basis_finalization_complete AFTER INSERT ON vat_filing_return_confirmations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_finalization_complete_boundary();

CREATE OR REPLACE FUNCTION vat_followup_revision_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root vat_followup_review_roots%ROWTYPE; previous_state text;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  SELECT * INTO STRICT root FROM vat_followup_review_roots WHERE review_id=NEW.review_id;
  IF NEW.state='withdrawn' THEN
    SELECT state INTO previous_state FROM vat_followup_review_revisions WHERE revision_id=NEW.previous_revision_id;
    IF previous_state='withdrawn'
    THEN RAISE EXCEPTION 'VAT followup review is already withdrawn' USING ERRCODE='23514'; END IF;
  ELSE
    PERFORM vat_assert_finalization_open(root.subject_id,root.period_year,root.period_term,root.period_kind,root.application_path);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_followup_revision_boundary ON vat_followup_review_revisions;
CREATE TRIGGER vat_followup_revision_boundary BEFORE INSERT ON vat_followup_review_revisions
  FOR EACH ROW EXECUTE FUNCTION vat_followup_revision_boundary();

-- 기존 233의 구조/문서/DBproof 검사가 끝난 뒤 기록판의 사실 투영만 추가한다.
-- 미판정/비공제/선언형 증빙/현재 원천과 과거 명세의 차이는 기록할 수 있다.
-- verified의 의미 판정 전체를 recorded에 적용하거나 과거 불변판을 재작성하지 않는다.
CREATE OR REPLACE FUNCTION vat_followup_recorded_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev vat_followup_review_revisions%ROWTYPE; root vat_followup_review_roots%ROWTYPE;
  card_row card_transactions%ROWTYPE; invoice_row hometax_tax_invoices%ROWTYPE;
  basis vat_filing_basis_snapshots%ROWTYPE; fact vat_filing_fact_revisions%ROWTYPE;
  p jsonb; past jsonb; historical jsonb; claim jsonb; claims jsonb; expected_claim jsonb;
  old_subject jsonb; expected_grade text; card_sign integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  SELECT * INTO STRICT rev FROM vat_followup_review_revisions WHERE revision_id=NEW.revision_id;
  IF rev.state<>'recorded' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT root FROM vat_followup_review_roots WHERE review_id=rev.review_id;
  p:=NEW.pair_json; past:=p->'past'; historical:=p->NEW.historical_side; claim:=past->'claim';
  SELECT * INTO STRICT card_row FROM card_transactions WHERE card_txn_id=NEW.card_source_id;
  SELECT * INTO STRICT invoice_row FROM hometax_tax_invoices WHERE hti_id=NEW.invoice_source_id;
  card_sign:=CASE WHEN btrim(card_row.approval_type) IN('취소','부분취소','환불') THEN -1 ELSE 1 END;
  IF (p#>>'{card,supply}')::numeric IS DISTINCT FROM card_sign*abs(card_row.supply_amount)
    OR (p#>>'{card,tax}')::numeric IS DISTINCT FROM card_sign*abs(card_row.tax_amount)
    OR (p#>>'{card,total}')::numeric IS DISTINCT FROM card_sign*abs(card_row.amount_total)
    OR (p#>>'{invoice,supply}')::numeric IS DISTINCT FROM COALESCE(invoice_row.amount_total,0)
    OR (p#>>'{invoice,tax}')::numeric IS DISTINCT FROM COALESCE(invoice_row.tax_total,0)
    OR (p#>>'{invoice,total}')::numeric IS DISTINCT FROM COALESCE(invoice_row.total_amount,0)
  THEN RAISE EXCEPTION 'Recorded VAT followup source amount mismatch' USING ERRCODE='23514'; END IF;

  IF NEW.past_origin='legacy' THEN
    SELECT COALESCE(jsonb_agg(c),'[]'::jsonb) INTO claims
    FROM vat_returns r CROSS JOIN LATERAL jsonb_array_elements(r.form_json#>'{duplicateReview,claimSources}') c
    WHERE r.return_id=NEW.legacy_return_id AND c->>'kind'=historical->>'kind' AND c->>'sourceId'=historical->>'id';
    IF jsonb_array_length(claims)<>1
    THEN RAISE EXCEPTION 'Recorded VAT followup historical claim unavailable' USING ERRCODE='23514'; END IF;
    expected_claim:=jsonb_build_object('sourceKind',claims->0->'kind','sourceId',claims->0->'sourceId',
      'canonicalKey',claims->0->'canonicalKey','sourceHash',claims->0->'sourceHash','direction','purchase',
      'supply',claims->0->'supply','tax',claims->0->'tax','claimedTax',claims->0->'tax','date',claims->0->'date');
    expected_grade:='legacy_internal_snapshot_only';
  ELSE
    SELECT * INTO STRICT basis FROM vat_filing_basis_snapshots WHERE snapshot_id=NEW.past_basis_snapshot_id;
    SELECT * INTO STRICT fact FROM vat_filing_fact_revisions WHERE revision_id=NEW.past_fact_revision_id;
    SELECT COALESCE(jsonb_agg(c),'[]'::jsonb) INTO claims
    FROM jsonb_array_elements(fact.payload_json->'sourceCoverage') c
    WHERE c->>'canonicalKey'=historical->>'canonicalKey' AND EXISTS(
      SELECT 1 FROM jsonb_array_elements(historical->'aliases') a
      WHERE a->>'kind'=c->>'sourceKind' AND a->>'id'=c->>'sourceId');
    IF jsonb_array_length(claims)<>1
    THEN RAISE EXCEPTION 'Recorded VAT followup historical claim unavailable' USING ERRCODE='23514'; END IF;
    expected_claim:=claims->0;
    SELECT payload_json INTO STRICT old_subject FROM vat_filing_subject_revisions WHERE revision_id=basis.subject_revision_id;
    expected_grade:=CASE WHEN vat_followup_server_document(fact.payload_json->>'evidenceRef',fact.payload_json->>'evidenceHash',root.subject_id)
      AND vat_followup_server_document(old_subject->>'evidenceRef',old_subject->>'evidenceHash',root.subject_id)
      THEN 'server_document_verified' ELSE 'unverified_declaration' END;
  END IF;
  IF claim IS DISTINCT FROM expected_claim
    OR historical->'claimedTax' IS DISTINCT FROM expected_claim->'claimedTax'
  THEN RAISE EXCEPTION 'Recorded VAT followup historical claim mismatch' USING ERRCODE='23514'; END IF;
  IF past->>'evidenceVerification' IS DISTINCT FROM expected_grade
  THEN RAISE EXCEPTION 'Recorded VAT followup evidence grade mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_vat_followup_recorded_boundary ON vat_followup_review_pairs;
CREATE TRIGGER zz_vat_followup_recorded_boundary BEFORE INSERT ON vat_followup_review_pairs
  FOR EACH ROW EXECUTE FUNCTION vat_followup_recorded_boundary();

COMMIT;
