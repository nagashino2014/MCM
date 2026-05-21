-- MCM AWS migration baseline schema.
-- Source of truth frozen from scraper/lib/scraper/scraper-db.ts and frontend/lib/db.ts.
-- Target: PostgreSQL / Aurora PostgreSQL.

CREATE TABLE IF NOT EXISTS documents (
  doc_id text PRIMARY KEY,
  board_id text NOT NULL,
  org_id text NOT NULL,
  title text NOT NULL,
  content text DEFAULT '',
  published_date text,
  source_url text NOT NULL,
  scraped_at text NOT NULL,
  updated_at text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_documents_board ON documents(board_id);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(published_date);
CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(source_url);

CREATE TABLE IF NOT EXISTS attachments (
  file_id text PRIMARY KEY,
  doc_id text NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text DEFAULT '',
  file_size bigint,
  download_url text NOT NULL,
  local_path text,
  storage_provider text,
  storage_bucket text,
  storage_key text,
  downloaded_at text,
  status text DEFAULT 'pending',
  download_method text,
  download_attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_attachments_doc ON attachments(doc_id);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status);
CREATE INDEX IF NOT EXISTS idx_attachments_method ON attachments(download_method);
CREATE INDEX IF NOT EXISTS idx_attachments_storage ON attachments(storage_provider, storage_bucket, storage_key);

CREATE TABLE IF NOT EXISTS scrape_logs (
  log_id text PRIMARY KEY,
  board_id text NOT NULL,
  schedule_id text,
  started_at text NOT NULL,
  finished_at text,
  status text DEFAULT 'running',
  docs_scraped integer DEFAULT 0,
  docs_skipped integer DEFAULT 0,
  docs_failed integer DEFAULT 0,
  pages_processed integer DEFAULT 0,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_logs_board ON scrape_logs(board_id);
CREATE INDEX IF NOT EXISTS idx_logs_status ON scrape_logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_started ON scrape_logs(started_at);

CREATE TABLE IF NOT EXISTS facilities (
  facility_id text PRIMARY KEY,
  company_name text NOT NULL,
  business_registration_no text,
  site_address text,
  phone_number text,
  industry_code text,
  industry_name text,
  normalized_company_name text,
  normalized_address text,
  region_sido text,
  region_sigungu text,
  source text NOT NULL DEFAULT 'ieps',
  source_doc_type text,
  memo text,
  logo_path text,
  logo_storage_provider text,
  logo_storage_bucket text,
  logo_storage_key text,
  company_size text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facilities_brn_company_address
  ON facilities(business_registration_no, normalized_company_name, normalized_address)
  WHERE business_registration_no IS NOT NULL
    AND normalized_company_name IS NOT NULL
    AND normalized_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facilities_company ON facilities(normalized_company_name);
CREATE INDEX IF NOT EXISTS idx_facilities_address ON facilities(normalized_address);
CREATE INDEX IF NOT EXISTS idx_facilities_sido ON facilities(region_sido);
CREATE INDEX IF NOT EXISTS idx_facilities_sigungu ON facilities(region_sigungu);
CREATE INDEX IF NOT EXISTS idx_facilities_source ON facilities(source);
CREATE INDEX IF NOT EXISTS idx_facilities_company_size ON facilities(company_size);

CREATE TABLE IF NOT EXISTS permits (
  permit_id text PRIMARY KEY,
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  decision_no text,
  permit_type text,
  permit_date text,
  is_first_permit integer DEFAULT 0,
  source_doc_id text,
  source_attachment_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permits_decision ON permits(decision_no);
CREATE INDEX IF NOT EXISTS idx_permits_facility ON permits(facility_id);

CREATE TABLE IF NOT EXISTS permit_scales (
  id bigserial PRIMARY KEY,
  permit_id text NOT NULL REFERENCES permits(permit_id) ON DELETE CASCADE,
  air_class integer,
  air_amount_ton_per_year double precision,
  water_class integer,
  wastewater_amount_m3_per_day double precision,
  source_page integer,
  source_text text
);

CREATE INDEX IF NOT EXISTS idx_permit_scales_permit ON permit_scales(permit_id);

CREATE TABLE IF NOT EXISTS product_outputs (
  id bigserial PRIMARY KEY,
  permit_id text NOT NULL REFERENCES permits(permit_id) ON DELETE CASCADE,
  product_name text,
  production_amount double precision,
  production_unit text,
  source_page integer,
  source_text text,
  source_industry_code text
);

CREATE INDEX IF NOT EXISTS idx_product_outputs_permit ON product_outputs(permit_id);
CREATE INDEX IF NOT EXISTS idx_product_outputs_source_industry ON product_outputs(source_industry_code);

CREATE TABLE IF NOT EXISTS legal_entities (
  entity_id text PRIMARY KEY,
  entity_name text NOT NULL,
  business_registration_no text,
  address text,
  phone_number text,
  memo text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_entities_name ON legal_entities(entity_name);
CREATE INDEX IF NOT EXISTS idx_legal_entities_brn ON legal_entities(business_registration_no);

CREATE TABLE IF NOT EXISTS facility_operating_entities (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  entity_id text NOT NULL REFERENCES legal_entities(entity_id) ON DELETE RESTRICT,
  relation_type text NOT NULL DEFAULT 'operating_entity',
  started_at text,
  ended_at text,
  is_primary integer NOT NULL DEFAULT 1,
  memo text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_operating_entities_facility ON facility_operating_entities(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_operating_entities_entity ON facility_operating_entities(entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_operating_entities_primary
  ON facility_operating_entities(facility_id, relation_type)
  WHERE ended_at IS NULL AND is_primary = 1;

CREATE TABLE IF NOT EXISTS contracts (
  contract_id text PRIMARY KEY,
  facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  counterparty_entity_id text NOT NULL REFERENCES legal_entities(entity_id) ON DELETE RESTRICT,
  operating_relation_id bigint REFERENCES facility_operating_entities(id) ON DELETE SET NULL,
  contract_title text NOT NULL,
  service_type text,
  contract_status text NOT NULL DEFAULT 'draft',
  contract_amount double precision,
  started_at text,
  ended_at text,
  memo text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contracts_facility ON contracts(facility_id);
CREATE INDEX IF NOT EXISTS idx_contracts_counterparty ON contracts(counterparty_entity_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(contract_status);

CREATE TABLE IF NOT EXISTS facility_annual_reports (
  facility_id text PRIMARY KEY REFERENCES facilities(facility_id) ON DELETE CASCADE,
  report_year integer,
  air_class integer,
  air_amount_ton_per_year double precision,
  water_class integer,
  wastewater_amount_m3_per_day double precision,
  product_outputs_json jsonb,
  source_doc_id text,
  source_attachment_id text,
  source_pdf_path text,
  source_storage_provider text,
  source_storage_bucket text,
  source_storage_key text,
  source_page_scale integer,
  source_page_product integer,
  parsed_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_far_year ON facility_annual_reports(report_year);

CREATE TABLE IF NOT EXISTS parsed_fields (
  id bigserial PRIMARY KEY,
  attachment_id text NOT NULL,
  doc_id text,
  rule_id text NOT NULL,
  field_label text NOT NULL,
  raw_value text,
  normalized_value text,
  source_page integer,
  source_text text,
  confidence double precision DEFAULT 0,
  needs_review integer DEFAULT 0,
  reviewed_value text,
  error text,
  file_name text,
  pdf_path text,
  storage_provider text,
  storage_bucket text,
  storage_key text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parsed_fields_attachment ON parsed_fields(attachment_id);
CREATE INDEX IF NOT EXISTS idx_parsed_fields_review ON parsed_fields(needs_review);
CREATE INDEX IF NOT EXISTS idx_parsed_fields_rule ON parsed_fields(rule_id);

CREATE TABLE IF NOT EXISTS collection_configs (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  config_json jsonb NOT NULL,
  is_default integer DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collection_configs_default ON collection_configs(is_default);

CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK(role IN ('admin','editor','viewer')),
  status text NOT NULL DEFAULT 'active',
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id text,
  action text NOT NULL,
  target_table text NOT NULL,
  target_id text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

CREATE TABLE IF NOT EXISTS facility_merge_aliases (
  id bigserial PRIMARY KEY,
  target_facility_id text NOT NULL,
  source_facility_id text NOT NULL,
  previous_company_name text,
  previous_business_registration_no text,
  merge_reason text NOT NULL,
  created_at text NOT NULL,
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_facility_merge_aliases_target ON facility_merge_aliases(target_facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_merge_aliases_source ON facility_merge_aliases(source_facility_id);

CREATE TABLE IF NOT EXISTS facility_permit_successions (
  id bigserial PRIMARY KEY,
  target_facility_id text NOT NULL,
  source_facility_id text NOT NULL,
  permit_id text NOT NULL,
  decision_no text,
  permit_type text,
  permit_date text,
  previous_company_name text,
  previous_business_registration_no text,
  merge_reason text NOT NULL,
  created_at text NOT NULL,
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_facility_permit_successions_target ON facility_permit_successions(target_facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_permit_successions_source ON facility_permit_successions(source_facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_permit_successions_permit ON facility_permit_successions(permit_id);

CREATE TABLE IF NOT EXISTS facility_history_events (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL,
  event_type text NOT NULL,
  event_date text,
  previous_company_name text,
  new_company_name text,
  previous_business_registration_no text,
  new_business_registration_no text,
  previous_group_name text,
  new_group_name text,
  related_company_name text,
  source_facility_id text,
  memo text,
  source text NOT NULL DEFAULT 'manual',
  created_at text NOT NULL,
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_facility_history_events_facility ON facility_history_events(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_history_events_type ON facility_history_events(event_type);

CREATE TABLE IF NOT EXISTS facility_merge_exclusions (
  id bigserial PRIMARY KEY,
  match_type text NOT NULL,
  match_value text,
  facility_ids_key text NOT NULL,
  facility_ids_json jsonb NOT NULL,
  reason text,
  created_at text NOT NULL,
  created_by text,
  UNIQUE(match_type, facility_ids_key)
);

CREATE INDEX IF NOT EXISTS idx_facility_merge_exclusions_match ON facility_merge_exclusions(match_type, facility_ids_key);

CREATE TABLE IF NOT EXISTS facility_groups (
  group_id text PRIMARY KEY,
  group_name text NOT NULL,
  logo_path text,
  logo_storage_provider text,
  logo_storage_bucket text,
  logo_storage_key text,
  total_revenue double precision,
  employee_count integer,
  description text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_groups_name ON facility_groups(group_name);

CREATE TABLE IF NOT EXISTS facility_group_divisions (
  division_id text PRIMARY KEY,
  group_id text NOT NULL,
  division_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_group_divisions_group ON facility_group_divisions(group_id);

CREATE TABLE IF NOT EXISTS facility_group_companies (
  company_id text PRIMARY KEY,
  group_id text NOT NULL,
  division_id text,
  company_name text NOT NULL,
  business_registration_no text,
  address text,
  phone_number text,
  logo_path text,
  logo_storage_provider text,
  logo_storage_bucket text,
  logo_storage_key text,
  group_role text NOT NULL DEFAULT 'affiliate',
  is_headquarters integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_group_companies_group ON facility_group_companies(group_id);
CREATE INDEX IF NOT EXISTS idx_facility_group_companies_division ON facility_group_companies(division_id);

CREATE TABLE IF NOT EXISTS facility_group_memberships (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL UNIQUE,
  group_id text NOT NULL,
  company_id text NOT NULL,
  relation_type text NOT NULL DEFAULT 'site',
  started_at text,
  ended_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_group_memberships_group ON facility_group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_facility_group_memberships_company ON facility_group_memberships(company_id);

CREATE TABLE IF NOT EXISTS facility_aliases (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL,
  alias text NOT NULL,
  alias_type text,
  note text,
  is_primary integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_aliases_facility ON facility_aliases(facility_id);

CREATE TABLE IF NOT EXISTS facility_service_categories (
  facility_id text NOT NULL,
  category text NOT NULL,
  created_at text NOT NULL,
  created_by text,
  PRIMARY KEY (facility_id, category)
);

CREATE INDEX IF NOT EXISTS idx_facility_service_categories_category ON facility_service_categories(category);

CREATE TABLE IF NOT EXISTS facility_manual_products (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL,
  product_name text NOT NULL,
  amount double precision,
  unit text,
  note text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_manual_products_facility ON facility_manual_products(facility_id);

CREATE TABLE IF NOT EXISTS facility_contact_main_numbers (
  facility_id text PRIMARY KEY,
  phone_number text,
  note text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS facility_contact_departments (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL,
  department_name text NOT NULL,
  phone_number text,
  fax_number text,
  duties text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_contact_departments_facility ON facility_contact_departments(facility_id);

CREATE TABLE IF NOT EXISTS facility_contact_people (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL,
  department_id bigint,
  person_name text NOT NULL,
  title text,
  office_phone text,
  mobile_phone text,
  email text,
  duties text,
  status text NOT NULL DEFAULT 'active',
  appointed_at text,
  transferred_at text,
  resigned_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_contact_people_facility ON facility_contact_people(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_contact_people_department ON facility_contact_people(department_id);

CREATE TABLE IF NOT EXISTS facility_contact_logs (
  id bigserial PRIMARY KEY,
  facility_id text NOT NULL,
  department_id bigint,
  person_id bigint,
  event_type text NOT NULL,
  event_date text,
  memo text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_contact_logs_facility ON facility_contact_logs(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_contact_logs_department ON facility_contact_logs(department_id);
CREATE INDEX IF NOT EXISTS idx_facility_contact_logs_person ON facility_contact_logs(person_id);

CREATE TABLE IF NOT EXISTS download_events (
  id bigserial PRIMARY KEY,
  file_id text,
  download_url text,
  method text NOT NULL,
  status text NOT NULL,
  attempt_no integer NOT NULL,
  bytes bigint,
  error text,
  job_id text,
  occurred_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_events_time ON download_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_download_events_method_status ON download_events(method, status);
CREATE INDEX IF NOT EXISTS idx_download_events_job ON download_events(job_id);

CREATE TABLE IF NOT EXISTS alerts (
  id bigserial PRIMARY KEY,
  severity text NOT NULL,
  source text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  body text,
  payload_json jsonb,
  job_id text,
  created_at text NOT NULL,
  acknowledged_at text,
  acknowledged_by text
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

CREATE TABLE IF NOT EXISTS aws_migration_jobs (
  job_id text PRIMARY KEY,
  job_type text NOT NULL,
  status text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  requested_by text,
  created_at text NOT NULL,
  started_at text,
  finished_at text
);

CREATE INDEX IF NOT EXISTS idx_aws_migration_jobs_status ON aws_migration_jobs(status);
CREATE INDEX IF NOT EXISTS idx_aws_migration_jobs_type ON aws_migration_jobs(job_type);
