-- Contract management expansion.
-- Applies on top of 001_initial_schema.sql and 003_legal_entities_contracts.sql.

ALTER TABLE legal_entities
  ADD COLUMN IF NOT EXISTS corporate_registration_no text,
  ADD COLUMN IF NOT EXISTS representative_name text,
  ADD COLUMN IF NOT EXISTS contract_entity_type text,
  ADD COLUMN IF NOT EXISTS legacy_company_id text,
  ADD COLUMN IF NOT EXISTS source_workbook text,
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer;

CREATE INDEX IF NOT EXISTS idx_legal_entities_corporate_no
  ON legal_entities(corporate_registration_no);
CREATE INDEX IF NOT EXISTS idx_legal_entities_legacy_company
  ON legal_entities(legacy_company_id);

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS legacy_company_id text,
  ADD COLUMN IF NOT EXISTS legacy_site_name text,
  ADD COLUMN IF NOT EXISTS site_business_registration_no text,
  ADD COLUMN IF NOT EXISTS corporate_registration_no text,
  ADD COLUMN IF NOT EXISTS representative_name text,
  ADD COLUMN IF NOT EXISTS contract_entity_type text,
  ADD COLUMN IF NOT EXISTS integrated_permit_target text,
  ADD COLUMN IF NOT EXISTS contract_source_workbook text,
  ADD COLUMN IF NOT EXISTS contract_source_sheet text,
  ADD COLUMN IF NOT EXISTS contract_source_row integer;

CREATE INDEX IF NOT EXISTS idx_facilities_legacy_company
  ON facilities(legacy_company_id);
CREATE INDEX IF NOT EXISTS idx_facilities_site_brn
  ON facilities(site_business_registration_no);

CREATE TABLE IF NOT EXISTS contract_import_batches (
  batch_id text PRIMARY KEY,
  source_workbook text NOT NULL,
  workbook_size_bytes bigint,
  workbook_modified_at text,
  status text NOT NULL DEFAULT 'draft',
  summary_json jsonb,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_import_staging (
  id bigserial PRIMARY KEY,
  batch_id text NOT NULL REFERENCES contract_import_batches(batch_id) ON DELETE CASCADE,
  row_type text NOT NULL,
  source_sheet text NOT NULL,
  source_row integer NOT NULL,
  legacy_key text,
  normalized_key text,
  raw_json jsonb NOT NULL,
  issue_json jsonb,
  resolved_status text NOT NULL DEFAULT 'pending',
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_import_staging_batch
  ON contract_import_staging(batch_id, row_type);
CREATE INDEX IF NOT EXISTS idx_contract_import_staging_legacy
  ON contract_import_staging(legacy_key);
CREATE INDEX IF NOT EXISTS idx_contract_import_staging_resolved
  ON contract_import_staging(resolved_status);

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS legacy_contract_no text,
  ADD COLUMN IF NOT EXISTS legacy_company_id text,
  ADD COLUMN IF NOT EXISTS contract_direction text NOT NULL DEFAULT 'sales',
  ADD COLUMN IF NOT EXISTS industry_category text,
  ADD COLUMN IF NOT EXISTS contract_date text,
  ADD COLUMN IF NOT EXISTS original_amount double precision,
  ADD COLUMN IF NOT EXISTS current_amount double precision,
  ADD COLUMN IF NOT EXISTS source_workbook text,
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer,
  ADD COLUMN IF NOT EXISTS migration_batch_id text REFERENCES contract_import_batches(batch_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_legacy_contract_no
  ON contracts(legacy_contract_no);
CREATE INDEX IF NOT EXISTS idx_contracts_legacy_company
  ON contracts(legacy_company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_direction
  ON contracts(contract_direction);
CREATE INDEX IF NOT EXISTS idx_contracts_service_type
  ON contracts(service_type);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_date
  ON contracts(contract_date);

CREATE TABLE IF NOT EXISTS contract_payment_milestones (
  milestone_id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  stage_label text NOT NULL,
  stage_order integer NOT NULL,
  amount double precision,
  amount_ratio double precision,
  collection_ratio double precision,
  invoice_issued integer NOT NULL DEFAULT 0,
  invoice_issued_at text,
  invoice_amount double precision,
  payment_collected integer NOT NULL DEFAULT 0,
  payment_collected_at text,
  collected_amount double precision,
  payment_terms text,
  legacy_source_sheet text,
  legacy_source_row integer,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_payment_milestones_contract_stage
  ON contract_payment_milestones(contract_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_contract_payment_milestones_invoice
  ON contract_payment_milestones(invoice_issued, invoice_issued_at);
CREATE INDEX IF NOT EXISTS idx_contract_payment_milestones_collection
  ON contract_payment_milestones(payment_collected, payment_collected_at);

CREATE TABLE IF NOT EXISTS contract_change_events (
  change_id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  changed_at text,
  previous_amount double precision,
  delta_amount double precision,
  changed_service_period text,
  changed_payment_terms text,
  detail text,
  source_sheet text,
  source_row integer,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_change_events_contract
  ON contract_change_events(contract_id);

CREATE TABLE IF NOT EXISTS contract_documents (
  document_id text PRIMARY KEY,
  contract_id text REFERENCES contracts(contract_id) ON DELETE CASCADE,
  milestone_id text REFERENCES contract_payment_milestones(milestone_id) ON DELETE SET NULL,
  document_type text NOT NULL,
  display_name text NOT NULL,
  original_filename text,
  content_type text,
  byte_size bigint,
  sha256 text,
  storage_provider text NOT NULL DEFAULT 's3',
  storage_bucket text,
  storage_key text NOT NULL,
  public_path text,
  source text NOT NULL DEFAULT 'manual_upload',
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_documents_contract
  ON contract_documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_milestone
  ON contract_documents(milestone_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_sha256
  ON contract_documents(sha256);
CREATE INDEX IF NOT EXISTS idx_contract_documents_type
  ON contract_documents(document_type);

CREATE TABLE IF NOT EXISTS contract_invoices (
  invoice_id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  milestone_id text REFERENCES contract_payment_milestones(milestone_id) ON DELETE SET NULL,
  document_id text REFERENCES contract_documents(document_id) ON DELETE SET NULL,
  issue_date text NOT NULL,
  fiscal_year integer,
  fiscal_quarter integer,
  invoice_amount double precision,
  supply_amount double precision,
  vat_amount double precision,
  payment_collected integer NOT NULL DEFAULT 0,
  payment_collected_at text,
  external_provider text,
  external_invoice_id text,
  issued_via text NOT NULL DEFAULT 'manual_pdf',
  memo text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_invoices_contract
  ON contract_invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_invoices_milestone
  ON contract_invoices(milestone_id);
CREATE INDEX IF NOT EXISTS idx_contract_invoices_issue_date
  ON contract_invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_contract_invoices_external
  ON contract_invoices(external_provider, external_invoice_id);

CREATE TABLE IF NOT EXISTS contract_duplicate_candidates (
  candidate_id text PRIMARY KEY,
  batch_id text REFERENCES contract_import_batches(batch_id) ON DELETE CASCADE,
  candidate_type text NOT NULL,
  confidence double precision,
  primary_ref text,
  duplicate_ref text,
  reason text,
  payload_json jsonb,
  resolved_status text NOT NULL DEFAULT 'pending',
  resolved_by text REFERENCES users(user_id) ON DELETE SET NULL,
  resolved_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_duplicate_candidates_batch
  ON contract_duplicate_candidates(batch_id);
CREATE INDEX IF NOT EXISTS idx_contract_duplicate_candidates_status
  ON contract_duplicate_candidates(resolved_status);
