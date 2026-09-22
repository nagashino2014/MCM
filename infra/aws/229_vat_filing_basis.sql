-- B1: 신고 주체/외부 사실/봉인된 근거 및 소비 이력. 실제 신고서 계산·제출은 B2/B3.
-- 기존 vat_returns와 원본 원천은 변경하지 않는다.
BEGIN;

CREATE TABLE IF NOT EXISTS vat_filing_subjects (
  subject_id text PRIMARY KEY CHECK (length(subject_id) BETWEEN 1 AND 200)
);
CREATE TABLE IF NOT EXISTS vat_filing_subject_revisions (
  revision_id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES vat_filing_subjects(subject_id),
  version integer NOT NULL CHECK(version > 0),
  previous_revision_id text UNIQUE REFERENCES vat_filing_subject_revisions(revision_id),
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  actor_user_id text NOT NULL CHECK(length(actor_user_id)>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,version),
  UNIQUE(revision_id,subject_id),
  CHECK ((version=1)=(previous_revision_id IS NULL)),
  CHECK (payload_json->>'revisionId' IS NOT NULL AND payload_json->>'revisionId'=revision_id),
  CHECK (payload_json->>'subjectId' IS NOT NULL AND payload_json->>'subjectId'=subject_id),
  CHECK (payload_json->>'version' IS NOT NULL AND (payload_json->>'version')::integer=version)
);
CREATE TABLE IF NOT EXISTS vat_filing_facts (
  fact_id text PRIMARY KEY CHECK(length(fact_id) BETWEEN 1 AND 200),
  subject_id text NOT NULL REFERENCES vat_filing_subjects(subject_id),
  kind text NOT NULL CHECK(kind IN ('notice','no_notice','filing','refund','payment')),
  external_key text NOT NULL CHECK(length(external_key) BETWEEN 1 AND 300),
  UNIQUE(subject_id,kind,external_key),
  UNIQUE(fact_id,subject_id,kind)
);
CREATE TABLE IF NOT EXISTS vat_filing_fact_revisions (
  revision_id text PRIMARY KEY,
  fact_id text NOT NULL,
  subject_id text NOT NULL,
  kind text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  previous_revision_id text UNIQUE REFERENCES vat_filing_fact_revisions(revision_id),
  state text NOT NULL CHECK(state IN ('recorded','verified','withdrawn')),
  period_year integer NOT NULL CHECK(period_year BETWEEN 1000 AND 9999),
  period_term integer NOT NULL CHECK(period_term IN (1,2)),
  date_from text NOT NULL CHECK(date_from ~ '^\d{4}-\d{2}-\d{2}$' AND date_from::date::text=date_from),
  date_to text NOT NULL CHECK(date_to ~ '^\d{4}-\d{2}-\d{2}$' AND date_to::date::text=date_to AND date_to>=date_from),
  amount bigint CHECK(abs(amount)<=9007199254740991),
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  actor_user_id text NOT NULL CHECK(length(actor_user_id)>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(fact_id,subject_id,kind) REFERENCES vat_filing_facts(fact_id,subject_id,kind),
  UNIQUE(fact_id,version),
  UNIQUE(revision_id,fact_id,subject_id,kind),
  CHECK ((version=1)=(previous_revision_id IS NULL)),
  CHECK (payload_json->>'revisionId' IS NOT NULL AND payload_json->>'revisionId'=revision_id),
  CHECK (payload_json->>'factId' IS NOT NULL AND payload_json->>'factId'=fact_id),
  CHECK (payload_json->>'subjectId' IS NOT NULL AND payload_json->>'subjectId'=subject_id),
  CHECK (payload_json->>'kind' IS NOT NULL AND payload_json->>'kind'=kind),
  CHECK (payload_json->>'state' IS NOT NULL AND payload_json->>'state'=state),
  CHECK (payload_json->>'version' IS NOT NULL AND (payload_json->>'version')::integer=version),
  CHECK (payload_json->>'year' IS NOT NULL AND (payload_json->>'year')::integer=period_year),
  CHECK (payload_json->>'term' IS NOT NULL AND (payload_json->>'term')::integer=period_term),
  CHECK (payload_json->>'from' IS NOT NULL AND payload_json->>'from'=date_from),
  CHECK (payload_json->>'to' IS NOT NULL AND payload_json->>'to'=date_to),
  CHECK (payload_json ? 'amount' AND (payload_json->>'amount')::bigint IS NOT DISTINCT FROM amount)
);
-- 사용자 요청 키/별칭이 달라도 같은 공식 고지·접수 문서를 두 사실로 중복 등록하지 못한다.
CREATE TABLE IF NOT EXISTS vat_filing_document_keys (
  subject_id text NOT NULL,
  kind text NOT NULL,
  document_key text NOT NULL CHECK(length(document_key)>0),
  fact_id text NOT NULL,
  PRIMARY KEY(subject_id,kind,document_key),
  FOREIGN KEY(fact_id,subject_id,kind) REFERENCES vat_filing_facts(fact_id,subject_id,kind)
);
CREATE TABLE IF NOT EXISTS vat_filing_basis_snapshots (
  snapshot_id text PRIMARY KEY,
  subject_id text NOT NULL,
  subject_revision_id text NOT NULL,
  period_year integer NOT NULL CHECK(period_year BETWEEN 1000 AND 9999),
  period_term integer NOT NULL CHECK(period_term IN(1,2)),
  period_kind text NOT NULL CHECK(period_kind IN('preliminary','final')),
  date_from text NOT NULL CHECK(date_from ~ '^\d{4}-\d{2}-\d{2}$' AND date_from::date::text=date_from),
  date_to text NOT NULL CHECK(date_to ~ '^\d{4}-\d{2}-\d{2}$' AND date_to::date::text=date_to AND date_to>=date_from),
  schema_version text NOT NULL CHECK(schema_version='vat-filing-basis-v1'),
  scope_hash text NOT NULL CHECK(scope_hash ~ '^[0-9a-f]{64}$'),
  scope_json jsonb NOT NULL CHECK(jsonb_typeof(scope_json)='object'),
  consumption_plan jsonb NOT NULL CHECK(jsonb_typeof(consumption_plan)='array'),
  actor_user_id text NOT NULL CHECK(length(actor_user_id)>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(subject_revision_id,subject_id) REFERENCES vat_filing_subject_revisions(revision_id,subject_id),
  UNIQUE(subject_id,period_year,period_term,period_kind),
  CHECK (scope_json->>'subjectId' IS NOT NULL AND scope_json->>'subjectRevisionId' IS NOT NULL
    AND scope_json->>'year' IS NOT NULL AND scope_json->>'term' IS NOT NULL AND scope_json->>'kind' IS NOT NULL
    AND scope_json->>'dateFrom' IS NOT NULL AND scope_json->>'dateTo' IS NOT NULL),
  CHECK (scope_json->>'schemaVersion'=schema_version AND scope_json->>'schemaVersion' IS NOT NULL),
  CHECK (scope_json->>'scopeHash'=scope_hash AND scope_json->>'scopeHash' IS NOT NULL),
  CHECK (scope_json->>'status'='ready' AND scope_json->>'status' IS NOT NULL),
  CHECK (scope_json->'consumptions'=consumption_plan AND scope_json ? 'consumptions'),
  CHECK (scope_json->>'subjectId'=subject_id AND scope_json ? 'subjectId'),
  CHECK (scope_json->>'subjectRevisionId'=subject_revision_id AND scope_json ? 'subjectRevisionId'),
  CHECK ((scope_json->>'year')::integer=period_year AND scope_json ? 'year'),
  CHECK ((scope_json->>'term')::integer=period_term AND scope_json ? 'term'),
  CHECK (scope_json->>'kind'=period_kind AND scope_json ? 'kind'),
  CHECK (scope_json->>'dateFrom'=date_from AND scope_json ? 'dateFrom'),
  CHECK (scope_json->>'dateTo'=date_to AND scope_json ? 'dateTo')
);
CREATE TABLE IF NOT EXISTS vat_filing_basis_consumptions (
  consumption_id text PRIMARY KEY,
  snapshot_id text NOT NULL REFERENCES vat_filing_basis_snapshots(snapshot_id),
  fact_id text NOT NULL,
  revision_id text NOT NULL,
  subject_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN('notice','filing','refund')),
  amount bigint NOT NULL CHECK(abs(amount)<=9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(revision_id,fact_id,subject_id,kind) REFERENCES vat_filing_fact_revisions(revision_id,fact_id,subject_id,kind),
  -- B1은 전체 고지/기신고 명세만 봉인한다. 부분 환급 소비는 미지원이며 B2 이후 별도 계약.
  UNIQUE(fact_id,kind),
  UNIQUE(snapshot_id,fact_id,kind)
);
CREATE TABLE IF NOT EXISTS vat_filing_requests (
  request_id text PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 200),
  action text NOT NULL CHECK(action IN('subject_revision','fact_revision','seal_basis')),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL CHECK(jsonb_typeof(result_json)='object'),
  actor_user_id text NOT NULL CHECK(length(actor_user_id)>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION vat_filing_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'VAT filing evidence is append-only: %', TG_TABLE_NAME USING ERRCODE='23514'; END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['vat_filing_subjects','vat_filing_subject_revisions','vat_filing_facts','vat_filing_fact_revisions','vat_filing_document_keys','vat_filing_basis_snapshots','vat_filing_basis_consumptions','vat_filing_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vat_filing_no_mutation ON %I',name);
    EXECUTE format('CREATE TRIGGER vat_filing_no_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vat_filing_append_only()',name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION vat_filing_revision_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_id text; previous_version integer; previous_year integer; previous_term integer; expected_external_key text; document_key_value text; document_owner text;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  IF TG_TABLE_NAME='vat_filing_subject_revisions' THEN
    PERFORM 1 FROM vat_filing_subjects WHERE subject_id=NEW.subject_id FOR UPDATE;
    SELECT revision_id,version INTO previous_id,previous_version FROM vat_filing_subject_revisions WHERE subject_id=NEW.subject_id ORDER BY version DESC LIMIT 1;
  ELSE
    PERFORM 1 FROM vat_filing_facts WHERE fact_id=NEW.fact_id FOR UPDATE;
    SELECT revision_id,version,period_year,period_term INTO previous_id,previous_version,previous_year,previous_term FROM vat_filing_fact_revisions WHERE fact_id=NEW.fact_id ORDER BY version DESC LIMIT 1;
    IF previous_id IS NOT NULL AND (previous_year<>NEW.period_year OR previous_term<>NEW.period_term) THEN
      RAISE EXCEPTION 'VAT fact tax period identity cannot change' USING ERRCODE='23514';
    END IF;
    SELECT external_key INTO expected_external_key FROM vat_filing_facts WHERE fact_id=NEW.fact_id;
    IF NEW.payload_json->'data'->>'externalKey' IS DISTINCT FROM expected_external_key
       OR NEW.payload_json->'data'->>'supersedesRevisionId' IS DISTINCT FROM NEW.previous_revision_id THEN
      RAISE EXCEPTION 'VAT fact identity/lineage mismatch' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM vat_filing_basis_consumptions WHERE fact_id=NEW.fact_id) THEN
      RAISE EXCEPTION 'VAT fact already consumed; explicit subsequent review required' USING ERRCODE='23514';
    END IF;
    document_key_value := CASE NEW.kind WHEN 'notice' THEN NEW.payload_json->'data'->>'noticeNumber' WHEN 'filing' THEN NEW.payload_json->'data'->>'receiptNumber' ELSE expected_external_key END;
    document_key_value := upper(regexp_replace(btrim(document_key_value),'\s','','g'));
    IF document_key_value IS NULL OR document_key_value='' THEN
      RAISE EXCEPTION 'VAT official document identity missing' USING ERRCODE='23514';
    END IF;
    INSERT INTO vat_filing_document_keys(subject_id,kind,document_key,fact_id) VALUES(NEW.subject_id,NEW.kind,document_key_value,NEW.fact_id) ON CONFLICT DO NOTHING;
    SELECT fact_id INTO document_owner FROM vat_filing_document_keys WHERE subject_id=NEW.subject_id AND kind=NEW.kind AND document_key=document_key_value;
    IF document_owner IS DISTINCT FROM NEW.fact_id THEN
      RAISE EXCEPTION 'VAT official document already belongs to another fact' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.version<>COALESCE(previous_version,0)+1 OR NEW.previous_revision_id IS DISTINCT FROM previous_id THEN
    RAISE EXCEPTION 'VAT revision is not the single next head' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_filing_subject_chain ON vat_filing_subject_revisions;
CREATE TRIGGER vat_filing_subject_chain BEFORE INSERT ON vat_filing_subject_revisions FOR EACH ROW EXECUTE FUNCTION vat_filing_revision_chain();
DROP TRIGGER IF EXISTS vat_filing_fact_chain ON vat_filing_fact_revisions;
CREATE TRIGGER vat_filing_fact_chain BEFORE INSERT ON vat_filing_fact_revisions FOR EACH ROW EXECUTE FUNCTION vat_filing_revision_chain();

CREATE OR REPLACE FUNCTION vat_filing_validate_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snap vat_filing_basis_snapshots%ROWTYPE; fact vat_filing_fact_revisions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(1296256326,1);
  SELECT * INTO STRICT snap FROM vat_filing_basis_snapshots WHERE snapshot_id=NEW.snapshot_id;
  SELECT * INTO STRICT fact FROM vat_filing_fact_revisions WHERE revision_id=NEW.revision_id;
  IF snap.subject_id<>NEW.subject_id OR snap.period_year<>fact.period_year OR snap.period_term<>fact.period_term
     OR fact.state<>'verified' OR fact.payload_json->'data'->>'amountSemantics' IS DISTINCT FROM 'total_replacement'
     OR EXISTS(SELECT 1 FROM vat_filing_fact_revisions WHERE fact_id=NEW.fact_id AND version>fact.version) THEN
    RAISE EXCEPTION 'VAT consumption subject/period/head mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='notice' AND (snap.period_kind<>'final' OR NEW.amount IS DISTINCT FROM fact.amount) THEN
    RAISE EXCEPTION 'VAT notice must be consumed in full in the matching final period' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='refund' THEN
    RAISE EXCEPTION 'Partial/refund consumption is unsupported in B1' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='filing' AND (fact.payload_json->'data'->>'sourceReconciliation' IS DISTINCT FROM 'complete'
    OR (fact.payload_json->'data'->'declaredTotals'->>'claimedTax')::bigint IS DISTINCT FROM NEW.amount) THEN
    RAISE EXCEPTION 'VAT filing consumption requires the complete declared amount' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap.consumption_plan) p WHERE p->>'factId'=NEW.fact_id AND p->>'revisionId'=NEW.revision_id AND p->>'kind'=NEW.kind AND (p->>'amount')::bigint=NEW.amount) THEN
    RAISE EXCEPTION 'VAT consumption not in sealed plan' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_filing_consumption_check ON vat_filing_basis_consumptions;
CREATE TRIGGER vat_filing_consumption_check BEFORE INSERT ON vat_filing_basis_consumptions FOR EACH ROW EXECUTE FUNCTION vat_filing_validate_consumption();

CREATE OR REPLACE FUNCTION vat_filing_complete_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual jsonb; expected jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('factId',fact_id,'revisionId',revision_id,'kind',kind,'amount',amount) ORDER BY fact_id,kind),'[]'::jsonb)
    INTO actual FROM vat_filing_basis_consumptions WHERE snapshot_id=NEW.snapshot_id;
  SELECT COALESCE(jsonb_agg(p ORDER BY p->>'factId',p->>'kind'),'[]'::jsonb) INTO expected FROM jsonb_array_elements(NEW.consumption_plan) p;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'VAT sealed basis and consumption ledger must commit together' USING ERRCODE='23514';
  END IF;
  IF NEW.scope_json->>'noticeFactId' IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM vat_filing_basis_consumptions c WHERE c.snapshot_id=NEW.snapshot_id AND c.kind='notice'
      AND c.fact_id=NEW.scope_json->>'noticeFactId' AND c.amount=(NEW.scope_json->>'noticeDeduction')::bigint
  ) THEN
    RAISE EXCEPTION 'VAT notice deduction lacks matching ledger consumption' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS vat_filing_plan_complete ON vat_filing_basis_snapshots;
CREATE CONSTRAINT TRIGGER vat_filing_plan_complete AFTER INSERT ON vat_filing_basis_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_filing_complete_plan();

CREATE INDEX IF NOT EXISTS vat_filing_fact_protection_idx ON vat_filing_fact_revisions(kind,state,date_from,date_to);
CREATE INDEX IF NOT EXISTS vat_filing_snapshot_protection_idx ON vat_filing_basis_snapshots(date_from,date_to);
COMMIT;
