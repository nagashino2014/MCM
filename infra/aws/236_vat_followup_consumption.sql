-- C-b2: 정확한 C 검토 쌍을 v2 내부 확정에 소비한다. 기존 v1 원문/함수는 유지한다.
BEGIN;

-- Earlier VAT definitions must not replace the sealed R1 installation.
DO $$ BEGIN
  IF pg_catalog.to_regprocedure(pg_catalog.format('%I.finance_assert_r1_definitions(text)', pg_catalog.current_schema())) IS NOT NULL THEN
    RAISE EXCEPTION 'VAT migration 236 cannot be reapplied after R1 installation' USING ERRCODE='55000';
  END IF;
END $$;

DO $$ DECLARE installed_version text;
BEGIN
  IF EXISTS(SELECT 1 FROM vat_followup_review_consumptions) THEN
    IF to_regprocedure('vat_followup_consumption_version()') IS NULL
      OR to_regclass('vat_followup_legacy_archives') IS NULL
      OR (SELECT count(*) FROM pg_attribute WHERE attrelid='vat_followup_review_consumptions'::regclass
        AND attname IN('basis_confirmation_id','legacy_archive_id','calculation_hash','created_by','created_at') AND NOT attisdropped)<>5
      OR (SELECT count(*) FROM pg_constraint WHERE conrelid='vat_followup_review_consumptions'::regclass
        AND conname IN('vat_followup_consumption_target','vat_followup_consumption_pair_once'))<>2
    THEN RAISE EXCEPTION 'Unexpected pre-activation VAT followup consumptions require review' USING ERRCODE='55000'; END IF;
    EXECUTE 'SELECT vat_followup_consumption_version()' INTO installed_version;
    IF installed_version IS DISTINCT FROM 'vat-followup-consumption-v2'
    THEN RAISE EXCEPTION 'Unrecognized existing VAT followup consumption version' USING ERRCODE='55000'; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_followup_consumption_version() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'vat-followup-consumption-v2'::text $$;

