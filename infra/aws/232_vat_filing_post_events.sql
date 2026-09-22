-- B3B: 신고 후 접수·납부 이력. 229/230의 봉인·계산·소비는 변경하지 않는다.
BEGIN;

CREATE OR REPLACE FUNCTION vat_post_canonical(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE jsonb_typeof(v)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_json(k)::text||':'||vat_post_canonical(x),',' ORDER BY k COLLATE "C") FROM jsonb_each(v) e(k,x)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(vat_post_canonical(x),',' ORDER BY n) FROM jsonb_array_elements(v) WITH ORDINALITY e(x,n)),'')||']'
 ELSE v::text END
$$;
CREATE OR REPLACE FUNCTION vat_post_key(v text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT upper(regexp_replace(btrim(v),'\s','','g'))
$$;

CREATE TABLE IF NOT EXISTS vat_filing_post_identities (
 identity_id text PRIMARY KEY,
 subject_id text NOT NULL REFERENCES vat_filing_subjects(subject_id),
 document_kind text NOT NULL CHECK(document_kind IN('notice','no_notice','filing','refund','payment','reconciliation','other')),
 document_key text NOT NULL CHECK(length(document_key) BETWEEN 1 AND 300 AND document_key=vat_post_key(document_key)),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(subject_id,document_kind,document_key)
);
CREATE TABLE IF NOT EXISTS vat_filing_post_events (
 event_id text PRIMARY KEY,
 subject_id text NOT NULL REFERENCES vat_filing_subjects(subject_id),
 kind text NOT NULL CHECK(kind IN('receipt','payment','reconciliation','other')),
 shared_b1_fact_id text REFERENCES vat_filing_facts(fact_id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,subject_id)
);
CREATE TABLE IF NOT EXISTS vat_filing_post_bindings (
 binding_id text PRIMARY KEY,
 identity_id text NOT NULL REFERENCES vat_filing_post_identities(identity_id),
 fact_id text REFERENCES vat_filing_facts(fact_id),
 event_id text REFERENCES vat_filing_post_events(event_id),
 CHECK((fact_id IS NOT NULL)::integer+(event_id IS NOT NULL)::integer=1),
 UNIQUE(identity_id,fact_id), UNIQUE(identity_id,event_id)
);
CREATE TABLE IF NOT EXISTS vat_filing_post_requests (
 request_id text PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 200),
 action text NOT NULL CHECK(action='save'),
 actor_user_id text NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 200),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 result_json jsonb NOT NULL CHECK(jsonb_typeof(result_json)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vat_filing_post_revisions (
 revision_id text PRIMARY KEY,
 event_id text NOT NULL REFERENCES vat_filing_post_events(event_id),
 version integer NOT NULL CHECK(version>0),
 previous_revision_id text UNIQUE REFERENCES vat_filing_post_revisions(revision_id),
 state text NOT NULL CHECK(state IN('recorded','verified','withdrawn')),
 identity_id text REFERENCES vat_filing_post_identities(identity_id),
 document_id text NOT NULL REFERENCES vat_filing_documents(document_id),
 document_hash text NOT NULL CHECK(document_hash ~ '^[0-9a-f]{64}$'),
 occurred_on text NOT NULL CHECK(occurred_on::date::text=occurred_on),
 payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
 payload_hash text NOT NULL CHECK(payload_hash=encode(sha256(convert_to(vat_post_canonical(payload_json),'UTF8')),'hex')),
 actor_user_id text NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 200),
 reviewed_by text,
 notice_consumption_id text REFERENCES vat_filing_basis_consumptions(consumption_id),
 return_confirmation_id text REFERENCES vat_filing_return_confirmations(confirmation_id),
 reconciliation_hash text CHECK(reconciliation_hash IS NULL OR reconciliation_hash ~ '^[0-9a-f]{64}$'),
 request_id text NOT NULL UNIQUE REFERENCES vat_filing_post_requests(request_id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,version),
 CHECK((version=1)=(previous_revision_id IS NULL)),
 CHECK(NOT(notice_consumption_id IS NOT NULL AND return_confirmation_id IS NOT NULL)),
 CHECK(state='recorded' OR reviewed_by IS NOT NULL AND length(reviewed_by)>0),
 CHECK(payload_json->>'state' IS NOT NULL AND payload_json->>'state'=state),
 CHECK(payload_json->>'occurredAt' IS NOT NULL AND payload_json->>'occurredAt'=occurred_on),
 CHECK(payload_json->>'evidenceDocumentId' IS NOT NULL AND payload_json->>'evidenceDocumentId'=document_id),
 CHECK(payload_json->>'reason' IS NOT NULL AND length(btrim(payload_json->>'reason')) BETWEEN 1 AND 2000)
);
CREATE TABLE IF NOT EXISTS vat_filing_post_allocations (
 revision_id text NOT NULL REFERENCES vat_filing_post_revisions(revision_id),
 line_no integer NOT NULL CHECK(line_no>=0),
 notice_consumption_id text REFERENCES vat_filing_basis_consumptions(consumption_id),
 return_confirmation_id text REFERENCES vat_filing_return_confirmations(confirmation_id),
 amount bigint NOT NULL CHECK(amount>0 AND amount<=9007199254740991),
 PRIMARY KEY(revision_id,line_no),
 CHECK((notice_consumption_id IS NOT NULL)::integer+(return_confirmation_id IS NOT NULL)::integer=1),
 UNIQUE(revision_id,notice_consumption_id), UNIQUE(revision_id,return_confirmation_id)
);
-- 업무 이력과 분리한 동시성 표. RR의 옛 스냅샷에서도 write conflict를 발생시킨다.
CREATE TABLE IF NOT EXISTS vat_filing_post_fences (key text PRIMARY KEY,generation bigint NOT NULL CHECK(generation>0));
CREATE OR REPLACE FUNCTION vat_post_fence(k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1296256326,1);
 INSERT INTO vat_filing_post_fences(key,generation) VALUES(k,1)
 ON CONFLICT(key) DO UPDATE SET generation=vat_filing_post_fences.generation+1;
