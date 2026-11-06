-- 342_contact_import_organizations.sql
-- 연락처 가져오기 + 기관 목록(2026-11-06 사용자 요청).
--   거래처(매출·매입)만 사업장 마스터(facilities)에 두고, 그 외 기관·업체는 기관 목록에 따로 둔다.
--   직원별 아마란스10 연락처 엑셀을 대기 명단으로 받아, 회사 단위로 묶고 사업자번호를 찾은 뒤
--   관리자가 사업장 연결·거래처 등록·기관 목록·제외 중 하나로 분류한다.
-- 설치 전제: 001(facilities), 341(homepage_url). 멱등.

CREATE TABLE IF NOT EXISTS external_organizations (
  org_id                    text PRIMARY KEY,
  org_name                  text NOT NULL,
  normalized_name           text NOT NULL,
  org_category              text,                 -- directory-categories 의 기관 유형
  business_registration_no  text,
  corporate_registration_no text,
  address                   text,
  region_sido               text,
  region_sigungu            text,
  phone_number              text,
  homepage_url              text,
  memo                      text,
  source                    text NOT NULL DEFAULT 'manual', -- manual | contact-import
  promoted_facility_id      text,                 -- 거래처가 되어 사업장 마스터로 옮긴 경우
  created_by                text,
  created_at                text NOT NULL,
  updated_at                text NOT NULL,
  deleted_at                text
);
-- 삭제·이동한 기관은 같은 이름으로 다시 만들 수 있다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_org_name
  ON external_organizations(normalized_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_external_org_category ON external_organizations(org_category);

CREATE TABLE IF NOT EXISTS external_org_contacts (
  id           bigserial PRIMARY KEY,
  org_id       text NOT NULL REFERENCES external_organizations(org_id) ON DELETE CASCADE,
  person_name  text NOT NULL,
  title        text,
  department   text,
  office_phone text,
  mobile_phone text,
  fax_number   text,
  email        text,
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_org_contacts_org ON external_org_contacts(org_id);

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
  company_id         text PRIMARY KEY,
  normalized_name    text NOT NULL UNIQUE,
  display_name       text NOT NULL,
  address            text,
  region_sido        text,
  region_sigungu     text,
  phone_number       text,
  homepage_url       text,
  email_domain       text,
  suggested_category text,
  match_candidates   jsonb NOT NULL DEFAULT '[]'::jsonb, -- 기존 사업장 후보
  search_status      text NOT NULL DEFAULT 'pending',    -- pending|running|done|paused|attention
  search_lease_until timestamptz,
  search_outcomes    jsonb NOT NULL DEFAULT '{}'::jsonb, -- 정보원별 결과(원문 없음)
  search_candidates  jsonb NOT NULL DEFAULT '[]'::jsonb, -- 사업자번호 후보
  search_verdict     text,                               -- recommend|review|not_found
  found_brn          text,
  found_crn          text,
  search_note        text,
  decision           text,                               -- link|partner|organization|exclude
  decided_facility_id text,
  decided_org_id     text,
  decided_by         text,
  decided_at         text,
  created_at         text NOT NULL,
  updated_at         text NOT NULL
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
