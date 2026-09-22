-- B2: B1 근거를 참조하는 불변 세액 계산판과 내부 확정. 기존 vat_returns는 보존한다.
BEGIN;
CREATE TABLE IF NOT EXISTS vat_filing_return_revisions (
  return_id text PRIMARY KEY,
  basis_snapshot_id text NOT NULL REFERENCES vat_filing_basis_snapshots(snapshot_id),
  revision integer NOT NULL CHECK(revision>0),
  previous_return_id text UNIQUE REFERENCES vat_filing_return_revisions(return_id),
  schema_version text NOT NULL CHECK(schema_version='vat-return-basis-v1'),
  calculation_hash text NOT NULL CHECK(calculation_hash ~ '^[0-9a-f]{64}$'),
  scope_hash text NOT NULL CHECK(scope_hash ~ '^[0-9a-f]{64}$'),
  form_json jsonb NOT NULL CHECK(jsonb_typeof(form_json)='object'),
  created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(basis_snapshot_id,revision),
  UNIQUE(return_id,basis_snapshot_id),
  CHECK(form_json->'filingBasis'->>'basisSnapshotId' IS NOT NULL AND form_json->'filingBasis'->>'basisSnapshotId'=basis_snapshot_id),
  CHECK(form_json->'filingBasis'->>'scopeHash' IS NOT NULL AND form_json->'filingBasis'->>'scopeHash'=scope_hash),
  CHECK(form_json->'filingBasis'->>'calculationHash' IS NOT NULL AND form_json->'filingBasis'->>'calculationHash'=calculation_hash),
  CHECK(form_json->'filingBasis'->>'version' IS NOT NULL AND form_json->'filingBasis'->>'version'=schema_version),
  CHECK(jsonb_typeof(form_json->'blockingIssues')='array' AND form_json ? 'blockingIssues'),
  CHECK(jsonb_typeof(form_json->'manual')='array' AND form_json ? 'manual')
);
CREATE TABLE IF NOT EXISTS vat_filing_return_confirmations (
  confirmation_id text PRIMARY KEY,
  return_id text NOT NULL UNIQUE,
  -- 同一 고지/기신고 소비를 가진 basis를 다른 계산판에서 재사용할 수 없다.
  basis_snapshot_id text NOT NULL UNIQUE,
  calculation_hash text NOT NULL CHECK(calculation_hash ~ '^[0-9a-f]{64}$'),
  confirmed_by text NOT NULL CHECK(length(confirmed_by) BETWEEN 1 AND 200),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(return_id,basis_snapshot_id) REFERENCES vat_filing_return_revisions(return_id,basis_snapshot_id)
);
CREATE TABLE IF NOT EXISTS vat_filing_return_requests (
  request_id text PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 200),
  action text NOT NULL CHECK(action IN('save','confirm')),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL CHECK(jsonb_typeof(result_json)='object'),
  actor_user_id text NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 業務 이력과 별개의 직렬화 표. RR의 옛 스냅샷에서도 동시 head 변경을 감지한다.
