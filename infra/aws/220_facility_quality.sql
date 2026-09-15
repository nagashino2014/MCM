-- 사업장 전수 진단·근거 후보·확인값 재유입 보호. 원본 마스터의 일괄 변경 없음.
CREATE TABLE IF NOT EXISTS facility_quality_runs (
  run_id text PRIMARY KEY, requested_by text NOT NULL, rule_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('audit','enrich')), status text NOT NULL DEFAULT 'queued',
  options jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), error text, lease_owner text, lease_until timestamptz
);
CREATE TABLE IF NOT EXISTS facility_quality_items (
  run_id text NOT NULL REFERENCES facility_quality_runs(run_id), facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL, diagnosis jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, outcomes jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (run_id,facility_id)
);
CREATE TABLE IF NOT EXISTS facility_enrichment_candidates (
  candidate_id text PRIMARY KEY, run_id text REFERENCES facility_quality_runs(run_id),
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('business_registration_no','phone_number','representative_name','corporate_registration_no','site_address')),
  old_value text, value text NOT NULL, source text NOT NULL, source_url text, evidence jsonb NOT NULL,
  snapshot jsonb NOT NULL, match_level text NOT NULL, recommended boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending', reviewed_by text, reviewed_at timestamptz,
  before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (source = 'bizno' AND field = 'representative_name')),
  UNIQUE (run_id,facility_id,field,source,value)
);
CREATE INDEX IF NOT EXISTS facility_quality_items_status ON facility_quality_items(run_id,status,facility_id);
CREATE INDEX IF NOT EXISTS facility_candidates_status ON facility_enrichment_candidates(run_id,status,field);
CREATE INDEX IF NOT EXISTS facility_candidates_facility ON facility_enrichment_candidates(facility_id,created_at DESC);
CREATE TABLE IF NOT EXISTS facility_quality_source_requests (
  source text NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY(source,day)
);
CREATE TABLE IF NOT EXISTS facility_quality_profile_cache (
  source text NOT NULL, identifier text NOT NULL, profile jsonb NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(source,identifier)
);
CREATE TABLE IF NOT EXISTS facility_master_field_state (
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE, field text NOT NULL, value text,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(facility_id,field)
);

CREATE OR REPLACE FUNCTION facility_quality_snapshot(f facilities) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('facility_id',f.facility_id,'company_name',f.company_name,
    'business_registration_no',f.business_registration_no,'site_business_registration_no',f.site_business_registration_no,
    'representative_name',f.representative_name,'phone_number',f.phone_number,
    'corporate_registration_no',f.corporate_registration_no,
    'business_certificate_corporate_registration_no',f.business_certificate_corporate_registration_no,
    'site_address',f.site_address,'site_address_verbatim',f.site_address_verbatim,
    'normalized_address',f.normalized_address,'region_sido',f.region_sido,'region_sigungu',f.region_sigungu,
    'additional_site_addresses',f.additional_site_addresses,'source',f.source,
    'deleted_at',f.deleted_at);
$$;

-- 모든 수집/OCR/그룹 동기화 경로를 보호한다. 명시적 사용자 검토 저장만 세션 표식을 설정한다.
CREATE OR REPLACE FUNCTION facility_quality_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; oldj jsonb; newj jsonb; is_reviewed boolean; conflicts jsonb := '[]'::jsonb; conflict jsonb;
BEGIN
  newj := to_jsonb(NEW);
  oldj := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  is_reviewed := COALESCE(current_setting('mcm.facility_write',true),'') = 'reviewed';
  FOREACH k IN ARRAY ARRAY['business_registration_no','phone_number','representative_name','corporate_registration_no','site_address'] LOOP
    IF (newj->k) IS NOT DISTINCT FROM (oldj->k) THEN CONTINUE; END IF;
    IF is_reviewed THEN
      INSERT INTO facility_master_field_state(facility_id,field,value) VALUES(NEW.facility_id,k,newj->>k)
      ON CONFLICT(facility_id,field) DO UPDATE SET value=EXCLUDED.value,updated_at=now();
    ELSIF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM facility_master_field_state p WHERE p.facility_id=OLD.facility_id AND p.field=k) THEN
      -- 원본 증빙 컬럼은 유지하되 확인된 마스터 값은 덮지 않고 충돌 후보를 남긴다.
      IF NULLIF(btrim(newj->>k),'') IS NOT NULL THEN
        conflicts := conflicts || jsonb_build_array(jsonb_build_object('field',k,'value',newj->>k));
      END IF;
      newj := jsonb_set(newj,ARRAY[k],oldj->k);
      IF k='site_address' THEN
        newj := newj || jsonb_build_object('normalized_address',oldj->'normalized_address','region_sido',oldj->'region_sido',
          'region_sigungu',oldj->'region_sigungu','site_address_verbatim',oldj->'site_address_verbatim','additional_site_addresses',oldj->'additional_site_addresses');
      END IF;
    END IF;
  END LOOP;
  IF TG_OP='UPDATE' AND NOT is_reviewed AND EXISTS(SELECT 1 FROM facility_master_field_state p WHERE p.facility_id=OLD.facility_id AND p.field='site_address') THEN
    newj := newj || jsonb_build_object('normalized_address',oldj->'normalized_address','region_sido',oldj->'region_sido',
      'region_sigungu',oldj->'region_sigungu','site_address_verbatim',oldj->'site_address_verbatim','additional_site_addresses',oldj->'additional_site_addresses');
  END IF;
  NEW := jsonb_populate_record(NEW,newj);
  FOR conflict IN SELECT value FROM jsonb_array_elements(conflicts) LOOP
    k := conflict->>'field';
    INSERT INTO facility_enrichment_candidates(candidate_id,facility_id,field,old_value,value,source,evidence,snapshot,match_level)
    SELECT md5(random()::text||clock_timestamp()::text),NEW.facility_id,k,oldj->>k,conflict->>'value','ingestion',
      jsonb_build_object('reason','확인된 값과 재수집값 충돌','retrievedAt',now()),facility_quality_snapshot(NEW),'review'
    WHERE NOT EXISTS (SELECT 1 FROM facility_enrichment_candidates c WHERE c.facility_id=NEW.facility_id AND c.field=k AND c.value=conflict->>'value' AND c.old_value IS NOT DISTINCT FROM oldj->>k AND c.source='ingestion' AND c.status='pending');
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS facility_quality_protect_update ON facilities;
CREATE TRIGGER facility_quality_protect_update BEFORE UPDATE ON facilities FOR EACH ROW EXECUTE FUNCTION facility_quality_protect();
-- 신규 행은 FK가 성립한 뒤 보호값을 기록한다.
DROP TRIGGER IF EXISTS facility_quality_protect_insert ON facilities;
CREATE TRIGGER facility_quality_protect_insert AFTER INSERT ON facilities FOR EACH ROW EXECUTE FUNCTION facility_quality_protect();
