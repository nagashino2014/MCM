-- C-b2/B3B 호환: 새 계산판의 저장 당시 확정·소비 근거만 검증한다.
-- 232/236 파일과 기존 v1 계산·대사 해시/업무 원문을 재작성하지 않는다.
BEGIN;

CREATE OR REPLACE FUNCTION vat_post_target_version() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'vat-post-target-v2'::text $$;

CREATE OR REPLACE FUNCTION vat_post_confirmed_return_hash(p_confirmation_id text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE c record; fc jsonb; actual_pairs jsonb;
BEGIN
 SELECT rr.*,rc.calculation_hash AS confirmed_hash,rc.basis_snapshot_id AS confirmed_basis,
   rc.confirmed_by,bs.subject_id AS basis_subject_id,bs.scope_hash AS basis_scope_hash,
   bs.period_year,bs.period_term,bs.period_kind,bs.date_from,bs.date_to
 INTO STRICT c FROM vat_filing_return_confirmations rc
  JOIN vat_filing_return_revisions rr ON rr.return_id=rc.return_id
  JOIN vat_filing_basis_snapshots bs ON bs.snapshot_id=rr.basis_snapshot_id
 WHERE rc.confirmation_id=p_confirmation_id;
 IF c.schema_version='vat-return-basis-v1' THEN
  -- 정상 v1의 232 투영과 canonical 해시를 그대로 유지한다.
  IF c.form_json#>>'{filingBasis,version}' IS DISTINCT FROM 'vat-return-basis-v1'
   OR c.form_json ? 'followupConsumption'
   OR c.calculation_hash IS DISTINCT FROM c.confirmed_hash OR c.basis_snapshot_id IS DISTINCT FROM c.confirmed_basis
   OR c.calculation_hash IS DISTINCT FROM encode(sha256(convert_to(vat_post_canonical(
    (c.form_json-ARRAY['generatedAt','warnings','ledgerSnapshot','filingBasis'])||jsonb_build_object('filingBasis',(c.form_json->'filingBasis')-'calculationHash','ledgerRows',c.form_json#>'{ledgerSnapshot,rows}')
   ),'UTF8')),'hex')
   OR jsonb_typeof(c.form_json->'finalTaxDue') IS DISTINCT FROM 'number'
   OR (c.form_json->>'finalTaxDue')::numeric<>trunc((c.form_json->>'finalTaxDue')::numeric)
   OR abs((c.form_json->>'finalTaxDue')::numeric)>9007199254740991
  THEN RAISE EXCEPTION 'Stored confirmed return integrity unavailable' USING ERRCODE='23514'; END IF;
  RETURN c.calculation_hash;
 ELSIF c.schema_version IS DISTINCT FROM 'vat-return-basis-v2' THEN
  RAISE EXCEPTION 'Stored post return version is unsupported' USING ERRCODE='55000';
 END IF;

 BEGIN
  -- 保存専用検算: 最新/未消費/current DBproof/server source を再検査しない。
  fc:=vat_followup_validate_form_v2(c.form_json,'basis',c.basis_snapshot_id);
  IF c.calculation_hash IS DISTINCT FROM c.confirmed_hash
    OR c.calculation_hash IS DISTINCT FROM fc->>'calculationHash'
    OR c.basis_snapshot_id IS DISTINCT FROM c.confirmed_basis
    OR c.scope_hash IS DISTINCT FROM c.basis_scope_hash
    OR c.form_json#>>'{filingBasis,scopeHash}' IS DISTINCT FROM c.basis_scope_hash
    OR c.form_json#>>'{filingBasis,subjectId}' IS DISTINCT FROM c.basis_subject_id
    OR fc#>>'{application,subjectId}' IS DISTINCT FROM c.basis_subject_id
    OR c.form_json#>'{period,year}' IS DISTINCT FROM to_jsonb(c.period_year)
    OR c.form_json#>'{period,term}' IS DISTINCT FROM to_jsonb(c.period_term)
    OR c.period_kind IS DISTINCT FROM 'final'
    OR c.form_json#>>'{period,from}' IS DISTINCT FROM c.date_from
    OR c.form_json#>>'{period,to}' IS DISTINCT FROM c.date_to
    OR c.form_json->'blockingIssues' IS DISTINCT FROM '[]'::jsonb
    OR c.form_json#>>'{filingBasis,verificationStatus}' IS DISTINCT FROM 'complete'
  THEN RAISE EXCEPTION 'Stored v2 confirmation metadata mismatch' USING ERRCODE='55000'; END IF;

  SELECT COALESCE(jsonb_agg(x.payload_json ORDER BY (x.payload_json->>'revisionId') COLLATE "C",x.pair_line_no),'[]'::jsonb)
   INTO actual_pairs FROM vat_followup_review_consumptions x WHERE x.basis_confirmation_id=p_confirmation_id;
  IF actual_pairs IS DISTINCT FROM fc->'pairs'
    OR EXISTS(SELECT 1 FROM vat_followup_review_consumptions x
      WHERE x.basis_confirmation_id=p_confirmation_id AND (
       x.legacy_archive_id IS NOT NULL OR x.calculation_hash IS DISTINCT FROM c.calculation_hash
       OR x.created_by IS DISTINCT FROM c.confirmed_by
       OR x.payload_json->>'revisionId' IS DISTINCT FROM x.revision_id
       OR x.payload_json->'pairLineNo' IS DISTINCT FROM to_jsonb(x.pair_line_no)))
    OR EXISTS(SELECT 1 FROM vat_followup_review_consumptions x
      JOIN vat_followup_review_revisions r ON r.revision_id=x.revision_id
      WHERE x.basis_confirmation_id=p_confirmation_id AND (
       r.schema_version IS DISTINCT FROM 'vat-followup-review-v1' OR r.state IS DISTINCT FROM 'verified'
       OR r.payload_hash IS DISTINCT FROM vat_followup_hash(r.payload_json)
       OR r.payload_json#>ARRAY['pairs',x.pair_line_no::text] IS DISTINCT FROM x.payload_json->'pair'))
  THEN RAISE EXCEPTION 'Stored v2 confirmed consumption mismatch' USING ERRCODE='55000'; END IF;
  RETURN c.calculation_hash;
 EXCEPTION
  WHEN serialization_failure OR deadlock_detected THEN RAISE;
  WHEN OTHERS THEN
   RAISE EXCEPTION 'Stored v2 post return integrity unavailable'
     USING ERRCODE='55000',DETAIL=SQLSTATE||': '||SQLERRM;
 END;
END $$;

-- notice 分岐の計算/原文検算は232のまま。returnだけversion-aware保管検算に接続。
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
  PERFORM vat_post_confirmed_return_hash(target);
  SELECT bs.subject_id,rr.form_json INTO STRICT c FROM vat_filing_return_confirmations rc
   JOIN vat_filing_return_revisions rr ON rr.return_id=rc.return_id
   JOIN vat_filing_basis_snapshots bs ON bs.snapshot_id=rr.basis_snapshot_id WHERE rc.confirmation_id=target;
  RETURN QUERY SELECT c.subject_id::text,(c.form_json->>'finalTaxDue')::bigint,0::numeric,true;
 ELSE RAISE EXCEPTION 'Unknown VAT post target' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION vat_post_reconciliation_hash(k text,target text,through_day text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE baseline_hash text; payments jsonb;
BEGIN
 IF k='notice' THEN SELECT s.scope_hash INTO STRICT baseline_hash FROM vat_filing_basis_consumptions c JOIN vat_filing_basis_snapshots s ON s.snapshot_id=c.snapshot_id WHERE c.consumption_id=target;
 ELSIF k='return' THEN baseline_hash:=vat_post_confirmed_return_hash(target);
 ELSE RAISE EXCEPTION 'Unknown reconciliation target' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId',r.event_id,'revisionId',r.revision_id,'date',r.occurred_on,'amount',a.amount) ORDER BY r.event_id,r.revision_id),'[]') INTO payments
 FROM vat_filing_post_allocations a JOIN vat_filing_post_revisions r ON r.revision_id=a.revision_id JOIN vat_filing_post_events e ON e.event_id=r.event_id
 WHERE r.state='verified' AND e.shared_b1_fact_id IS NULL AND r.occurred_on<=through_day
  AND NOT EXISTS(SELECT 1 FROM vat_filing_post_revisions n WHERE n.event_id=r.event_id AND n.version>r.version)
  AND CASE k WHEN 'notice' THEN a.notice_consumption_id=target ELSE a.return_confirmation_id=target END;
 RETURN encode(sha256(convert_to(vat_post_canonical(jsonb_build_object('kind',k,'target',target,'throughDate',through_day,'baselineHash',baseline_hash,'payments',payments)),'UTF8')),'hex');
END $$;

COMMIT;
