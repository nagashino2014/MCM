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