-- 닫힌 proof 전용: UTF8 키 순서, 안전한 정수, 배열 순서 유지. 소수/raw form의 정규화가 아니다.
CREATE OR REPLACE FUNCTION vat_followup_canonical_v2(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text; n numeric; scalar text;
BEGIN
  CASE jsonb_typeof(v)
    WHEN 'object' THEN
      SELECT '{'||COALESCE(string_agg(vat_followup_canonical_v2(to_jsonb(k))||':'||vat_followup_canonical_v2(x),',' ORDER BY k COLLATE "C"),'')||'}'
        INTO result FROM jsonb_each(v) e(k,x);
    WHEN 'array' THEN
      SELECT '['||COALESCE(string_agg(vat_followup_canonical_v2(x),',' ORDER BY ord),'')||']'
        INTO result FROM jsonb_array_elements(v) WITH ORDINALITY e(x,ord);
    WHEN 'number' THEN
      n:=(v#>>'{}')::numeric;
      IF n<>trunc(n) OR abs(n)>9007199254740991
      THEN RAISE EXCEPTION 'VAT canonical v2 requires safe integers' USING ERRCODE='23514'; END IF;
      result:=trunc(n)::text;
    WHEN 'string' THEN
      scalar:=v#>>'{}';
      -- jsonb/UTF8 입력 자체도 NUL과 잘못된 surrogate를 거절한다.
      IF position(decode('00','hex') IN convert_to(scalar,'UTF8'))>0
      THEN RAISE EXCEPTION 'VAT canonical v2 does not allow null characters' USING ERRCODE='23514'; END IF;
      result:=to_json(scalar)::text;
    WHEN 'boolean' THEN result:=v::text;
    WHEN 'null' THEN result:='null';
    ELSE RAISE EXCEPTION 'Unsupported VAT canonical v2 value' USING ERRCODE='23514';
  END CASE;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION vat_followup_hash_v2(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT encode(sha256(convert_to(vat_followup_canonical_v2(v),'UTF8')),'hex') $$;

CREATE TABLE IF NOT EXISTS vat_followup_legacy_archives (
  archive_id text PRIMARY KEY CHECK(length(btrim(archive_id)) BETWEEN 1 AND 200),
  return_id text NOT NULL UNIQUE REFERENCES vat_returns(return_id),
  schema_version text NOT NULL CHECK(schema_version='vat-return-legacy-v2'),
  calculation_hash text NOT NULL CHECK(calculation_hash ~ '^[0-9a-f]{64}$'),
  form_json jsonb NOT NULL CHECK(jsonb_typeof(form_json)='object'),
  row_json jsonb NOT NULL CHECK(jsonb_typeof(row_json)='object'),
  created_by text NOT NULL CHECK(length(btrim(created_by)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vat_followup_review_consumptions
  ADD COLUMN IF NOT EXISTS basis_confirmation_id text REFERENCES vat_filing_return_confirmations(confirmation_id),
  ADD COLUMN IF NOT EXISTS legacy_archive_id text REFERENCES vat_followup_legacy_archives(archive_id),
  ADD COLUMN IF NOT EXISTS calculation_hash text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE vat_followup_review_consumptions ALTER COLUMN calculation_hash SET NOT NULL, ALTER COLUMN created_by SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vat_followup_review_consumptions'::regclass AND conname='vat_followup_consumption_target') THEN
    ALTER TABLE vat_followup_review_consumptions ADD CONSTRAINT vat_followup_consumption_target CHECK(
      (basis_confirmation_id IS NOT NULL)::integer+(legacy_archive_id IS NOT NULL)::integer=1
      AND calculation_hash ~ '^[0-9a-f]{64}$' AND length(btrim(created_by)) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vat_followup_review_consumptions'::regclass AND conname='vat_followup_consumption_pair_once') THEN
    ALTER TABLE vat_followup_review_consumptions ADD CONSTRAINT vat_followup_consumption_pair_once UNIQUE(revision_id,pair_line_no);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_followup_base_projection_v2(form jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (form-ARRAY['generatedAt','warnings','ledgerSnapshot','followupConsumption','filingBasis'])
    || CASE WHEN form ? 'filingBasis' THEN jsonb_build_object('filingBasis',(form->'filingBasis')-'calculationHash') ELSE '{}'::jsonb END
    || jsonb_build_object('ledgerRows',form#>'{ledgerSnapshot,rows}')
$$;

-- immutable draft でも保管行・型・hashは照合。最新/現在性は実際の確定/消費時に別途検証する。
CREATE OR REPLACE FUNCTION vat_followup_validate_form_v2(form jsonb,application_path text,basis_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE fc jsonb; app jsonb; entry jsonb; proofs jsonb:='[]'::jsonb; expected_order jsonb;
  rev vat_followup_review_revisions%ROWTYPE; pair_row vat_followup_review_pairs%ROWTYPE;
  root vat_followup_review_roots%ROWTYPE; current_source jsonb; proof jsonb; computed text; parsed_base jsonb; parsed_plan jsonb;
  field text; amount numeric; manual_delta numeric; payable numeric;
BEGIN
  fc:=form->'followupConsumption'; app:=fc->'application';
  IF jsonb_typeof(fc) IS DISTINCT FROM 'object'
    OR fc-ARRAY['version','canonicalVersion','application','pairs','baseCalculationText','baseCalculationHash','planText','planHash','calculationHash']<>'{}'::jsonb
    OR fc->>'version' IS DISTINCT FROM 'vat-followup-consumption-v2'
    OR fc->>'canonicalVersion' IS DISTINCT FROM 'vat-canonical-v2'
    OR jsonb_typeof(fc->'baseCalculationText') IS DISTINCT FROM 'string'
    OR jsonb_typeof(fc->'planText') IS DISTINCT FROM 'string'
    OR COALESCE(fc->>'baseCalculationHash','') !~ '^[0-9a-f]{64}$'
    OR COALESCE(fc->>'planHash','') !~ '^[0-9a-f]{64}$'
    OR COALESCE(fc->>'calculationHash','') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(app) IS DISTINCT FROM 'object'
    OR jsonb_typeof(fc->'pairs') IS DISTINCT FROM 'array'
    OR jsonb_typeof(form->'blockingIssues') IS DISTINCT FROM 'array'
    OR jsonb_typeof(form#>'{ledgerSnapshot,rows}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(form->'manual') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'VAT followup v2 form shape mismatch' USING ERRCODE='23514'; END IF;
  IF app-ARRAY['subjectId','year','term','kind','path','basisSnapshotId','collectorCorpNum','subjectRevisionId','subjectHash','dateFrom','dateTo','priorFrom','priorTo','currentFrom']<>'{}'::jsonb
    OR NOT vat_followup_money(app->'year') OR (app->>'year')::numeric NOT BETWEEN 1000 AND 9999
    OR NOT vat_followup_money(app->'term') OR (app->>'term')::numeric NOT IN(1,2)
    OR NOT(app ? 'basisSnapshotId')
    OR jsonb_typeof(app->'basisSnapshotId') NOT IN('null','string')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['subjectId','kind','path','collectorCorpNum','subjectRevisionId','subjectHash','dateFrom','dateTo','priorFrom','priorTo','currentFrom']) k
      WHERE jsonb_typeof(app->k) IS DISTINCT FROM 'string' OR length(btrim(app->>k))=0)
    OR application_path NOT IN('basis','legacy')
  THEN RAISE EXCEPTION 'VAT followup closed application shape mismatch' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(fc->'pairs') NOT BETWEEN 1 AND 100
    OR app->>'path' IS DISTINCT FROM application_path OR app->>'kind' IS DISTINCT FROM 'final'
    OR app->>'basisSnapshotId' IS DISTINCT FROM basis_id
    OR form#>'{period,year}' IS DISTINCT FROM app->'year' OR form#>'{period,term}' IS DISTINCT FROM app->'term'
    OR form#>>'{period,kind}' IS DISTINCT FROM 'final'
    OR form#>>'{period,from}' IS DISTINCT FROM app->>'dateFrom' OR form#>>'{period,to}' IS DISTINCT FROM app->>'dateTo'
    OR (application_path='basis' AND (form#>>'{filingBasis,version}' IS DISTINCT FROM 'vat-return-basis-v2'
      OR form#>>'{filingBasis,basisSnapshotId}' IS DISTINCT FROM basis_id))
    OR (application_path='legacy' AND form ? 'filingBasis')
  THEN RAISE EXCEPTION 'VAT followup v2 application mismatch' USING ERRCODE='23514'; END IF;
  BEGIN parsed_base:=(fc->>'baseCalculationText')::jsonb; parsed_plan:=(fc->>'planText')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'VAT followup base calculation text is invalid' USING ERRCODE='23514'; END;
  IF parsed_base IS DISTINCT FROM vat_followup_base_projection_v2(form)
    OR fc->>'baseCalculationHash' IS DISTINCT FROM encode(sha256(convert_to(fc->>'baseCalculationText','UTF8')),'hex')
  THEN RAISE EXCEPTION 'VAT followup base calculation text/hash mismatch' USING ERRCODE='23514'; END IF;
  IF parsed_plan IS DISTINCT FROM jsonb_build_object('application',app,'pairs',fc->'pairs')
    OR fc->>'planHash' IS DISTINCT FROM encode(sha256(convert_to(fc->>'planText','UTF8')),'hex')
  THEN RAISE EXCEPTION 'VAT followup plan text/hash mismatch' USING ERRCODE='23514'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(fc->'pairs') LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR entry-ARRAY['reviewId','revisionId','pairLineNo','pairKey','payloadHash','pair','priorClaimedTax','currentClaimableTax']<>'{}'::jsonb
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['reviewId','revisionId','pairKey','payloadHash']) k WHERE jsonb_typeof(entry->k) IS DISTINCT FROM 'string' OR length(btrim(entry->>k))=0)
      OR NOT vat_followup_money(entry->'pairLineNo') OR (entry->>'pairLineNo')::numeric>99
      OR NOT vat_followup_money(entry->'priorClaimedTax') OR (entry->>'priorClaimedTax')::numeric<=0
      OR NOT vat_followup_money(entry->'currentClaimableTax') OR (entry->>'currentClaimableTax')::numeric<=0
    THEN RAISE EXCEPTION 'VAT followup consumption entry shape/amount mismatch' USING ERRCODE='23514'; END IF;
    SELECT * INTO STRICT rev FROM vat_followup_review_revisions WHERE revision_id=entry->>'revisionId';
    SELECT * INTO STRICT root FROM vat_followup_review_roots WHERE review_id=rev.review_id;
    SELECT * INTO STRICT pair_row FROM vat_followup_review_pairs WHERE revision_id=rev.revision_id AND line_no=(entry->>'pairLineNo')::integer;
    current_source:=pair_row.pair_json->(CASE pair_row.historical_side WHEN 'card' THEN 'invoice' ELSE 'card' END);
    IF entry->>'reviewId' IS DISTINCT FROM rev.review_id OR entry->>'payloadHash' IS DISTINCT FROM rev.payload_hash
      OR entry->>'pairKey' IS DISTINCT FROM pair_row.pair_key OR entry->'pair' IS DISTINCT FROM pair_row.pair_json
      OR app IS DISTINCT FROM rev.payload_json->'application'
      OR entry->'priorClaimedTax' IS DISTINCT FROM pair_row.pair_json#>'{past,claim,claimedTax}'
      OR entry->'currentClaimableTax' IS DISTINCT FROM current_source->'claimTax'
      OR root.application_path IS DISTINCT FROM application_path OR root.basis_snapshot_id IS DISTINCT FROM basis_id
    THEN RAISE EXCEPTION 'VAT followup selected stored pair mismatch' USING ERRCODE='23514'; END IF;
    proofs:=proofs||jsonb_build_array(jsonb_build_object('revisionId',entry->'revisionId','pairLineNo',entry->'pairLineNo',
      'pairKey',entry->'pairKey','payloadHash',entry->'payloadHash','priorClaimedTax',entry->'priorClaimedTax','currentClaimableTax',entry->'currentClaimableTax'));
  END LOOP;
  SELECT jsonb_agg(e ORDER BY (e->>'revisionId') COLLATE "C",(e->>'pairLineNo')::integer)
    INTO expected_order FROM jsonb_array_elements(fc->'pairs') e;
  IF expected_order IS DISTINCT FROM fc->'pairs'
    OR (SELECT count(*)<>count(DISTINCT e->>'pairKey') FROM jsonb_array_elements(fc->'pairs') e)
    OR (SELECT count(*)<>count(DISTINCT (e->>'revisionId',e->>'pairLineNo')) FROM jsonb_array_elements(fc->'pairs') e)
  THEN RAISE EXCEPTION 'VAT followup selected pair order/uniqueness mismatch' USING ERRCODE='23514'; END IF;
  proof:=jsonb_build_object('version','vat-followup-calculation-v2','baseCalculationHash',fc->'baseCalculationHash',
    'planHash',fc->'planHash','applicationHash',vat_followup_hash_v2(app),'pairs',proofs);
  computed:=vat_followup_hash_v2(proof);
  IF computed IS DISTINCT FROM fc->>'calculationHash'
    OR (application_path='basis' AND computed IS DISTINCT FROM form#>>'{filingBasis,calculationHash}')
  THEN RAISE EXCEPTION 'VAT followup v2 calculation hash mismatch' USING ERRCODE='23514'; END IF;
  -- 기존 계산식 그대로: legacy에도 안전한 정수/합계/수기/끝수 검산을 적용한다.
  FOREACH field IN ARRAY ARRAY['sales,total,tax','sales,invoiceTaxable,tax','sales,deemedRent,tax','purchases,totalDeductibleTax',
    'purchases,invoiceGeneral,tax','purchases,nonDeductible,tax','purchases,invoiceUndecided,tax','purchases,cardDeductible,tax','taxDue','finalTaxDue'] LOOP
    IF jsonb_typeof(form#>string_to_array(field,',')) IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'VAT followup required tax amount missing' USING ERRCODE='23514'; END IF;
    amount:=(form#>>string_to_array(field,','))::numeric;
    IF amount<>trunc(amount) OR abs(amount)>9007199254740991
    THEN RAISE EXCEPTION 'VAT followup tax amount outside integer range' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(form->'manual') e WHERE NOT vat_followup_money(e->'amount')
      OR e->>'key' IS NULL OR e->>'key' NOT IN('etaxCredit','penalty','prepaidNotice','prepaidUnrefunded'))
    OR (SELECT count(*)<>count(DISTINCT e->>'key') FROM jsonb_array_elements(form->'manual') e)
    OR (form#>>'{sales,total,tax}')::numeric<>(form#>>'{sales,invoiceTaxable,tax}')::numeric+(form#>>'{sales,deemedRent,tax}')::numeric
    OR (form#>>'{purchases,totalDeductibleTax}')::numeric<>(form#>>'{purchases,invoiceGeneral,tax}')::numeric-(form#>>'{purchases,nonDeductible,tax}')::numeric-(form#>>'{purchases,invoiceUndecided,tax}')::numeric+(form#>>'{purchases,cardDeductible,tax}')::numeric
    OR (form->>'taxDue')::numeric<>(form#>>'{sales,total,tax}')::numeric-(form#>>'{purchases,totalDeductibleTax}')::numeric
  THEN RAISE EXCEPTION 'VAT followup tax subtotal/manual mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN e->>'key'='penalty' THEN (e->>'amount')::numeric ELSE -(e->>'amount')::numeric END),0)
    INTO manual_delta FROM jsonb_array_elements(form->'manual') e;
  payable:=(form->>'taxDue')::numeric+manual_delta-CASE WHEN application_path='basis' THEN (form#>>'{filingBasis,noticeDeduction}')::numeric ELSE 0 END;
  IF payable>0 THEN payable:=floor(payable/10)*10; END IF;
  IF payable IS NULL OR (form->>'finalTaxDue')::numeric<>payable
  THEN RAISE EXCEPTION 'VAT followup final tax mismatch' USING ERRCODE='23514'; END IF;
  RETURN fc;
EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'VAT followup selected reference missing' USING ERRCODE='23514';
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'VAT followup numeric/reference format invalid' USING ERRCODE='23514';
END $$;

-- 현재 DB의 원문/문서/공제 핵심을 다시 대조한다. JS 원천/별칭 엔진 전체의 대체가 아니다.
CREATE OR REPLACE FUNCTION vat_followup_assert_consumable(entry jsonb,app jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rev vat_followup_review_revisions%ROWTYPE; root vat_followup_review_roots%ROWTYPE;
  p vat_followup_review_pairs%ROWTYPE; b vat_filing_basis_snapshots%ROWTYPE; f vat_filing_fact_revisions%ROWTYPE;
  subject_json jsonb; archive jsonb; claim jsonb; historical jsonb; current_source jsonb; actual_claims jsonb;
BEGIN
  SELECT * INTO STRICT rev FROM vat_followup_review_revisions WHERE revision_id=entry->>'revisionId';
  PERFORM vat_followup_fence('review:'||rev.review_id);
  SELECT * INTO STRICT root FROM vat_followup_review_roots WHERE review_id=rev.review_id;
  SELECT * INTO STRICT p FROM vat_followup_review_pairs WHERE revision_id=rev.revision_id AND line_no=(entry->>'pairLineNo')::integer;
  IF p.legacy_return_id IS NOT NULL THEN PERFORM vat_followup_fence('legacy:'||p.legacy_return_id); END IF;
  IF rev.state<>'verified' OR EXISTS(SELECT 1 FROM vat_followup_review_revisions r WHERE r.review_id=rev.review_id AND r.version>rev.version)
    OR EXISTS(SELECT 1 FROM vat_followup_review_consumptions c WHERE c.revision_id=rev.revision_id AND c.pair_line_no=p.line_no)
    OR rev.payload_json->'application' IS DISTINCT FROM app OR p.pair_json IS DISTINCT FROM entry->'pair'
    OR p.pair_json->'issues' IS DISTINCT FROM '[]'::jsonb
    OR p.pair_json->'databaseProof' IS DISTINCT FROM vat_followup_database_proof(p.card_source_id,p.invoice_source_id,p.legacy_return_id,p.past_basis_snapshot_id,p.past_fact_revision_id)
    OR NOT vat_followup_server_document('vat-document:'||p.document_id,p.document_hash,root.subject_id)
  THEN RAISE EXCEPTION 'VAT followup review is stale, consumed, or not verified' USING ERRCODE='23514'; END IF;
  SELECT payload_json INTO STRICT subject_json FROM vat_filing_subject_revisions
    WHERE revision_id=app->>'subjectRevisionId' AND subject_id=root.subject_id;
  IF vat_followup_hash(subject_json) IS DISTINCT FROM app->>'subjectHash'
    OR subject_json->>'corpNum' IS DISTINCT FROM root.collector_corp_num
    OR subject_json->>'state' IS DISTINCT FROM 'verified' OR subject_json->>'entityType' IS DISTINCT FROM 'corporation'
    OR subject_json->>'vatRegime' IS DISTINCT FROM 'general' OR subject_json->>'filingUnit' IS DISTINCT FROM 'single_business_place'
    OR NOT vat_followup_server_document(subject_json->>'evidenceRef',subject_json->>'evidenceHash',root.subject_id)
    OR EXISTS(SELECT 1 FROM vat_filing_subject_revisions r WHERE r.subject_id=root.subject_id AND r.version>(subject_json->>'version')::integer
      AND r.payload_json->>'effectiveFrom'<=root.date_to AND (r.payload_json->>'effectiveTo' IS NULL OR r.payload_json->>'effectiveTo'>=app->>'priorFrom'))
  THEN RAISE EXCEPTION 'VAT followup current subject evidence mismatch' USING ERRCODE='23514'; END IF;
  claim:=p.pair_json#>'{past,claim}'; historical:=p.pair_json->p.historical_side;
  current_source:=p.pair_json->(CASE p.historical_side WHEN 'card' THEN 'invoice' ELSE 'card' END);
  IF NOT vat_followup_money(claim->'claimedTax') OR (claim->>'claimedTax')::numeric<=0
    OR (claim->>'claimedTax')::numeric>(claim->>'tax')::numeric
    OR entry->'priorClaimedTax' IS DISTINCT FROM claim->'claimedTax'
    OR historical->'claimedTax' IS DISTINCT FROM claim->'claimedTax'
    OR entry->'currentClaimableTax' IS DISTINCT FROM current_source->'claimTax'
    OR NOT vat_followup_money(current_source->'claimTax') OR (current_source->>'claimTax')::numeric<=0
  THEN RAISE EXCEPTION 'VAT followup prior/current claim mismatch' USING ERRCODE='23514'; END IF;
  IF p.past_origin='legacy' THEN
    SELECT to_jsonb(r) INTO STRICT archive FROM vat_returns r WHERE r.return_id=p.legacy_return_id;
    IF archive IS DISTINCT FROM p.pair_json#>'{past,archive}' OR archive->>'status'<>'confirmed' OR archive->>'period_kind'<>'pre'
      OR p.pair_json#>>'{past,evidenceVerification}' IS DISTINCT FROM 'legacy_internal_snapshot_only'
    THEN RAISE EXCEPTION 'VAT followup historical legacy evidence changed' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceKind',e->'kind','sourceId',e->'sourceId','canonicalKey',e->'canonicalKey',
      'sourceHash',e->'sourceHash','direction','purchase','supply',e->'supply','tax',e->'tax','claimedTax',e->'tax','date',e->'date')),'[]'::jsonb)
      INTO actual_claims FROM jsonb_array_elements(archive#>'{form_json,duplicateReview,claimSources}') e
      WHERE e->>'kind'=claim->>'sourceKind' AND e->>'sourceId'=claim->>'sourceId';
  ELSE
    SELECT * INTO STRICT b FROM vat_filing_basis_snapshots WHERE snapshot_id=p.past_basis_snapshot_id;
    SELECT * INTO STRICT f FROM vat_filing_fact_revisions WHERE revision_id=p.past_fact_revision_id;
    IF b.subject_id<>root.subject_id OR b.scope_json IS DISTINCT FROM p.pair_json#>'{past,archive}'
      OR b.snapshot_id IS DISTINCT FROM root.basis_snapshot_id OR f.state<>'verified' OR f.kind<>'filing'
      OR f.payload_json#>>'{data,sourceReconciliation}' IS DISTINCT FROM 'complete'
      OR p.pair_json#>>'{past,evidenceVerification}' IS DISTINCT FROM 'server_document_verified'
      OR NOT vat_followup_server_document(f.payload_json->>'evidenceRef',f.payload_json->>'evidenceHash',root.subject_id)
      OR NOT EXISTS(SELECT 1 FROM vat_filing_basis_consumptions c WHERE c.consumption_id=p.pair_json#>>'{past,consumptionId}'
        AND c.snapshot_id=b.snapshot_id AND c.revision_id=f.revision_id AND c.kind='filing')
    THEN RAISE EXCEPTION 'VAT followup historical filing evidence changed' USING ERRCODE='23514'; END IF;
    SELECT payload_json INTO STRICT subject_json FROM vat_filing_subject_revisions WHERE revision_id=b.subject_revision_id;
    IF NOT vat_followup_server_document(subject_json->>'evidenceRef',subject_json->>'evidenceHash',root.subject_id)
    THEN RAISE EXCEPTION 'VAT followup historical subject document unavailable' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(jsonb_agg(e),'[]'::jsonb) INTO actual_claims FROM jsonb_array_elements(f.payload_json->'sourceCoverage') e
      WHERE e->>'canonicalKey'=claim->>'canonicalKey' AND e->>'sourceKind'=claim->>'sourceKind' AND e->>'sourceId'=claim->>'sourceId';
  END IF;
  IF actual_claims IS DISTINCT FROM jsonb_build_array(claim)
  THEN RAISE EXCEPTION 'VAT followup exact historical claimed amount unavailable' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM transaction_links l WHERE l.relation IN('card_invoice','distinct')
    AND l.left_kind='card' AND l.left_id=p.card_source_id AND (l.right_id=p.invoice_source_id OR l.right_snapshot->>'canonicalKey'=p.pair_json#>>'{invoice,canonicalKey}')
    AND (l.state='active' OR l.relation='card_invoice' AND l.state='cancelled'))
  THEN RAISE EXCEPTION 'VAT followup pair is already resolved or conflicts with a supply link' USING ERRCODE='23514'; END IF;
EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'VAT followup current evidence reference missing' USING ERRCODE='23514';
END $$;

-- v1 CHECK만 폭넓게 풀지 않는다. v2는 아래 별도 검산 트리거를 반드시 거친다.
ALTER TABLE vat_filing_return_revisions DROP CONSTRAINT IF EXISTS vat_filing_return_revisions_schema_version_check;
ALTER TABLE vat_filing_return_revisions ADD CONSTRAINT vat_filing_return_revisions_schema_version_check
  CHECK(schema_version IN('vat-return-basis-v1','vat-return-basis-v2'));
CREATE OR REPLACE FUNCTION vat_followup_basis_v2_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r vat_filing_return_revisions%ROWTYPE; fc jsonb; e jsonb;
BEGIN
  IF TG_TABLE_NAME='vat_filing_return_revisions' THEN r:=NEW;
  ELSE SELECT * INTO STRICT r FROM vat_filing_return_revisions WHERE return_id=NEW.return_id; END IF;
  IF r.schema_version='vat-return-basis-v1' THEN
    IF r.form_json ? 'followupConsumption' THEN RAISE EXCEPTION 'V1 VAT return cannot consume followup review' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  fc:=vat_followup_validate_form_v2(r.form_json,'basis',r.basis_snapshot_id);
  IF r.calculation_hash IS DISTINCT FROM fc->>'calculationHash'
  THEN RAISE EXCEPTION 'VAT followup stored calculation hash mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='vat_filing_return_confirmations' THEN
    IF r.form_json->'blockingIssues' IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'Unresolved VAT followup return cannot be confirmed' USING ERRCODE='23514'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(fc->'pairs') LOOP PERFORM vat_followup_assert_consumable(e,fc->'application'); END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_followup_basis_v2_guard ON vat_filing_return_revisions;
CREATE TRIGGER vat_followup_basis_v2_guard BEFORE INSERT ON vat_filing_return_revisions FOR EACH ROW EXECUTE FUNCTION vat_followup_basis_v2_guard();
DROP TRIGGER IF EXISTS vat_followup_basis_v2_guard ON vat_filing_return_confirmations;
CREATE TRIGGER vat_followup_basis_v2_guard BEFORE INSERT ON vat_filing_return_confirmations FOR EACH ROW EXECUTE FUNCTION vat_followup_basis_v2_guard();

CREATE OR REPLACE FUNCTION vat_followup_legacy_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fc jsonb; e jsonb;
BEGIN
  IF TG_OP IN('UPDATE','DELETE') THEN
    PERFORM vat_followup_fence('legacy:'||OLD.return_id);
    IF EXISTS(SELECT 1 FROM vat_followup_legacy_archives a WHERE a.return_id=OLD.return_id)
      OR EXISTS(SELECT 1 FROM vat_followup_review_consumptions c JOIN vat_followup_review_pairs p ON p.revision_id=c.revision_id AND p.line_no=c.pair_line_no WHERE p.legacy_return_id=OLD.return_id)
    THEN
      IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Consumed VAT legacy evidence cannot be changed or removed' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  END IF;
  IF NOT(NEW.form_json ? 'followupConsumption') THEN RETURN NEW; END IF;
  fc:=vat_followup_validate_form_v2(NEW.form_json,'legacy',NULL);
  IF to_jsonb(NEW.period_year) IS DISTINCT FROM fc#>'{application,year}' OR to_jsonb(NEW.period_term) IS DISTINCT FROM fc#>'{application,term}'
    OR NEW.period_kind<>'final' OR NEW.date_from IS DISTINCT FROM fc#>>'{application,dateFrom}' OR NEW.date_to IS DISTINCT FROM fc#>>'{application,dateTo}'
  THEN RAISE EXCEPTION 'VAT followup legacy row period mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status='confirmed' THEN
    IF NEW.form_json->'blockingIssues' IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'Unresolved legacy VAT followup return cannot be confirmed' USING ERRCODE='23514'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(fc->'pairs') LOOP PERFORM vat_followup_assert_consumable(e,fc->'application'); END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_followup_legacy_write_guard ON vat_returns;
CREATE TRIGGER vat_followup_legacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON vat_returns FOR EACH ROW EXECUTE FUNCTION vat_followup_legacy_write_guard();

CREATE OR REPLACE FUNCTION vat_followup_legacy_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_now jsonb; fc jsonb;
BEGIN
  PERFORM vat_followup_fence('legacy:'||NEW.return_id);
  SELECT to_jsonb(r) INTO STRICT row_now FROM vat_returns r WHERE r.return_id=NEW.return_id;
  fc:=vat_followup_validate_form_v2(NEW.form_json,'legacy',NULL);
  IF row_now IS DISTINCT FROM NEW.row_json OR row_now->'form_json' IS DISTINCT FROM NEW.form_json
    OR row_now->>'status' IS DISTINCT FROM 'confirmed' OR row_now->>'period_kind' IS DISTINCT FROM 'final'
    OR NEW.calculation_hash IS DISTINCT FROM fc->>'calculationHash'
    OR NEW.created_by IS DISTINCT FROM row_now->>'confirmed_by'
  THEN RAISE EXCEPTION 'VAT followup immutable legacy archive mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_followup_legacy_archive_guard ON vat_followup_legacy_archives;
CREATE TRIGGER vat_followup_legacy_archive_guard BEFORE INSERT ON vat_followup_legacy_archives FOR EACH ROW EXECUTE FUNCTION vat_followup_legacy_archive_guard();
DROP TRIGGER IF EXISTS vat_followup_immutable ON vat_followup_legacy_archives;
CREATE TRIGGER vat_followup_immutable BEFORE UPDATE OR DELETE ON vat_followup_legacy_archives FOR EACH ROW EXECUTE FUNCTION vat_followup_no_mutation();
DROP TRIGGER IF EXISTS vat_followup_no_truncate ON vat_followup_legacy_archives;
CREATE TRIGGER vat_followup_no_truncate BEFORE TRUNCATE ON vat_followup_legacy_archives FOR EACH STATEMENT EXECUTE FUNCTION vat_followup_no_mutation();

CREATE OR REPLACE FUNCTION vat_followup_consumption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE form jsonb; fc jsonb; path text; basis_id text; actor text; target_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  IF NEW.basis_confirmation_id IS NOT NULL THEN
    SELECT r.form_json,r.basis_snapshot_id,c.confirmed_by,c.calculation_hash INTO STRICT form,basis_id,actor,target_hash
      FROM vat_filing_return_confirmations c JOIN vat_filing_return_revisions r ON r.return_id=c.return_id
      WHERE c.confirmation_id=NEW.basis_confirmation_id AND r.schema_version='vat-return-basis-v2';
    path:='basis';
  ELSE
    SELECT a.form_json,a.created_by,a.calculation_hash INTO STRICT form,actor,target_hash
      FROM vat_followup_legacy_archives a WHERE a.archive_id=NEW.legacy_archive_id;
    path:='legacy'; basis_id:=NULL;
  END IF;
  fc:=vat_followup_validate_form_v2(form,path,basis_id);
  IF NEW.payload_json->>'revisionId' IS DISTINCT FROM NEW.revision_id
    OR NEW.payload_json->'pairLineNo' IS DISTINCT FROM to_jsonb(NEW.pair_line_no)
    OR NEW.calculation_hash IS DISTINCT FROM target_hash OR NEW.calculation_hash IS DISTINCT FROM fc->>'calculationHash'
    OR NEW.created_by IS DISTINCT FROM actor OR form->'blockingIssues' IS DISTINCT FROM '[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fc->'pairs') e WHERE e=NEW.payload_json)
  THEN RAISE EXCEPTION 'VAT followup consumption target/pair mismatch' USING ERRCODE='23514'; END IF;
  PERFORM vat_followup_assert_consumable(NEW.payload_json,fc->'application');
  RETURN NEW;
EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'VAT followup actual v2 confirmation target missing' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS vat_followup_consumption_disabled ON vat_followup_review_consumptions;
DROP TRIGGER IF EXISTS vat_followup_consumption_guard ON vat_followup_review_consumptions;
CREATE TRIGGER vat_followup_consumption_guard BEFORE INSERT ON vat_followup_review_consumptions FOR EACH ROW EXECUTE FUNCTION vat_followup_consumption_guard();

CREATE OR REPLACE FUNCTION vat_followup_consumption_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE form jsonb; fc jsonb; actual jsonb; target_id text; path text; basis_id text;
BEGIN
  IF TG_TABLE_NAME='vat_returns' THEN
    SELECT form_json INTO form FROM vat_returns WHERE return_id=NEW.return_id AND status='confirmed';
    IF form IS NULL OR NOT(form ? 'followupConsumption') THEN RETURN NULL; END IF;
    SELECT archive_id INTO target_id FROM vat_followup_legacy_archives WHERE return_id=NEW.return_id;
    path:='legacy';
  ELSIF TG_TABLE_NAME='vat_followup_legacy_archives' THEN target_id:=NEW.archive_id; path:='legacy';
  ELSIF TG_TABLE_NAME='vat_filing_return_confirmations' THEN
    target_id:=NEW.confirmation_id; path:='basis';
  ELSE
    path:=CASE WHEN NEW.basis_confirmation_id IS NOT NULL THEN 'basis' ELSE 'legacy' END;
    target_id:=COALESCE(NEW.basis_confirmation_id,NEW.legacy_archive_id);
  END IF;
  IF target_id IS NULL THEN RAISE EXCEPTION 'Confirmed legacy followup return has no immutable archive' USING ERRCODE='23514'; END IF;
  IF path='basis' THEN
    SELECT r.form_json,r.basis_snapshot_id INTO STRICT form,basis_id FROM vat_filing_return_confirmations c
      JOIN vat_filing_return_revisions r ON r.return_id=c.return_id WHERE c.confirmation_id=target_id;
    IF NOT(form ? 'followupConsumption') THEN RETURN NULL; END IF;
    SELECT COALESCE(jsonb_agg(c.payload_json ORDER BY c.payload_json->>'revisionId' COLLATE "C",c.pair_line_no),'[]'::jsonb)
      INTO actual FROM vat_followup_review_consumptions c WHERE c.basis_confirmation_id=target_id;
  ELSE
    SELECT a.form_json INTO STRICT form FROM vat_followup_legacy_archives a WHERE a.archive_id=target_id;
    SELECT COALESCE(jsonb_agg(c.payload_json ORDER BY c.payload_json->>'revisionId' COLLATE "C",c.pair_line_no),'[]'::jsonb)
      INTO actual FROM vat_followup_review_consumptions c WHERE c.legacy_archive_id=target_id;
  END IF;
  fc:=vat_followup_validate_form_v2(form,path,basis_id);
  IF actual IS DISTINCT FROM fc->'pairs'
  THEN RAISE EXCEPTION 'Confirmed VAT followup form and consumed pairs do not match exactly' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vat_filing_return_confirmations','vat_followup_legacy_archives','vat_followup_review_consumptions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vat_followup_consumption_complete ON %I',t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER vat_followup_consumption_complete AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_followup_consumption_complete()',t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS vat_followup_consumption_complete ON vat_returns;
CREATE CONSTRAINT TRIGGER vat_followup_consumption_complete AFTER INSERT OR UPDATE ON vat_returns
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_followup_consumption_complete();

COMMIT;