END $$;

CREATE OR REPLACE FUNCTION vat_post_bind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i vat_filing_post_identities%ROWTYPE; f vat_filing_facts%ROWTYPE; e vat_filing_post_events%ROWTYPE;
BEGIN
 PERFORM vat_post_fence('identity:'||NEW.identity_id);
 SELECT * INTO STRICT i FROM vat_filing_post_identities WHERE identity_id=NEW.identity_id;
 IF NEW.fact_id IS NOT NULL THEN
  SELECT * INTO STRICT f FROM vat_filing_facts WHERE fact_id=NEW.fact_id;
  IF f.subject_id<>i.subject_id OR f.kind<>i.document_kind OR EXISTS(
   SELECT 1 FROM vat_filing_post_bindings b LEFT JOIN vat_filing_post_events pe ON pe.event_id=b.event_id
   WHERE b.identity_id=i.identity_id AND (b.fact_id IS NOT NULL AND b.fact_id<>f.fact_id OR b.event_id IS NOT NULL AND pe.shared_b1_fact_id IS DISTINCT FROM f.fact_id)
  ) THEN RAISE EXCEPTION 'Official document already has an independent owner' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO STRICT e FROM vat_filing_post_events WHERE event_id=NEW.event_id;
  IF e.subject_id<>i.subject_id OR (CASE e.kind WHEN 'receipt' THEN 'filing' ELSE e.kind END)<>i.document_kind
   OR EXISTS(SELECT 1 FROM vat_filing_post_bindings b WHERE b.identity_id=i.identity_id AND (b.event_id IS NOT NULL AND b.event_id<>e.event_id OR b.fact_id IS NOT NULL AND b.fact_id IS DISTINCT FROM e.shared_b1_fact_id))
   OR (e.shared_b1_fact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vat_filing_post_bindings b WHERE b.identity_id=i.identity_id AND b.fact_id=e.shared_b1_fact_id))
  THEN RAISE EXCEPTION 'Official document requires an explicit same-document reference' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_post_binding_guard ON vat_filing_post_bindings;
CREATE TRIGGER vat_post_binding_guard BEFORE INSERT ON vat_filing_post_bindings FOR EACH ROW EXECUTE FUNCTION vat_post_bind_guard();

