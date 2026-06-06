-- Contract target facilities and payment method.
-- Supports contracts that cover multiple integrated-permit target facilities.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS payment_method text;

CREATE INDEX IF NOT EXISTS idx_contracts_payment_method
  ON contracts(payment_method);

CREATE INDEX IF NOT EXISTS idx_contracts_industry_category
  ON contracts(industry_category);

CREATE TABLE IF NOT EXISTS contract_facilities (
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'integrated_permit_target',
  stage_label text,
  memo text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY (contract_id, facility_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_contract_facilities_contract
  ON contract_facilities(contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_facilities_facility
  ON contract_facilities(facility_id);

CREATE INDEX IF NOT EXISTS idx_contract_facilities_relation
  ON contract_facilities(relation_type);
