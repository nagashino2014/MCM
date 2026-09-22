-- C-a: 비금전 후행 별개 공급 검토. 기존 신고판/원천/금전 링크를 수정하지 않는다.
-- 실제 신고 소비는 C-b 계약이 준비될 때 새 migration으로 활성화한다.
BEGIN;

-- Earlier VAT definitions must not replace the sealed R1 installation.
DO $$ BEGIN
  IF pg_catalog.to_regprocedure(pg_catalog.format('%I.finance_assert_r1_definitions(text)', pg_catalog.current_schema())) IS NOT NULL THEN
    RAISE EXCEPTION 'VAT migration 233 cannot be reapplied after R1 installation' USING ERRCODE='55000';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_followup_hash(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(vat_post_canonical(v),'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION vat_followup_date(v text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN v IS NOT NULL AND v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   AND left(v,4)::integer BETWEEN 1000 AND 9999 AND v::date::text=v;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION vat_followup_money(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 n:=(v#>>'{}')::numeric;
 RETURN n>=0 AND n<=9007199254740991 AND n=trunc(n);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE TABLE IF NOT EXISTS vat_followup_review_roots (
 review_id text PRIMARY KEY CHECK(length(btrim(review_id)) BETWEEN 1 AND 200),
 subject_id text NOT NULL REFERENCES vat_filing_subjects(subject_id),
 collector_corp_num text NOT NULL CHECK(collector_corp_num ~ '^[0-9]{10}$'),
 application_path text NOT NULL CHECK(application_path IN('legacy','basis')),
 period_year integer NOT NULL CHECK(period_year BETWEEN 1000 AND 9999),
 period_term integer NOT NULL CHECK(period_term IN(1,2)),
 period_kind text NOT NULL CHECK(period_kind='final'),
 date_from text NOT NULL CHECK(vat_followup_date(date_from)),
 date_to text NOT NULL CHECK(vat_followup_date(date_to)),
 basis_snapshot_id text REFERENCES vat_filing_basis_snapshots(snapshot_id),
 created_by text NOT NULL CHECK(length(btrim(created_by)) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((application_path='basis')=(basis_snapshot_id IS NOT NULL)),
 CHECK(date_to=period_year::text||CASE period_term WHEN 1 THEN '-06-30' ELSE '-12-31' END),
 CHECK(date_from IN(period_year::text||CASE period_term WHEN 1 THEN '-01-01' ELSE '-07-01' END,
                     period_year::text||CASE period_term WHEN 1 THEN '-04-01' ELSE '-10-01' END)),
 CHECK(application_path<>'legacy' OR date_from=period_year::text||CASE period_term WHEN 1 THEN '-04-01' ELSE '-10-01' END),
 UNIQUE(review_id,subject_id)
);
CREATE TABLE IF NOT EXISTS vat_followup_review_requests (
 request_id text PRIMARY KEY CHECK(length(btrim(request_id)) BETWEEN 1 AND 200),
 action text NOT NULL CHECK(action IN('save','withdraw')),
 actor_user_id text NOT NULL CHECK(length(btrim(actor_user_id)) BETWEEN 1 AND 200),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 result_json jsonb NOT NULL CHECK(jsonb_typeof(result_json)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vat_followup_review_revisions (
 revision_id text PRIMARY KEY CHECK(length(btrim(revision_id)) BETWEEN 1 AND 200),
 review_id text NOT NULL REFERENCES vat_followup_review_roots(review_id),
 version integer NOT NULL CHECK(version>0),
 previous_revision_id text UNIQUE REFERENCES vat_followup_review_revisions(revision_id),
 schema_version text NOT NULL CHECK(schema_version='vat-followup-review-v1'),
 state text NOT NULL CHECK(state IN('recorded','verified','withdrawn')),
 payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$' AND payload_hash=vat_followup_hash(payload_json)),
 preview_hash text NOT NULL CHECK(preview_hash ~ '^[0-9a-f]{64}$'),
 evaluation_hash text NOT NULL CHECK(evaluation_hash ~ '^[0-9a-f]{64}$'),
 actor_user_id text NOT NULL CHECK(length(btrim(actor_user_id)) BETWEEN 1 AND 200),
 reviewed_by text,
 request_id text NOT NULL UNIQUE REFERENCES vat_followup_review_requests(request_id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(review_id,version), UNIQUE(revision_id,review_id),
 CHECK((version=1)=(previous_revision_id IS NULL)),
 CHECK(state='recorded' OR reviewed_by IS NOT NULL AND reviewed_by=actor_user_id),
 CHECK(payload_json->>'schemaVersion' IS NOT NULL AND payload_json->>'schemaVersion'=schema_version),
 CHECK(payload_json->>'state' IS NOT NULL AND payload_json->>'state'=state),
 CHECK(jsonb_typeof(payload_json->'application') IS NOT DISTINCT FROM 'object'),
 CHECK(jsonb_typeof(payload_json->'pairs') IS NOT DISTINCT FROM 'array'),
 CHECK(jsonb_array_length(payload_json->'pairs') BETWEEN 1 AND 100),
 CHECK((state='withdrawn' AND length(btrim(payload_json->>'withdrawalReason')) BETWEEN 1 AND 2000
        AND payload_json->>'withdrawalReason' IS NOT NULL)
    OR (state<>'withdrawn' AND payload_json ? 'withdrawalReason' AND payload_json->'withdrawalReason'='null'::jsonb))
);
CREATE TABLE IF NOT EXISTS vat_followup_review_pairs (
 revision_id text NOT NULL REFERENCES vat_followup_review_revisions(revision_id),
 line_no integer NOT NULL CHECK(line_no BETWEEN 0 AND 99),
 pair_key text NOT NULL CHECK(length(btrim(pair_key)) BETWEEN 1 AND 1000),
 pair_json jsonb NOT NULL CHECK(jsonb_typeof(pair_json)='object'),
 card_source_id text NOT NULL REFERENCES card_transactions(card_txn_id),
 invoice_source_id text NOT NULL REFERENCES hometax_tax_invoices(hti_id),
 card_source_hash text NOT NULL CHECK(card_source_hash ~ '^[0-9a-f]{64}$'),
 invoice_source_hash text NOT NULL CHECK(invoice_source_hash ~ '^[0-9a-f]{64}$'),
 historical_side text NOT NULL CHECK(historical_side IN('card','invoice')),
 past_origin text NOT NULL CHECK(past_origin IN('legacy','basis')),
 legacy_return_id text REFERENCES vat_returns(return_id),
 past_basis_snapshot_id text REFERENCES vat_filing_basis_snapshots(snapshot_id),
 past_fact_revision_id text REFERENCES vat_filing_fact_revisions(revision_id),
 document_id text NOT NULL REFERENCES vat_filing_documents(document_id),
 document_hash text NOT NULL CHECK(document_hash ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(revision_id,line_no), UNIQUE(revision_id,pair_key), UNIQUE(revision_id,card_source_id,invoice_source_id),
 CHECK((past_origin='legacy' AND legacy_return_id IS NOT NULL AND past_basis_snapshot_id IS NULL AND past_fact_revision_id IS NULL)
    OR (past_origin='basis' AND legacy_return_id IS NULL AND past_basis_snapshot_id IS NOT NULL AND past_fact_revision_id IS NOT NULL))
);
-- 소비 기능은 비활성이다. 실제 확정판 FK/legacy 불변 adapter가 준비되기 전 INSERT를 허용하지 않는다.
CREATE TABLE IF NOT EXISTS vat_followup_review_consumptions (
 consumption_id text PRIMARY KEY,
 revision_id text NOT NULL,
 pair_line_no integer NOT NULL,
 payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
 FOREIGN KEY(revision_id,pair_line_no) REFERENCES vat_followup_review_pairs(revision_id,line_no)
);
CREATE TABLE IF NOT EXISTS vat_followup_review_fences (
 key text PRIMARY KEY CHECK(length(key)>0),
 generation bigint NOT NULL CHECK(generation>0)
);
CREATE INDEX IF NOT EXISTS vat_followup_review_period_idx ON vat_followup_review_roots(subject_id,period_year,period_term,application_path);
CREATE INDEX IF NOT EXISTS vat_followup_review_pair_source_idx ON vat_followup_review_pairs(card_source_id,invoice_source_id);

CREATE OR REPLACE FUNCTION vat_followup_fence(k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1296256326,1);
 INSERT INTO vat_followup_review_fences(key,generation) VALUES(k,1)
 ON CONFLICT(key) DO UPDATE SET generation=vat_followup_review_fences.generation+1;
END $$;
CREATE OR REPLACE FUNCTION vat_followup_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'VAT followup evidence is immutable: %',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION vat_followup_no_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'C-a review consumption is not supported; C-b confirmation integration is required' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS vat_followup_consumption_disabled ON vat_followup_review_consumptions;
CREATE TRIGGER vat_followup_consumption_disabled BEFORE INSERT ON vat_followup_review_consumptions FOR EACH ROW EXECUTE FUNCTION vat_followup_no_consumption();

CREATE OR REPLACE FUNCTION vat_followup_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root vat_followup_review_roots%ROWTYPE; previous vat_followup_review_revisions%ROWTYPE;
 app jsonb; sub jsonb; bs vat_filing_basis_snapshots%ROWTYPE; p jsonb; scope_key text;
BEGIN
 PERFORM pg_advisory_xact_lock(1296256326,1);
 SELECT * INTO STRICT root FROM vat_followup_review_roots WHERE review_id=NEW.review_id;
 scope_key:=root.subject_id||':'||root.period_year::text||':'||root.period_term::text;
 PERFORM vat_followup_fence('scope:'||scope_key);
 PERFORM vat_followup_fence('review:'||NEW.review_id);
 FOR p IN SELECT value FROM jsonb_array_elements(NEW.payload_json->'pairs') ORDER BY value->>'pairKey' LOOP
  PERFORM vat_followup_fence('pair:'||scope_key||':'||COALESCE(p->>'pairKey',''));
 END LOOP;
 SELECT * INTO previous FROM vat_followup_review_revisions WHERE review_id=NEW.review_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR NEW.previous_revision_id IS DISTINCT FROM previous.revision_id
   OR (NEW.state='withdrawn' AND previous.revision_id IS NULL)
   OR (NEW.state='recorded' AND previous.state='verified')
 THEN RAISE EXCEPTION 'VAT followup revision chain/state conflict' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM vat_followup_review_consumptions c JOIN vat_followup_review_revisions r USING(revision_id) WHERE r.review_id=NEW.review_id)
 THEN RAISE EXCEPTION 'Consumed VAT followup review cannot be replaced' USING ERRCODE='23514'; END IF;
 app:=NEW.payload_json->'application';
 IF app->>'subjectId' IS DISTINCT FROM root.subject_id OR app->>'collectorCorpNum' IS DISTINCT FROM root.collector_corp_num
   OR app->>'year' IS DISTINCT FROM root.period_year::text OR app->>'term' IS DISTINCT FROM root.period_term::text
   OR app->>'kind' IS DISTINCT FROM root.period_kind OR app->>'path' IS DISTINCT FROM root.application_path
   OR app->>'dateFrom' IS DISTINCT FROM root.date_from OR app->>'dateTo' IS DISTINCT FROM root.date_to
   OR app->>'basisSnapshotId' IS DISTINCT FROM root.basis_snapshot_id
   OR app->>'priorFrom' IS DISTINCT FROM root.period_year::text||(CASE root.period_term WHEN 1 THEN '-01-01' ELSE '-07-01' END)
   OR app->>'priorTo' IS DISTINCT FROM root.period_year::text||(CASE root.period_term WHEN 1 THEN '-03-31' ELSE '-09-30' END)
   OR app->>'currentFrom' IS DISTINCT FROM root.period_year::text||(CASE root.period_term WHEN 1 THEN '-04-01' ELSE '-10-01' END)
 THEN RAISE EXCEPTION 'VAT followup application identity/period mismatch' USING ERRCODE='23514'; END IF;
 SELECT payload_json INTO STRICT sub FROM vat_filing_subject_revisions WHERE revision_id=app->>'subjectRevisionId' AND subject_id=root.subject_id;
 IF app->>'subjectHash' IS DISTINCT FROM vat_followup_hash(sub) OR sub->>'corpNum' IS DISTINCT FROM root.collector_corp_num
 THEN RAISE EXCEPTION 'VAT followup subject snapshot mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.state='verified' AND (
  sub->>'state' IS DISTINCT FROM 'verified' OR sub->>'entityType' IS DISTINCT FROM 'corporation'
  OR sub->>'vatRegime' IS DISTINCT FROM 'general' OR sub->>'filingUnit' IS DISTINCT FROM 'single_business_place'
  OR NOT vat_followup_date(sub->>'effectiveFrom') OR sub->>'effectiveFrom'>app->>'priorFrom'
  OR (sub->>'effectiveTo' IS NOT NULL AND (NOT vat_followup_date(sub->>'effectiveTo') OR sub->>'effectiveTo'<root.date_to))
  OR NOT vat_followup_server_document(sub->>'evidenceRef',sub->>'evidenceHash',root.subject_id)
  OR EXISTS(SELECT 1 FROM vat_filing_subject_revisions newer WHERE newer.subject_id=root.subject_id
     AND newer.version>(sub->>'version')::integer AND newer.payload_json->>'effectiveFrom'<=root.date_to
     AND (newer.payload_json->>'effectiveTo' IS NULL OR newer.payload_json->>'effectiveTo'>=app->>'priorFrom'))
  OR NEW.evaluation_hash IS DISTINCT FROM vat_followup_hash('{"canReview":true,"issues":[],"taxDelta":0}'::jsonb)
 ) THEN RAISE EXCEPTION 'VAT followup verified subject/evaluation evidence mismatch' USING ERRCODE='23514'; END IF;
 IF root.application_path='basis' THEN
  SELECT * INTO STRICT bs FROM vat_filing_basis_snapshots WHERE snapshot_id=root.basis_snapshot_id;
  IF bs.subject_id<>root.subject_id OR bs.period_year<>root.period_year OR bs.period_term<>root.period_term
   OR bs.period_kind<>'final' OR bs.date_from<>root.date_from OR bs.date_to<>root.date_to
  THEN RAISE EXCEPTION 'VAT followup basis application mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.state='withdrawn' THEN
  IF NEW.payload_json->'pairs' IS DISTINCT FROM previous.payload_json->'pairs'
    OR NEW.payload_json->'application' IS DISTINCT FROM previous.payload_json->'application'
  THEN RAISE EXCEPTION 'Withdrawal must preserve the previous full review evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF (root.application_path='legacy' AND EXISTS(SELECT 1 FROM vat_returns WHERE period_year=root.period_year AND period_term=root.period_term AND period_kind='final' AND status='confirmed'))
   OR (root.application_path='basis' AND EXISTS(SELECT 1 FROM vat_filing_return_confirmations c
     JOIN vat_filing_basis_snapshots b ON b.snapshot_id=c.basis_snapshot_id
     WHERE b.subject_id=root.subject_id AND b.period_year=root.period_year AND b.period_term=root.period_term AND b.period_kind='final'))
  THEN RAISE EXCEPTION 'The application return is already confirmed' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_followup_revision_insert ON vat_followup_review_revisions;
CREATE TRIGGER vat_followup_revision_insert BEFORE INSERT ON vat_followup_review_revisions FOR EACH ROW EXECUTE FUNCTION vat_followup_revision_guard();

-- JS 원천 해시 엔진을 복제하지 않는다. 실제 DB 의존 집합의 별도 digest를 DB에서 계산한다.
-- 전체 행 hash이므로 계산에 무관한 수집 메타 변경도 재검토를 요구할 수 있다.
CREATE OR REPLACE FUNCTION vat_followup_database_proof(card_id text,invoice_id text,
 legacy_return_id text DEFAULT NULL,basis_snapshot_id text DEFAULT NULL,fact_revision_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE card_row jsonb; invoice_row jsonb; official text; proof jsonb;
BEGIN
 SELECT to_jsonb(t) INTO STRICT card_row FROM card_transactions t WHERE t.card_txn_id=vat_followup_database_proof.card_id;
 SELECT to_jsonb(t),btrim(t.nts_send_key) INTO STRICT invoice_row,official FROM hometax_tax_invoices t WHERE t.hti_id=vat_followup_database_proof.invoice_id;
 proof:=jsonb_build_object('card',card_row,'invoice',invoice_row,
  'cardReview',(SELECT to_jsonb(r) FROM card_tax_reviews r WHERE r.card_txn_id=vat_followup_database_proof.card_id),
  'merchant',(SELECT to_jsonb(m) FROM card_merchant_corrections m WHERE m.card_txn_id=vat_followup_database_proof.card_id ORDER BY m.version DESC LIMIT 1),
  'refundPeers',COALESCE((SELECT jsonb_agg(jsonb_build_object('source',to_jsonb(t),'review',to_jsonb(r)) ORDER BY t.card_txn_id)
   FROM card_transactions t LEFT JOIN card_tax_reviews r ON r.card_txn_id=t.card_txn_id
   WHERE r.original_card_txn_id=vat_followup_database_proof.card_id OR (t.card_id=card_row->>'card_id' AND NULLIF(t.approval_num,'')=NULLIF(card_row->>'approval_num',''))),'[]'::jsonb),
  'hometaxAliases',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.hti_id) FROM hometax_tax_invoices t WHERE btrim(t.nts_send_key)=official),'[]'::jsonb),
  'appAliases',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.invoice_id) FROM tax_invoices t WHERE btrim(t.nts_send_key)=official),'[]'::jsonb),
  'links',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.link_id) FROM transaction_links l
   WHERE (l.left_kind='card' AND l.left_id=vat_followup_database_proof.card_id) OR (l.right_kind='hometax' AND l.right_id=vat_followup_database_proof.invoice_id)
     OR l.right_snapshot->>'canonicalKey'='invoice:'||official),'[]'::jsonb),
  'recognitions',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.recognition_id) FROM transaction_invoice_recognitions r
   WHERE r.canonical_invoice_key='invoice:'||official),'[]'::jsonb),
  'legacy',(SELECT to_jsonb(r) FROM vat_returns r WHERE r.return_id=vat_followup_database_proof.legacy_return_id),
  'basis',(SELECT to_jsonb(b) FROM vat_filing_basis_snapshots b WHERE b.snapshot_id=vat_followup_database_proof.basis_snapshot_id),
  'fact',(SELECT to_jsonb(f) FROM vat_filing_fact_revisions f WHERE f.revision_id=vat_followup_database_proof.fact_revision_id),
  'consumptions',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.consumption_id) FROM vat_filing_basis_consumptions c
   WHERE c.snapshot_id=vat_followup_database_proof.basis_snapshot_id AND c.revision_id=vat_followup_database_proof.fact_revision_id),'[]'::jsonb));
 RETURN jsonb_build_object('version','vat-followup-db-v1','digest',vat_followup_hash(proof));