CREATE OR REPLACE FUNCTION vat_post_claim_b1_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE iid text; normalized text;
BEGIN
 normalized:=vat_post_key(NEW.document_key);
 iid:='vpi-'||md5(NEW.subject_id||chr(31)||NEW.kind||chr(31)||normalized);
 PERFORM vat_post_fence('official:'||NEW.subject_id||':'||NEW.kind||':'||normalized);
 INSERT INTO vat_filing_post_identities(identity_id,subject_id,document_kind,document_key)
 VALUES(iid,NEW.subject_id,NEW.kind,normalized) ON CONFLICT(subject_id,document_kind,document_key) DO NOTHING;
 SELECT identity_id INTO STRICT iid FROM vat_filing_post_identities WHERE subject_id=NEW.subject_id AND document_kind=NEW.kind AND document_key=normalized;
 INSERT INTO vat_filing_post_bindings(binding_id,identity_id,fact_id) VALUES('vpb-'||md5(iid||chr(31)||NEW.fact_id),iid,NEW.fact_id)
 ON CONFLICT(identity_id,fact_id) DO NOTHING;
 RETURN NEW;
END $$;
-- 기존 행은 그대로 두고 공통 식별 원장만 채운다. 충돌이면 전체 migration을 중지한다.
DO $$ DECLARE r record; iid text; normalized text; BEGIN
 FOR r IN SELECT * FROM vat_filing_document_keys ORDER BY subject_id,kind,document_key LOOP
  normalized:=vat_post_key(r.document_key); iid:='vpi-'||md5(r.subject_id||chr(31)||r.kind||chr(31)||normalized);
  INSERT INTO vat_filing_post_identities(identity_id,subject_id,document_kind,document_key) VALUES(iid,r.subject_id,r.kind,normalized) ON CONFLICT(subject_id,document_kind,document_key) DO NOTHING;
  SELECT identity_id INTO STRICT iid FROM vat_filing_post_identities WHERE subject_id=r.subject_id AND document_kind=r.kind AND document_key=normalized;
  INSERT INTO vat_filing_post_bindings(binding_id,identity_id,fact_id) VALUES('vpb-'||md5(iid||chr(31)||r.fact_id),iid,r.fact_id) ON CONFLICT(identity_id,fact_id) DO NOTHING;
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS vat_post_b1_key_claim ON vat_filing_document_keys;
CREATE TRIGGER vat_post_b1_key_claim BEFORE INSERT ON vat_filing_document_keys FOR EACH ROW EXECUTE FUNCTION vat_post_claim_b1_key();

