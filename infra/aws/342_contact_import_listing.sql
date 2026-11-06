-- 342_contact_import_listing.sql
-- 사업장 마스터 / 기타 업체·기관 구분 + 연락처 가져오기(2026-11-06 사용자 요청).
--   거래가 없는 기관·업체도 같은 facilities 행으로 두어 입력 항목이 같고, 계약이 생기면 곧바로 거래처가 된다.
--   표시 구분 규칙은 frontend/lib/ieps/queries.ts FACILITY_OTHER_SQL 이 단일 원천이다.
--   직원별 아마란스10 연락처 엑셀을 대기 명단으로 받아 회사 단위로 묶고, 사업자번호를 찾은 뒤
--   관리자가 사업장 연결·거래처 등록·기타 목록·제외 중 하나로 분류한다.
-- 설치 전제: 001(facilities), 331(trade_roles), 341(homepage_url). 멱등.

-- 사람이 정한 구분. NULL 이면 사업자번호 규칙을 따른다.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS listing text;
ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_listing_check;
ALTER TABLE facilities ADD CONSTRAINT facilities_listing_check CHECK (listing IS NULL OR listing IN ('master', 'other'));

-- 올린 파일 단위. 올린 사람이 그 연락처의 원래 주인이다(엑셀에 등록자 칸이 비어 있다).
CREATE TABLE IF NOT EXISTS contact_import_batches (
  batch_id          text PRIMARY KEY,
  original_filename text NOT NULL,
  file_sha256       text NOT NULL,
  uploaded_by       text NOT NULL,
  uploaded_at       text NOT NULL,
  row_count         integer NOT NULL DEFAULT 0, -- 파일의 연락처 수
  new_count         integer NOT NULL DEFAULT 0, -- 명단에 새로 들어간 수
  duplicate_count   integer NOT NULL DEFAULT 0  -- 이미 명단에 있어 합친 수
);
CREATE INDEX IF NOT EXISTS idx_contact_import_batches_user ON contact_import_batches(uploaded_by);

-- 회사 단위 묶음. 직원 여러 명의 파일에서 같은 회사가 나오면 한 행으로 모은다.
CREATE TABLE IF NOT EXISTS contact_import_companies (
  company_id          text PRIMARY KEY,
  normalized_name     text NOT NULL UNIQUE,
  display_name        text NOT NULL,
  address             text,
  region_sido         text,
  region_sigungu      text,
  phone_number        text,
  homepage_url        text,
  email_domain        text,
  suggested_category  text,
  match_candidates    jsonb NOT NULL DEFAULT '[]'::jsonb, -- 기존 사업장 후보
  search_status       text NOT NULL DEFAULT 'pending',    -- pending|running|done|paused|attention
  search_lease_until  timestamptz,
  search_outcomes     jsonb NOT NULL DEFAULT '{}'::jsonb, -- 정보원별 결과(원문 없음)
  search_candidates   jsonb NOT NULL DEFAULT '[]'::jsonb, -- 사업자번호 후보
  search_verdict      text,                               -- recommend|review|not_found
  found_brn           text,
  found_crn           text,
  search_note         text,
  decision            text,                               -- link|partner|other|exclude
  decided_facility_id text,
  created_facility    boolean NOT NULL DEFAULT false,     -- 이 분류로 새로 만든 사업장인가(되돌리기 판단)
  decided_by          text,
  decided_at          text,
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_import_companies_search
  ON contact_import_companies(search_status) WHERE decision IS NULL;

-- 담당자 대기 명단. 분류가 끝나면 status='imported'.
CREATE TABLE IF NOT EXISTS contact_import_rows (
  id           bigserial PRIMARY KEY,
  batch_id     text NOT NULL REFERENCES contact_import_batches(batch_id) ON DELETE CASCADE,
  company_id   text NOT NULL REFERENCES contact_import_companies(company_id) ON DELETE CASCADE,
  dedupe_key   text NOT NULL UNIQUE,
  person_name  text NOT NULL,
  title        text,
  department   text,
  office_phone text,
  mobile_phone text,
  fax_number   text,
  email        text,
  status       text NOT NULL DEFAULT 'pending', -- pending|imported
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_import_rows_company ON contact_import_rows(company_id);
CREATE INDEX IF NOT EXISTS idx_contact_import_rows_batch ON contact_import_rows(batch_id);