END $$;

CREATE OR REPLACE FUNCTION vat_followup_server_document(ref text,expected_hash text,subject text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT ref IS NOT NULL AND ref LIKE 'vat-document:%' AND expected_hash IS NOT NULL AND EXISTS(
  SELECT 1 FROM vat_filing_documents d WHERE d.document_id=substr(ref,14) AND d.subject_id=subject
    AND d.content_sha256=expected_hash AND encode(sha256(d.content_bytes),'hex')=expected_hash
    AND octet_length(d.content_bytes)=d.size_bytes)
$$;

CREATE OR REPLACE FUNCTION vat_followup_pair_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev vat_followup_review_revisions%ROWTYPE; root vat_followup_review_roots%ROWTYPE;
 p jsonb; past jsonb; historical jsonb; current_source jsonb; claim jsonb; s jsonb; field text;
 d vat_filing_documents%ROWTYPE; archive jsonb; bs vat_filing_basis_snapshots%ROWTYPE;
 fact vat_filing_fact_revisions%ROWTYPE; sub jsonb; card_row card_transactions%ROWTYPE;
 invoice_row hometax_tax_invoices%ROWTYPE; tax_review card_tax_reviews%ROWTYPE;
 corrected record; effective_corp text; card_supply numeric; card_tax numeric; card_total numeric;
 allocated_supply numeric; allocated_tax numeric; invoice_alloc_supply numeric; invoice_alloc_tax numeric;
 expected_claim jsonb; form jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(1296256326,1);
 SELECT * INTO STRICT rev FROM vat_followup_review_revisions WHERE revision_id=NEW.revision_id;
 SELECT * INTO STRICT root FROM vat_followup_review_roots WHERE review_id=rev.review_id;
 p:=NEW.pair_json; past:=p->'past'; claim:=past->'claim';
 IF rev.payload_json->'pairs'->NEW.line_no IS DISTINCT FROM p
  OR p->>'pairKey' IS DISTINCT FROM NEW.pair_key
  OR NEW.pair_key IS DISTINCT FROM vat_followup_hash(jsonb_build_array('card',NEW.card_source_id,'hometax',NEW.invoice_source_id))
  OR p#>>'{card,kind}' IS DISTINCT FROM 'card'
  OR p#>>'{invoice,kind}' IS DISTINCT FROM 'hometax'
  OR p#>>'{card,id}' IS DISTINCT FROM NEW.card_source_id OR p#>>'{invoice,id}' IS DISTINCT FROM NEW.invoice_source_id
  OR p#>>'{card,sourceHash}' IS DISTINCT FROM NEW.card_source_hash OR p#>>'{invoice,sourceHash}' IS DISTINCT FROM NEW.invoice_source_hash
  OR p->>'historicalSide' IS DISTINCT FROM NEW.historical_side OR past->>'origin' IS DISTINCT FROM NEW.past_origin
  OR past->>'legacyReturnId' IS DISTINCT FROM NEW.legacy_return_id OR past->>'basisSnapshotId' IS DISTINCT FROM NEW.past_basis_snapshot_id
  OR past->>'factRevisionId' IS DISTINCT FROM NEW.past_fact_revision_id OR past->>'subjectId' IS DISTINCT FROM root.subject_id
  OR p#>>'{document,documentId}' IS DISTINCT FROM NEW.document_id OR p#>>'{document,evidenceHash}' IS DISTINCT FROM NEW.document_hash
  OR jsonb_typeof(p->'issues') IS DISTINCT FROM 'array'
  OR COALESCE(length(btrim(p->>'evidenceLocation')),0) NOT BETWEEN 1 AND 1000
  OR COALESCE(length(btrim(p->>'reason')),0) NOT BETWEEN 1 AND 4000
 THEN RAISE EXCEPTION 'VAT followup pair/payload projection mismatch' USING ERRCODE='23514'; END IF;
 -- 철회는 기존 원문을 그대로 보존한다. 현재 원천이 바뀌었다는 이유로 미소비 철회를 막지 않는다.
 IF rev.state='withdrawn' THEN
  IF NOT EXISTS(SELECT 1 FROM vat_followup_review_pairs prior_pair WHERE prior_pair.revision_id=rev.previous_revision_id AND prior_pair.line_no=NEW.line_no AND prior_pair.pair_json=p)
  THEN RAISE EXCEPTION 'Withdrawal pair differs from previous review' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO STRICT d FROM vat_filing_documents WHERE document_id=NEW.document_id;
 IF d.subject_id<>root.subject_id OR d.content_sha256<>NEW.document_hash OR encode(sha256(d.content_bytes),'hex')<>NEW.document_hash
  OR octet_length(d.content_bytes)<>d.size_bytes
 THEN RAISE EXCEPTION 'VAT followup evidence document mismatch' USING ERRCODE='23514'; END IF;
 IF p->'databaseProof' IS DISTINCT FROM vat_followup_database_proof(NEW.card_source_id,NEW.invoice_source_id,NEW.legacy_return_id,NEW.past_basis_snapshot_id,NEW.past_fact_revision_id)
 THEN RAISE EXCEPTION 'VAT followup current database proof changed' USING ERRCODE='23514'; END IF;
 FOREACH field IN ARRAY ARRAY['card','invoice'] LOOP
  s:=p->field;
  IF s->>'direction' IS DISTINCT FROM 'purchase' OR s->>'hashVersion' IS DISTINCT FROM 'transaction-source-v1'
   OR jsonb_typeof(s->'sourceBasis') IS DISTINCT FROM 'object' OR s#>>'{sourceBasis,version}' IS DISTINCT FROM '1'
   OR s#>>'{sourceBasis,kind}' IS DISTINCT FROM s->>'kind' OR jsonb_typeof(s#>'{sourceBasis,raw}') IS DISTINCT FROM 'object'
   OR NOT vat_followup_date(s->>'date') OR NOT vat_followup_date(s->>'accountingDate')
   OR COALESCE(length(s->>'canonicalKey'),0)=0 OR jsonb_typeof(s->'aliases') IS DISTINCT FROM 'array'
   OR NOT vat_followup_money(s->'supply') OR NOT vat_followup_money(s->'tax') OR NOT vat_followup_money(s->'total')
   OR NOT vat_followup_money(s->'claimSupply') OR NOT vat_followup_money(s->'claimTax') OR NOT vat_followup_money(s->'claimTotal')
   OR NOT vat_followup_money(s->'claimedTax')
   OR (s->>'total')::numeric<>(s->>'supply')::numeric+(s->>'tax')::numeric
   OR (s->>'claimTotal')::numeric<>(s->>'claimSupply')::numeric+(s->>'claimTax')::numeric
   OR (s->>'claimSupply')::numeric>(s->>'supply')::numeric OR (s->>'claimTax')::numeric>(s->>'tax')::numeric
   OR (s->>'claimedTax')::numeric>(s->>'claimTax')::numeric
  THEN RAISE EXCEPTION 'VAT followup source snapshot shape/amount mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF past->>'archiveHash' IS DISTINCT FROM vat_followup_hash(past->'archive')
  OR past->>'from' IS DISTINCT FROM rev.payload_json#>>'{application,priorFrom}' OR past->>'to' IS DISTINCT FROM rev.payload_json#>>'{application,priorTo}'
 THEN RAISE EXCEPTION 'VAT followup historical archive hash/period mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.past_origin='legacy' THEN
  SELECT to_jsonb(r) INTO STRICT archive FROM vat_returns r WHERE r.return_id=NEW.legacy_return_id;
  IF archive IS DISTINCT FROM past->'archive' OR past->>'scopeHash' IS NOT NULL OR past->>'consumptionId' IS NOT NULL
   OR archive->>'status' IS DISTINCT FROM 'confirmed' OR archive->>'period_kind' IS DISTINCT FROM 'pre'
   OR archive->>'period_year' IS DISTINCT FROM root.period_year::text OR archive->>'period_term' IS DISTINCT FROM root.period_term::text
   OR archive->>'date_from' IS DISTINCT FROM past->>'from' OR archive->>'date_to' IS DISTINCT FROM past->>'to'
  THEN RAISE EXCEPTION 'VAT followup legacy confirmed archive mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO STRICT bs FROM vat_filing_basis_snapshots WHERE snapshot_id=NEW.past_basis_snapshot_id;
  SELECT * INTO STRICT fact FROM vat_filing_fact_revisions WHERE revision_id=NEW.past_fact_revision_id;
  IF bs.subject_id<>root.subject_id OR bs.period_year<>root.period_year OR bs.period_term<>root.period_term
   OR bs.scope_json IS DISTINCT FROM past->'archive' OR bs.scope_hash IS DISTINCT FROM past->>'scopeHash'
   OR bs.scope_hash IS DISTINCT FROM vat_followup_hash(bs.scope_json-'scopeHash')
   OR fact.subject_id<>root.subject_id OR fact.kind<>'filing' OR fact.state<>'verified'
   OR fact.date_from<>past->>'from' OR fact.date_to<>past->>'to'
   OR NOT EXISTS(SELECT 1 FROM vat_filing_basis_consumptions c WHERE c.consumption_id=past->>'consumptionId'
      AND c.snapshot_id=bs.snapshot_id AND c.revision_id=fact.revision_id AND c.fact_id=fact.fact_id AND c.subject_id=root.subject_id AND c.kind='filing')
  THEN RAISE EXCEPTION 'VAT followup B1 filing consumption/archive mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF rev.state<>'verified' THEN RETURN NEW; END IF;
 IF jsonb_array_length(p->'issues')<>0 THEN RAISE EXCEPTION 'Unresolved review cannot be verified' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM vat_followup_review_pairs other_pair
  JOIN vat_followup_review_revisions other_rev ON other_rev.revision_id=other_pair.revision_id
  JOIN vat_followup_review_roots other_root ON other_root.review_id=other_rev.review_id
  WHERE other_root.review_id<>root.review_id AND other_root.subject_id=root.subject_id
    AND other_root.period_year=root.period_year AND other_root.period_term=root.period_term
    AND other_root.application_path=root.application_path AND other_root.basis_snapshot_id IS NOT DISTINCT FROM root.basis_snapshot_id
    AND other_rev.state='verified' AND other_pair.pair_key=NEW.pair_key
    AND NOT EXISTS(SELECT 1 FROM vat_followup_review_revisions newer WHERE newer.review_id=other_rev.review_id AND newer.version>other_rev.version))
 THEN RAISE EXCEPTION 'Exact pair already has a current verified review in this application' USING ERRCODE='23514'; END IF;
 historical:=p->NEW.historical_side; current_source:=p->(CASE NEW.historical_side WHEN 'card' THEN 'invoice' ELSE 'card' END);
 IF (current_source->>'claimTax')::numeric<=0 OR (current_source->>'claimTotal')::numeric<=0
 THEN RAISE EXCEPTION 'VAT followup current claim must have positive tax and total' USING ERRCODE='23514'; END IF;
 IF NOT vat_followup_money(claim->'supply') OR NOT vat_followup_money(claim->'tax') OR NOT vat_followup_money(claim->'claimedTax')
  OR (claim->>'claimedTax')::numeric<=0 OR (claim->>'claimedTax')::numeric>(claim->>'tax')::numeric
  OR claim->>'direction' IS DISTINCT FROM 'purchase' OR claim->>'canonicalKey' IS DISTINCT FROM historical->>'canonicalKey'
  OR claim->>'date' IS DISTINCT FROM historical->>'date'
  OR (claim->>'supply')::numeric<>(historical->>'claimSupply')::numeric OR (claim->>'tax')::numeric<>(historical->>'claimTax')::numeric
  OR (claim->>'claimedTax')::numeric<>(historical->>'claimedTax')::numeric
  OR historical->>'date'<past->>'from' OR historical->>'date'>past->>'to'
  OR current_source->>'date'<rev.payload_json#>>'{application,currentFrom}' OR current_source->>'date'>root.date_to
  OR past->>'origin' IS DISTINCT FROM root.application_path
  OR (root.application_path='basis' AND past->>'basisSnapshotId' IS DISTINCT FROM root.basis_snapshot_id)
  OR NOT ((claim->>'sourceKind'=historical->>'kind' AND claim->>'sourceId'=historical->>'id' AND claim->>'sourceHash'=historical->>'sourceHash')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(historical->'aliases') a WHERE a->>'kind'=claim->>'sourceKind' AND a->>'id'=claim->>'sourceId' AND a->>'sourceHash'=claim->>'sourceHash' AND a->'active'='true'::jsonb))
 THEN RAISE EXCEPTION 'VAT followup prior claimed source mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.past_origin='basis' THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fact.payload_json->'sourceCoverage') c WHERE c=claim)
   OR fact.payload_json#>>'{data,sourceReconciliation}' IS DISTINCT FROM 'complete'
   OR past->>'evidenceVerification' IS DISTINCT FROM 'server_document_verified'
   OR NOT vat_followup_server_document(fact.payload_json->>'evidenceRef',fact.payload_json->>'evidenceHash',root.subject_id)
  THEN RAISE EXCEPTION 'VAT followup B1 declared claim/server evidence mismatch' USING ERRCODE='23514'; END IF;
  SELECT payload_json INTO STRICT sub FROM vat_filing_subject_revisions WHERE revision_id=bs.subject_revision_id;
  IF NOT vat_followup_server_document(sub->>'evidenceRef',sub->>'evidenceHash',root.subject_id)
  THEN RAISE EXCEPTION 'VAT followup B1 subject server evidence unavailable' USING ERRCODE='23514'; END IF;
 ELSE
  form:=archive->'form_json';
  IF form#>>'{duplicateReview,version}' IS DISTINCT FROM 'g03b-r0-v1'
   OR past->>'evidenceVerification' IS DISTINCT FROM 'legacy_internal_snapshot_only'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(form#>'{duplicateReview,claimSources}') c
    WHERE c->>'kind'=claim->>'sourceKind' AND c->>'sourceId'=claim->>'sourceId' AND c->>'canonicalKey'=claim->>'canonicalKey'
     AND c->>'sourceHash'=claim->>'sourceHash' AND c->>'date'=claim->>'date'
     AND c->>'supply'=claim->>'supply' AND c->>'tax'=claim->>'tax' AND c->>'tax'=claim->>'claimedTax')
  THEN RAISE EXCEPTION 'VAT followup legacy claimed source unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 -- 현재 DB 금액·주체·공제 핵심값을 별도 검증한다. JS alias/세무엔진 전체의 대체는 아니다.
 SELECT * INTO STRICT card_row FROM card_transactions WHERE card_txn_id=NEW.card_source_id;
 SELECT * INTO STRICT invoice_row FROM hometax_tax_invoices WHERE hti_id=NEW.invoice_source_id;
 SELECT * INTO tax_review FROM card_tax_reviews WHERE card_txn_id=NEW.card_source_id;
 SELECT * INTO corrected FROM card_merchant_corrections WHERE card_txn_id=NEW.card_source_id ORDER BY version DESC LIMIT 1;
 effective_corp:=CASE WHEN corrected.action='correct' THEN corrected.corp_num ELSE card_row.store_corp_num END;
 IF effective_corp IS NULL OR effective_corp !~ '^[0-9[:space:]-]+$' THEN effective_corp:=NULL;
 ELSE effective_corp:=regexp_replace(effective_corp,'[[:space:]-]','','g'); END IF;
 IF card_row.approval_type<>'승인' OR COALESCE(card_row.excluded,0)<>0 OR COALESCE(card_row.service_charge,0)<>0
  OR card_row.supply_amount IS NULL OR card_row.tax_amount IS NULL OR card_row.supply_amount<0 OR card_row.tax_amount<0
  OR card_row.amount_total<>card_row.supply_amount+card_row.tax_amount
  OR p#>>'{card,canonicalKey}' IS DISTINCT FROM 'card:'||NEW.card_source_id
  OR (p#>>'{card,supply}')::numeric<>card_row.supply_amount OR (p#>>'{card,tax}')::numeric<>card_row.tax_amount OR (p#>>'{card,total}')::numeric<>card_row.amount_total
  OR p#>>'{card,accountingDate}' IS DISTINCT FROM left(card_row.approved_at::text,10)
  OR p#>>'{card,date}' IS DISTINCT FROM COALESCE(NULLIF(tax_review.tax_date,''),left(card_row.approved_at::text,10))
  OR p#>>'{card,partyCorpNum}' IS DISTINCT FROM effective_corp OR COALESCE(effective_corp,'') !~ '^[0-9]{10}$'
  OR invoice_row.direction<>'purchase' OR COALESCE(invoice_row.excluded,0)<>0
  OR invoice_row.vat_deductible IS DISTINCT FROM 1
  OR (p#>>'{invoice,supply}')::numeric<>invoice_row.amount_total OR (p#>>'{invoice,tax}')::numeric<>invoice_row.tax_total OR (p#>>'{invoice,total}')::numeric<>invoice_row.total_amount
  OR p#>>'{invoice,canonicalKey}' IS DISTINCT FROM 'invoice:'||btrim(invoice_row.nts_send_key)
  OR p#>>'{invoice,date}' IS DISTINCT FROM left(invoice_row.write_date::text,10)
  OR p#>>'{invoice,accountingDate}' IS DISTINCT FROM left(invoice_row.write_date::text,10)
  OR regexp_replace(COALESCE(invoice_row.invoicee_corp_num,''),'[[:space:]-]','','g')<>root.collector_corp_num
  OR p#>>'{invoice,partyCorpNum}' IS DISTINCT FROM regexp_replace(COALESCE(invoice_row.invoicer_corp_num,''),'[[:space:]-]','','g')
  OR p#>>'{invoice,partyCorpNum}' IS DISTINCT FROM p#>>'{card,partyCorpNum}'
 THEN RAISE EXCEPTION 'VAT followup current source amount/identity mismatch' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(supply),0),COALESCE(sum(tax),0) INTO allocated_supply,allocated_tax FROM transaction_links
  WHERE state='active' AND relation='card_invoice' AND left_kind='card' AND left_id=NEW.card_source_id;
 IF (p#>>'{card,claimSupply}')::numeric<>card_row.supply_amount-allocated_supply
   OR (p#>>'{card,claimTax}')::numeric<>card_row.tax_amount-allocated_tax
   OR (p#>>'{invoice,claimSupply}')::numeric<>invoice_row.amount_total OR (p#>>'{invoice,claimTax}')::numeric<>invoice_row.tax_total
   OR tax_review.decision IS DISTINCT FROM 1 OR NULLIF(btrim(tax_review.reason),'') IS NULL OR NULLIF(btrim(tax_review.evidence_ref),'') IS NULL
 THEN RAISE EXCEPTION 'VAT followup current deductible claim mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM transaction_links l WHERE l.state='active' AND l.relation='card_invoice'
    AND l.left_kind='card' AND l.left_id=NEW.card_source_id
    AND (l.right_id=NEW.invoice_source_id OR l.right_snapshot->>'canonicalKey'=p#>>'{invoice,canonicalKey}'))
 THEN RAISE EXCEPTION 'Same-supply allocation conflicts with distinct review' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_followup_pair_insert ON vat_followup_review_pairs;
CREATE TRIGGER vat_followup_pair_insert BEFORE INSERT ON vat_followup_review_pairs FOR EACH ROW EXECUTE FUNCTION vat_followup_pair_guard();

CREATE OR REPLACE FUNCTION vat_followup_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r vat_followup_review_revisions%ROWTYPE; request vat_followup_review_requests%ROWTYPE; actual jsonb; rid text;
BEGIN
 IF TG_TABLE_NAME='vat_followup_review_roots' THEN
  IF NOT EXISTS(SELECT 1 FROM vat_followup_review_revisions WHERE review_id=NEW.review_id)
  THEN RAISE EXCEPTION 'VAT followup root has no revision' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='vat_followup_review_requests' THEN
  SELECT revision_id INTO rid FROM vat_followup_review_revisions WHERE request_id=NEW.request_id;
 ELSE rid:=NEW.revision_id; END IF;
 SELECT * INTO STRICT r FROM vat_followup_review_revisions WHERE revision_id=rid;
 SELECT * INTO STRICT request FROM vat_followup_review_requests WHERE request_id=r.request_id;
 SELECT COALESCE(jsonb_agg(pair_json ORDER BY line_no),'[]'::jsonb) INTO actual FROM vat_followup_review_pairs WHERE revision_id=r.revision_id;
 IF actual IS DISTINCT FROM r.payload_json->'pairs'
  OR request.actor_user_id<>r.actor_user_id OR request.action IS DISTINCT FROM (CASE r.state WHEN 'withdrawn' THEN 'withdraw' ELSE 'save' END)
  OR request.result_json->>'reviewId' IS DISTINCT FROM r.review_id OR request.result_json->>'revisionId' IS DISTINCT FROM r.revision_id
  OR request.result_json->>'version' IS DISTINCT FROM r.version::text OR request.result_json->>'state' IS DISTINCT FROM r.state
  OR request.result_json->>'applicationStatus' IS DISTINCT FROM 'not_integrated_in_ca'
 THEN RAISE EXCEPTION 'VAT followup complete payload/request mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['vat_followup_review_roots','vat_followup_review_revisions','vat_followup_review_pairs','vat_followup_review_requests'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS vat_followup_complete ON %I',t);
  EXECUTE format('CREATE CONSTRAINT TRIGGER vat_followup_complete AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_followup_complete_guard()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['vat_followup_review_roots','vat_followup_review_revisions','vat_followup_review_pairs','vat_followup_review_requests','vat_followup_review_consumptions'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS vat_followup_immutable ON %I',t);
  EXECUTE format('CREATE TRIGGER vat_followup_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vat_followup_no_mutation()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS vat_followup_no_truncate ON %I',t);
  EXECUTE format('CREATE TRIGGER vat_followup_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vat_followup_no_mutation()',t);
 END LOOP;
END $$;
COMMIT;