-- target 원본과 봉인 당시 알려진 납부를 읽는다. 현재 B1 사실 집합을 재계산하지 않는다.
CREATE OR REPLACE FUNCTION vat_post_target(k text,target text,through_day text DEFAULT NULL)
RETURNS TABLE(subject_id text,target_amount bigint,baseline_paid numeric,baseline_known boolean) LANGUAGE plpgsql AS $$
DECLARE c record; s jsonb; f jsonb; paid numeric:=0; known boolean:=true;
BEGIN
 IF k='notice' THEN
  SELECT bc.*,bs.scope_json,bs.scope_hash,bs.schema_version,bs.period_year,bs.period_term,
    fr.amount AS fact_amount,fr.state AS fact_state,fr.payload_json AS fact_json
  INTO STRICT c FROM vat_filing_basis_consumptions bc JOIN vat_filing_basis_snapshots bs ON bs.snapshot_id=bc.snapshot_id
    JOIN vat_filing_fact_revisions fr ON fr.revision_id=bc.revision_id
  WHERE bc.consumption_id=target;
  s:=c.scope_json;
  IF c.kind<>'notice' OR c.fact_state<>'verified' OR c.amount IS DISTINCT FROM c.fact_amount OR c.amount<0
   OR c.schema_version<>'vat-filing-basis-v1' OR s->>'scopeHash' IS DISTINCT FROM c.scope_hash
   OR c.scope_hash IS DISTINCT FROM encode(sha256(convert_to(vat_post_canonical(s-'scopeHash'),'UTF8')),'hex')
   OR s->>'subjectId' IS DISTINCT FROM c.subject_id OR s->>'noticeFactId' IS DISTINCT FROM c.fact_id
   OR jsonb_typeof(s->'effectiveFactRevisionIds') IS DISTINCT FROM 'array' OR jsonb_typeof(s#>'{evidenceSnapshot,facts}') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Stored notice basis integrity unavailable' USING ERRCODE='23514'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(s#>'{evidenceSnapshot,facts}') LOOP
   IF f->>'kind'='payment' AND f->>'state'='verified' AND s->'effectiveFactRevisionIds' ? (f->>'revisionId') AND f#>>'{data,targetNoticeFactId}'=c.fact_id THEN
    IF f->>'subjectId' IS DISTINCT FROM c.subject_id OR f#>>'{data,amountSemantics}' IS DISTINCT FROM 'total_replacement'
      OR f->>'amount' IS NULL OR jsonb_typeof(f->'amount') IS DISTINCT FROM 'number'
      OR (f->>'amount')::numeric<0 OR (f->>'amount')::numeric<>trunc((f->>'amount')::numeric)
      OR (f->>'amount')::numeric>9007199254740991 OR f#>>'{data,paidAt}' IS NULL
      OR f->>'year' IS DISTINCT FROM c.period_year::text OR f->>'term' IS DISTINCT FROM c.period_term::text
      OR f->>'from' IS DISTINCT FROM c.fact_json->>'from' OR f->>'to' IS DISTINCT FROM c.fact_json->>'to'
      OR (f#>>'{data,paidAt}')::date::text IS DISTINCT FROM f#>>'{data,paidAt}' THEN known:=false;
    ELSIF through_day IS NULL OR f#>>'{data,paidAt}'<=through_day THEN paid:=paid+(f->>'amount')::numeric; END IF;
   END IF;
  END LOOP;
  IF paid>c.amount THEN known:=false; END IF;
  RETURN QUERY SELECT c.subject_id::text,c.amount::bigint,CASE WHEN known THEN paid ELSE NULL::numeric END,known;
 ELSIF k='return' THEN
  SELECT bs.subject_id,rr.form_json,rr.calculation_hash,rc.calculation_hash AS confirmed_hash,rr.basis_snapshot_id,rc.basis_snapshot_id AS confirmed_basis
  INTO STRICT c FROM vat_filing_return_confirmations rc JOIN vat_filing_return_revisions rr ON rr.return_id=rc.return_id
   JOIN vat_filing_basis_snapshots bs ON bs.snapshot_id=rr.basis_snapshot_id WHERE rc.confirmation_id=target;
  IF c.calculation_hash IS DISTINCT FROM c.confirmed_hash OR c.basis_snapshot_id IS DISTINCT FROM c.confirmed_basis
   OR c.calculation_hash IS DISTINCT FROM encode(sha256(convert_to(vat_post_canonical(
    (c.form_json-ARRAY['generatedAt','warnings','ledgerSnapshot','filingBasis'])||jsonb_build_object('filingBasis',(c.form_json->'filingBasis')-'calculationHash','ledgerRows',c.form_json#>'{ledgerSnapshot,rows}')
   ),'UTF8')),'hex')
   OR jsonb_typeof(c.form_json->'finalTaxDue') IS DISTINCT FROM 'number'
   OR (c.form_json->>'finalTaxDue')::numeric<>trunc((c.form_json->>'finalTaxDue')::numeric)
   OR abs((c.form_json->>'finalTaxDue')::numeric)>9007199254740991
  THEN RAISE EXCEPTION 'Stored confirmed return integrity unavailable' USING ERRCODE='23514'; END IF;
  RETURN QUERY SELECT c.subject_id::text,(c.form_json->>'finalTaxDue')::bigint,0::numeric,true;
 ELSE RAISE EXCEPTION 'Unknown VAT post target' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_post_reconciliation_hash(k text,target text,through_day text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE baseline_hash text; payments jsonb;
BEGIN
 IF k='notice' THEN SELECT s.scope_hash INTO STRICT baseline_hash FROM vat_filing_basis_consumptions c JOIN vat_filing_basis_snapshots s ON s.snapshot_id=c.snapshot_id WHERE c.consumption_id=target;
 ELSIF k='return' THEN SELECT c.calculation_hash INTO STRICT baseline_hash FROM vat_filing_return_confirmations c WHERE c.confirmation_id=target;
 ELSE RAISE EXCEPTION 'Unknown reconciliation target' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId',r.event_id,'revisionId',r.revision_id,'date',r.occurred_on,'amount',a.amount) ORDER BY r.event_id,r.revision_id),'[]') INTO payments
 FROM vat_filing_post_allocations a JOIN vat_filing_post_revisions r ON r.revision_id=a.revision_id JOIN vat_filing_post_events e ON e.event_id=r.event_id
 WHERE r.state='verified' AND e.shared_b1_fact_id IS NULL AND r.occurred_on<=through_day
  AND NOT EXISTS(SELECT 1 FROM vat_filing_post_revisions n WHERE n.event_id=r.event_id AND n.version>r.version)
  AND CASE k WHEN 'notice' THEN a.notice_consumption_id=target ELSE a.return_confirmation_id=target END;
 RETURN encode(sha256(convert_to(vat_post_canonical(jsonb_build_object('kind',k,'target',target,'throughDate',through_day,'baselineHash',baseline_hash,'payments',payments)),'UTF8')),'hex');
END $$;

CREATE OR REPLACE FUNCTION vat_post_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e vat_filing_post_events%ROWTYPE; p vat_filing_post_revisions%ROWTYPE; d vat_filing_documents%ROWTYPE;
 i vat_filing_post_identities%ROWTYPE; f record; a jsonb; t record; keyvalue text; targetref jsonb; n numeric;
BEGIN
 PERFORM vat_post_fence('event:'||NEW.event_id);
 SELECT * INTO STRICT e FROM vat_filing_post_events WHERE event_id=NEW.event_id;
 SELECT * INTO p FROM vat_filing_post_revisions WHERE event_id=NEW.event_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(p.version,0)+1 OR NEW.previous_revision_id IS DISTINCT FROM p.revision_id
  OR p.state='verified' AND NEW.state='recorded' OR p.revision_id IS NULL AND NEW.state='withdrawn'
 THEN RAISE EXCEPTION 'VAT post revision head/state conflict' USING ERRCODE='23514'; END IF;
 IF NEW.payload_json->>'kind' IS DISTINCT FROM e.kind OR NEW.payload_json->>'sharedB1FactId' IS DISTINCT FROM e.shared_b1_fact_id
 THEN RAISE EXCEPTION 'VAT post event identity mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT d FROM vat_filing_documents WHERE document_id=NEW.document_id;
 IF d.subject_id<>e.subject_id OR d.content_sha256<>NEW.document_hash OR encode(sha256(d.content_bytes),'hex')<>NEW.document_hash OR octet_length(d.content_bytes)<>d.size_bytes
 THEN RAISE EXCEPTION 'VAT post document mismatch' USING ERRCODE='23514'; END IF;
 keyvalue:=vat_post_key(NEW.payload_json->>'officialKey');
 IF keyvalue IS NOT NULL THEN
  SELECT * INTO STRICT i FROM vat_filing_post_identities WHERE identity_id=NEW.identity_id;
  IF i.subject_id<>e.subject_id OR i.document_kind<>(CASE e.kind WHEN 'receipt' THEN 'filing' ELSE e.kind END) OR i.document_key<>keyvalue
   OR NOT EXISTS(SELECT 1 FROM vat_filing_post_bindings b WHERE b.identity_id=i.identity_id AND b.event_id=e.event_id)
  THEN RAISE EXCEPTION 'VAT post official identity mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.identity_id IS NOT NULL OR NEW.state='verified' AND e.kind IN('receipt','payment') THEN
  RAISE EXCEPTION 'VAT post official identity required' USING ERRCODE='23514';
 END IF;
 IF e.shared_b1_fact_id IS NOT NULL THEN
  SELECT r.*,ff.external_key FROM vat_filing_fact_revisions r JOIN vat_filing_facts ff ON ff.fact_id=r.fact_id WHERE r.fact_id=e.shared_b1_fact_id ORDER BY r.version DESC LIMIT 1 INTO f;
  IF f.fact_id IS NULL OR f.subject_id<>e.subject_id OR f.kind<>(CASE e.kind WHEN 'receipt' THEN 'filing' ELSE e.kind END)
   OR f.state<>'verified' OR f.payload_json->>'evidenceHash' IS DISTINCT FROM NEW.document_hash
   OR NOT EXISTS(SELECT 1 FROM vat_filing_documents bd WHERE 'vat-document:'||bd.document_id=f.payload_json->>'evidenceRef'
     AND bd.subject_id=e.subject_id AND bd.content_sha256=NEW.document_hash AND encode(sha256(bd.content_bytes),'hex')=NEW.document_hash AND octet_length(bd.content_bytes)=bd.size_bytes)
   OR vat_post_key(CASE f.kind WHEN 'filing' THEN f.payload_json#>>'{data,receiptNumber}' ELSE f.external_key END) IS DISTINCT FROM keyvalue
   OR e.kind='payment' AND (jsonb_array_length(NEW.payload_json#>'{payment,allocations}')<>0 OR (NEW.payload_json#>>'{payment,actualTotal}')::numeric IS DISTINCT FROM f.amount::numeric)
  THEN RAISE EXCEPTION 'B1 document reference is not identical/reference-only' USING ERRCODE='23514'; END IF;
  IF e.kind='receipt' AND NOT EXISTS(
   SELECT 1 FROM vat_filing_return_confirmations rc JOIN vat_filing_basis_snapshots bs ON bs.snapshot_id=rc.basis_snapshot_id
   WHERE rc.confirmation_id=NEW.return_confirmation_id AND bs.subject_id=e.subject_id
    AND bs.period_year=(f.payload_json->>'year')::integer AND bs.period_term=(f.payload_json->>'term')::integer
    AND bs.date_from=(f.payload_json->>'from') AND bs.date_to=(f.payload_json->>'to')
    AND (f.amount IS NULL OR (NEW.payload_json#>>'{receipt,declaredTax}')::numeric IS NOT DISTINCT FROM f.amount::numeric)
  ) THEN RAISE EXCEPTION 'Shared B1 receipt period/declared amount mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 targetref:=CASE e.kind WHEN 'receipt' THEN NEW.payload_json#>'{receipt,target}' WHEN 'reconciliation' THEN NEW.payload_json#>'{reconciliation,target}' WHEN 'other' THEN NEW.payload_json#>'{other,target}' ELSE NULL END;
 IF NEW.notice_consumption_id IS DISTINCT FROM (CASE WHEN targetref->>'kind'='notice' THEN targetref->>'id' ELSE NULL END)
  OR NEW.return_confirmation_id IS DISTINCT FROM (CASE WHEN targetref->>'kind'='return' THEN targetref->>'id' ELSE NULL END)
 THEN RAISE EXCEPTION 'VAT post header target FK mismatch' USING ERRCODE='23514'; END IF;
 IF targetref IS NOT NULL AND targetref<>'null'::jsonb THEN
  PERFORM vat_post_fence('target:'||(targetref->>'kind')||':'||(targetref->>'id'));
  SELECT * INTO STRICT t FROM vat_post_target(targetref->>'kind',targetref->>'id');
  IF t.subject_id<>e.subject_id OR e.kind='receipt' AND targetref->>'kind'<>'return'
  THEN RAISE EXCEPTION 'VAT post target subject/kind mismatch' USING ERRCODE='23514'; END IF;
 ELSIF e.kind IN('receipt','reconciliation') THEN RAISE EXCEPTION 'VAT post target required' USING ERRCODE='23514'; END IF;
 IF e.kind='payment' THEN
  IF jsonb_typeof(NEW.payload_json#>'{payment,allocations}') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'VAT post allocation array required' USING ERRCODE='23514'; END IF;
  FOR keyvalue IN SELECT DISTINCT 'target:'||(x->'target'->>'kind')||':'||(x->'target'->>'id') FROM jsonb_array_elements(COALESCE(NEW.payload_json#>'{payment,allocations}','[]')||COALESCE(p.payload_json#>'{payment,allocations}','[]')) x ORDER BY 1 LOOP PERFORM vat_post_fence(keyvalue); END LOOP;
  FOREACH keyvalue IN ARRAY ARRAY['actualTotal','additionalCharges','otherAmount','unallocatedAmount'] LOOP
   a:=NEW.payload_json->'payment'->keyvalue;
   IF keyvalue='actualTotal' AND a='null'::jsonb AND NEW.state<>'verified' THEN CONTINUE; END IF;
   IF jsonb_typeof(a) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'VAT payment component missing' USING ERRCODE='23514'; END IF;
   n:=(a#>>'{}')::numeric;
   IF n<0 OR n<>trunc(n) OR n>9007199254740991 THEN RAISE EXCEPTION 'VAT payment component invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSE
  a:=CASE e.kind WHEN 'receipt' THEN NEW.payload_json#>'{receipt,declaredTax}' WHEN 'reconciliation' THEN NEW.payload_json#>'{reconciliation,observedPaidTotal}' ELSE NEW.payload_json#>'{other,amount}' END;
  IF a IS NULL OR (a='null'::jsonb AND NEW.state='verified' AND e.kind<>'other') OR (a<>'null'::jsonb AND (jsonb_typeof(a)<>'number' OR (a#>>'{}')::numeric<>trunc((a#>>'{}')::numeric) OR abs((a#>>'{}')::numeric)>9007199254740991 OR (e.kind<>'receipt' AND (a#>>'{}')::numeric<0)))
  THEN RAISE EXCEPTION 'VAT post observed amount invalid' USING ERRCODE='23514'; END IF;
  IF e.kind='reconciliation' THEN
   keyvalue:=NEW.payload_json#>>'{reconciliation,throughDate}';
   IF keyvalue IS NULL OR keyvalue::date::text IS DISTINCT FROM keyvalue OR keyvalue>NEW.occurred_on
    OR (NEW.state='verified' AND NEW.reconciliation_hash IS DISTINCT FROM vat_post_reconciliation_hash(targetref->>'kind',targetref->>'id',keyvalue))
   THEN RAISE EXCEPTION 'VAT reconciliation date/evidence mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vat_post_revision_check ON vat_filing_post_revisions;
CREATE TRIGGER vat_post_revision_check BEFORE INSERT ON vat_filing_post_revisions FOR EACH ROW EXECUTE FUNCTION vat_post_revision_guard();

CREATE OR REPLACE FUNCTION vat_post_complete_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r vat_filing_post_revisions%ROWTYPE; e vat_filing_post_events%ROWTYPE; actual jsonb; expected jsonb; a record; targetref jsonb; t record; amount_sum numeric; used numeric;
BEGIN
 SELECT * INTO STRICT r FROM vat_filing_post_revisions WHERE revision_id=NEW.revision_id;
 SELECT * INTO STRICT e FROM vat_filing_post_events WHERE event_id=r.event_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('target',jsonb_build_object('kind',CASE WHEN notice_consumption_id IS NOT NULL THEN 'notice' ELSE 'return' END,'id',COALESCE(notice_consumption_id,return_confirmation_id)),'amount',amount) ORDER BY line_no),'[]') INTO actual FROM vat_filing_post_allocations WHERE revision_id=r.revision_id;
 expected:=COALESCE(r.payload_json#>'{payment,allocations}','[]');
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'VAT post complete allocation plan required' USING ERRCODE='23514'; END IF;
 IF e.kind='payment' THEN
  SELECT COALESCE(sum(amount),0) INTO amount_sum FROM vat_filing_post_allocations WHERE revision_id=r.revision_id;
  IF e.shared_b1_fact_id IS NULL AND r.payload_json#>>'{payment,actualTotal}' IS NOT NULL AND amount_sum+(r.payload_json#>>'{payment,additionalCharges}')::numeric+(r.payload_json#>>'{payment,otherAmount}')::numeric+(r.payload_json#>>'{payment,unallocatedAmount}')::numeric<>(r.payload_json#>>'{payment,actualTotal}')::numeric
  THEN RAISE EXCEPTION 'VAT post cash components do not equal original total' USING ERRCODE='23514'; END IF;
  IF e.shared_b1_fact_id IS NOT NULL AND (amount_sum<>0 OR (r.payload_json#>>'{payment,additionalCharges}')::numeric<>0 OR (r.payload_json#>>'{payment,otherAmount}')::numeric<>0 OR (r.payload_json#>>'{payment,unallocatedAmount}')::numeric<>0)
  THEN RAISE EXCEPTION 'B1 reference cannot create new cash components' USING ERRCODE='23514'; END IF;
  FOR a IN SELECT * FROM vat_filing_post_allocations WHERE revision_id=r.revision_id LOOP
   targetref:=jsonb_build_object('kind',CASE WHEN a.notice_consumption_id IS NOT NULL THEN 'notice' ELSE 'return' END,'id',COALESCE(a.notice_consumption_id,a.return_confirmation_id));
   PERFORM vat_post_fence('target:'||(targetref->>'kind')||':'||(targetref->>'id'));
   SELECT * INTO STRICT t FROM vat_post_target(targetref->>'kind',targetref->>'id');
   IF t.subject_id<>e.subject_id THEN RAISE EXCEPTION 'VAT allocation belongs to another subject' USING ERRCODE='23514'; END IF;
   IF r.state='verified' AND e.shared_b1_fact_id IS NULL THEN
    SELECT COALESCE(sum(pa.amount),0) INTO used FROM vat_filing_post_allocations pa JOIN vat_filing_post_revisions pr ON pr.revision_id=pa.revision_id JOIN vat_filing_post_events pe ON pe.event_id=pr.event_id
     WHERE pr.state='verified' AND pe.shared_b1_fact_id IS NULL AND NOT EXISTS(SELECT 1 FROM vat_filing_post_revisions nx WHERE nx.event_id=pr.event_id AND nx.version>pr.version)
      AND pa.notice_consumption_id IS NOT DISTINCT FROM a.notice_consumption_id AND pa.return_confirmation_id IS NOT DISTINCT FROM a.return_confirmation_id;
    IF NOT t.baseline_known OR t.baseline_paid+used>greatest(t.target_amount,0)
    THEN RAISE EXCEPTION 'VAT post allocation exceeds known target balance' USING ERRCODE='23514'; END IF;
   END IF;
  END LOOP;
 ELSIF e.kind='reconciliation' AND r.state='verified' THEN
  targetref:=r.payload_json#>'{reconciliation,target}';
  SELECT * INTO STRICT t FROM vat_post_target(targetref->>'kind',targetref->>'id',r.payload_json#>>'{reconciliation,throughDate}');
  SELECT COALESCE(sum(pa.amount),0) INTO used FROM vat_filing_post_allocations pa JOIN vat_filing_post_revisions pr ON pr.revision_id=pa.revision_id JOIN vat_filing_post_events pe ON pe.event_id=pr.event_id
   WHERE pr.state='verified' AND pe.shared_b1_fact_id IS NULL AND pr.occurred_on<=(r.payload_json#>>'{reconciliation,throughDate}')
    AND NOT EXISTS(SELECT 1 FROM vat_filing_post_revisions nx WHERE nx.event_id=pr.event_id AND nx.version>pr.version)
    AND CASE targetref->>'kind' WHEN 'notice' THEN pa.notice_consumption_id=targetref->>'id' ELSE pa.return_confirmation_id=targetref->>'id' END;
  IF NOT t.baseline_known OR jsonb_typeof(r.payload_json#>'{reconciliation,observedPaidTotal}') IS DISTINCT FROM 'number' OR (r.payload_json#>>'{reconciliation,observedPaidTotal}')::numeric IS DISTINCT FROM t.baseline_paid+used
  THEN RAISE EXCEPTION 'VAT post reconciliation is incomplete' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS vat_post_revision_complete ON vat_filing_post_revisions;
CREATE CONSTRAINT TRIGGER vat_post_revision_complete AFTER INSERT ON vat_filing_post_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_post_complete_revision();
DROP TRIGGER IF EXISTS vat_post_allocation_complete ON vat_filing_post_allocations;
CREATE CONSTRAINT TRIGGER vat_post_allocation_complete AFTER INSERT ON vat_filing_post_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vat_post_complete_revision();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['vat_filing_post_identities','vat_filing_post_events','vat_filing_post_bindings','vat_filing_post_requests','vat_filing_post_revisions','vat_filing_post_allocations'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS vat_post_immutable ON %I',t);
  EXECUTE format('CREATE TRIGGER vat_post_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vat_filing_append_only()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS vat_post_no_truncate ON %I',t);
  EXECUTE format('CREATE TRIGGER vat_post_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vat_filing_append_only()',t);
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS vat_post_events_subject ON vat_filing_post_events(subject_id,event_id);
CREATE INDEX IF NOT EXISTS vat_post_alloc_notice ON vat_filing_post_allocations(notice_consumption_id);
CREATE INDEX IF NOT EXISTS vat_post_alloc_return ON vat_filing_post_allocations(return_confirmation_id);
COMMIT;
