-- Contract management round 2.
-- Applies on top of 004_contract_management.sql.
--
-- Changes:
--   1. Add service_subtype, contract_kind, collection_progress_label to contracts.
--   2. Add partial_payments_json to contract_payment_milestones for split deposits.
--   3. Add change_payload_json, changed_fields_json, document_id to contract_change_events
--      so the change-contract modal can persist all tab inputs without per-field columns.
--   4. Add helpful indexes.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS service_subtype text,
  ADD COLUMN IF NOT EXISTS contract_kind text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS collection_progress_label text;

CREATE INDEX IF NOT EXISTS idx_contracts_service_subtype
  ON contracts(service_subtype);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_kind
  ON contracts(contract_kind);

ALTER TABLE contract_payment_milestones
  ADD COLUMN IF NOT EXISTS partial_payments_json jsonb;

ALTER TABLE contract_change_events
  ADD COLUMN IF NOT EXISTS change_payload_json jsonb,
  ADD COLUMN IF NOT EXISTS changed_fields_json jsonb,
  ADD COLUMN IF NOT EXISTS document_id text REFERENCES contract_documents(document_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_change_events_document
  ON contract_change_events(document_id);
