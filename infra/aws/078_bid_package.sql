-- 078: 입찰 증빙서류 패키지 — 발주처 양식 라이브러리 + 공고별 패키지 작업 상태
-- (docs/bid-package-blueprint.md P1. 멱등)

-- 발주처별 입찰 서류 양식 라이브러리: 한 번 업로드한 양식을 발주처(org_name) 기본 양식으로 등록,
-- 같은 발주처의 다음 입찰 건에서 디폴트로 선택. 재업로드 시 교체(발주처당 1건).
CREATE TABLE IF NOT EXISTS bid_package_forms (
  form_id text PRIMARY KEY,
  org_name text NOT NULL,
  display_name text NOT NULL,
  original_filename text,
  content_type text,
  byte_size bigint,
  storage_key text NOT NULL,
  form_profile jsonb,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bid_package_forms_org ON bid_package_forms (org_name);

-- 공고별 패키지 작업 상태(재진입 시 이어서 작업): 선택한 실적 계약·수행인력·사용 양식.
CREATE TABLE IF NOT EXISTS bid_packages (
  package_id text PRIMARY KEY,
  bid_type text NOT NULL CHECK (bid_type IN ('order_plan','prior_spec','bid_notice')),
  bid_id text NOT NULL,
  org_name text,
  form_id text REFERENCES bid_package_forms(form_id) ON DELETE SET NULL,
  contract_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  employee_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (bid_type, bid_id)
);
