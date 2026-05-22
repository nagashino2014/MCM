-- Contract outsourcing and lifecycle status fields.
-- Applies on top of 005_contract_management_round2.sql.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_terminated_at text,
  ADD COLUMN IF NOT EXISTS contract_termination_reason text,
  ADD COLUMN IF NOT EXISTS contract_suspended_at text,
  ADD COLUMN IF NOT EXISTS contract_suspension_reason text;

CREATE INDEX IF NOT EXISTS idx_contracts_lifecycle_status
  ON contracts(contract_status, contract_terminated_at, contract_suspended_at);

CREATE TABLE IF NOT EXISTS contract_outsourcing (
  outsourcing_id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  outsourcing_title text NOT NULL,
  counterparty_entity_id text REFERENCES legal_entities(entity_id) ON DELETE SET NULL,
  counterparty_name text,
  service_type text,
  contract_date text,
  ended_at text,
  amount double precision,
  memo text,
  document_id text REFERENCES contract_documents(document_id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual_input',
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

ALTER TABLE contract_outsourcing
  ADD COLUMN IF NOT EXISTS amount double precision;

CREATE INDEX IF NOT EXISTS idx_contract_outsourcing_contract
  ON contract_outsourcing(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_outsourcing_counterparty
  ON contract_outsourcing(counterparty_entity_id);
CREATE INDEX IF NOT EXISTS idx_contract_outsourcing_service
  ON contract_outsourcing(service_type);
CREATE INDEX IF NOT EXISTS idx_contract_outsourcing_date
  ON contract_outsourcing(contract_date);

CREATE TABLE IF NOT EXISTS contract_delete_logs (
  delete_log_id text PRIMARY KEY,
  contract_id text NOT NULL,
  contract_title text,
  delete_reason text NOT NULL,
  before_json jsonb,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_delete_logs_contract
  ON contract_delete_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_delete_logs_reason
  ON contract_delete_logs(delete_reason);
CREATE INDEX IF NOT EXISTS idx_contract_delete_logs_created_at
  ON contract_delete_logs(created_at);