CREATE TABLE IF NOT EXISTS vat_filing_return_fences (
  basis_snapshot_id text PRIMARY KEY REFERENCES vat_filing_basis_snapshots(snapshot_id),
  generation bigint NOT NULL CHECK(generation>0)
);
CREATE OR REPLACE FUNCTION vat_filing_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE basis vat_filing_basis_snapshots%ROWTYPE; previous vat_filing_return_revisions%ROWTYPE;
  current_return vat_filing_return_revisions%ROWTYPE; period jsonb; metadata jsonb;
  field text; number_value numeric; manual_delta numeric; payable numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  INSERT INTO vat_filing_return_fences(basis_snapshot_id,generation) VALUES(NEW.basis_snapshot_id,1)
    ON CONFLICT(basis_snapshot_id) DO UPDATE SET generation=vat_filing_return_fences.generation+1;
  SELECT * INTO STRICT basis FROM vat_filing_basis_snapshots WHERE snapshot_id=NEW.basis_snapshot_id FOR UPDATE;
  IF TG_TABLE_NAME='vat_filing_return_confirmations' THEN
    SELECT * INTO STRICT current_return FROM vat_filing_return_revisions WHERE return_id=NEW.return_id;
    IF current_return.calculation_hash IS DISTINCT FROM NEW.calculation_hash
      OR current_return.basis_snapshot_id IS DISTINCT FROM NEW.basis_snapshot_id
      OR jsonb_array_length(current_return.form_json->'blockingIssues')<>0
      OR current_return.form_json->'filingBasis'->>'verificationStatus' IS DISTINCT FROM 'complete'
      OR EXISTS(SELECT 1 FROM vat_filing_return_revisions WHERE basis_snapshot_id=NEW.basis_snapshot_id AND revision>current_return.revision)
    THEN RAISE EXCEPTION 'VAT return confirmation evidence mismatch' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM vat_filing_return_confirmations WHERE basis_snapshot_id=NEW.basis_snapshot_id)
  THEN RAISE EXCEPTION 'VAT basis already used by a confirmed return' USING ERRCODE='23514'; END IF;
  SELECT * INTO previous FROM vat_filing_return_revisions WHERE basis_snapshot_id=NEW.basis_snapshot_id ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>COALESCE(previous.revision,0)+1 OR NEW.previous_return_id IS DISTINCT FROM previous.return_id
  THEN RAISE EXCEPTION 'VAT return revision chain conflict' USING ERRCODE='23514'; END IF;
  period:=NEW.form_json->'period'; metadata:=NEW.form_json->'filingBasis';
  IF NEW.scope_hash IS DISTINCT FROM basis.scope_hash
    OR metadata->>'subjectId' IS DISTINCT FROM basis.subject_id
    OR metadata->>'mode' IS DISTINCT FROM basis.scope_json->>'mode'
    OR metadata->>'noticeDeduction' IS NULL
    OR (metadata->>'noticeDeduction')::bigint IS DISTINCT FROM (basis.scope_json->>'noticeDeduction')::bigint
    OR period->>'year' IS NULL OR (period->>'year')::integer<>basis.period_year
    OR period->>'term' IS NULL OR (period->>'term')::integer<>basis.period_term
    OR period->>'kind' IS DISTINCT FROM (CASE basis.period_kind WHEN 'preliminary' THEN 'pre' ELSE 'final' END)
    OR period->>'from' IS DISTINCT FROM basis.date_from OR period->>'to' IS DISTINCT FROM basis.date_to
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.form_json->'manual') f WHERE f->>'key' IS NULL OR f->>'key' NOT IN('etaxCredit','penalty'))
  THEN RAISE EXCEPTION 'VAT return scope or notice basis mismatch' USING ERRCODE='23514'; END IF;
  FOREACH field IN ARRAY ARRAY['sales,total,tax','sales,invoiceTaxable,tax','sales,deemedRent,tax',
    'purchases,totalDeductibleTax','purchases,invoiceGeneral,tax','purchases,nonDeductible,tax',
    'purchases,invoiceUndecided,tax','purchases,cardDeductible,tax','taxDue','finalTaxDue'] LOOP
    IF jsonb_typeof(NEW.form_json #> string_to_array(field,',')) IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'VAT required tax amount missing' USING ERRCODE='23514'; END IF;
    number_value:=(NEW.form_json #>> string_to_array(field,','))::numeric;
    IF number_value<>trunc(number_value) OR abs(number_value)>9007199254740991
    THEN RAISE EXCEPTION 'VAT tax amount outside integer range' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF jsonb_typeof(metadata->'sourceManifest') IS DISTINCT FROM 'array'
    OR COALESCE(metadata->>'sourceManifestHash','') !~ '^[0-9a-f]{64}$'
    OR NEW.form_json->'sourceEvidence'->>'version' IS DISTINCT FROM 'g03b-v1'
    OR jsonb_typeof(NEW.form_json->'ledgerSnapshot'->'rows') IS DISTINCT FROM 'array'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.form_json->'manual') f WHERE jsonb_typeof(f->'amount') IS DISTINCT FROM 'number'
      OR (f->>'amount')::numeric<>trunc((f->>'amount')::numeric) OR (f->>'amount')::numeric<0 OR (f->>'amount')::numeric>9007199254740991)
    OR (SELECT count(*)<>count(DISTINCT f->>'key') FROM jsonb_array_elements(NEW.form_json->'manual') f)
  THEN RAISE EXCEPTION 'VAT source or manual evidence incomplete' USING ERRCODE='23514'; END IF;
  IF (NEW.form_json#>>'{sales,total,tax}')::numeric<>(NEW.form_json#>>'{sales,invoiceTaxable,tax}')::numeric+(NEW.form_json#>>'{sales,deemedRent,tax}')::numeric
    OR (NEW.form_json#>>'{purchases,totalDeductibleTax}')::numeric<>(NEW.form_json#>>'{purchases,invoiceGeneral,tax}')::numeric-(NEW.form_json#>>'{purchases,nonDeductible,tax}')::numeric-(NEW.form_json#>>'{purchases,invoiceUndecided,tax}')::numeric+(NEW.form_json#>>'{purchases,cardDeductible,tax}')::numeric
    OR (NEW.form_json->>'taxDue')::numeric<>(NEW.form_json#>>'{sales,total,tax}')::numeric-(NEW.form_json#>>'{purchases,totalDeductibleTax}')::numeric
  THEN RAISE EXCEPTION 'VAT tax subtotal mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN f->>'key'='penalty' THEN (f->>'amount')::numeric ELSE -(f->>'amount')::numeric END),0)
    INTO manual_delta FROM jsonb_array_elements(NEW.form_json->'manual') f;
  payable:=(NEW.form_json->>'taxDue')::numeric+manual_delta-(metadata->>'noticeDeduction')::numeric;
  IF payable>0 THEN payable:=floor(payable/10)*10; END IF;
  IF (NEW.form_json->>'finalTaxDue')::numeric<>payable
  THEN RAISE EXCEPTION 'VAT final tax or notice deduction mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_filing_return_insert_guard ON vat_filing_return_revisions;
CREATE TRIGGER vat_filing_return_insert_guard BEFORE INSERT ON vat_filing_return_revisions FOR EACH ROW EXECUTE FUNCTION vat_filing_return_guard();
DROP TRIGGER IF EXISTS vat_filing_return_confirm_guard ON vat_filing_return_confirmations;
CREATE TRIGGER vat_filing_return_confirm_guard BEFORE INSERT ON vat_filing_return_confirmations FOR EACH ROW EXECUTE FUNCTION vat_filing_return_guard();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vat_filing_return_revisions','vat_filing_return_confirmations','vat_filing_return_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vat_filing_return_no_mutation ON %I',t);
    EXECUTE format('CREATE TRIGGER vat_filing_return_no_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vat_filing_append_only()',t);
  END LOOP;
END $$;
COMMIT;
