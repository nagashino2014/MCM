-- Unify legal entity master data into facilities as the canonical company master.
-- legal_entities remains for compatibility/rollback, but runtime code should use
-- facilities and the new *_facility_id columns after this migration.

CREATE TABLE IF NOT EXISTS legal_entity_facility_links (
  entity_id text PRIMARY KEY REFERENCES legal_entities(entity_id) ON DELETE CASCADE,
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE RESTRICT,
  match_strategy text NOT NULL,
  migrated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_entity_facility_links_facility
  ON legal_entity_facility_links(facility_id);

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS counterparty_facility_id text REFERENCES facilities(facility_id) ON DELETE RESTRICT;

ALTER TABLE contracts
  ALTER COLUMN counterparty_entity_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_counterparty_facility
  ON contracts(counterparty_facility_id);

ALTER TABLE contract_outsourcing
  ADD COLUMN IF NOT EXISTS counterparty_facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_outsourcing_counterparty_facility
  ON contract_outsourcing(counterparty_facility_id);

ALTER TABLE facility_operating_entities
  ADD COLUMN IF NOT EXISTS related_facility_id text REFERENCES facilities(facility_id) ON DELETE RESTRICT;

ALTER TABLE facility_operating_entities
  ALTER COLUMN entity_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facility_operating_entities_related_facility
  ON facility_operating_entities(related_facility_id);

-- 1) Link legal entities to existing facilities by digit-normalized business registration number.
WITH matches AS (
  SELECT DISTINCT ON (e.entity_id)
         e.entity_id,
         f.facility_id
    FROM legal_entities e
    JOIN facilities f
      ON regexp_replace(COALESCE(f.business_registration_no, ''), '[^0-9]', '', 'g')
       = regexp_replace(COALESCE(e.business_registration_no, ''), '[^0-9]', '', 'g')
   WHERE regexp_replace(COALESCE(e.business_registration_no, ''), '[^0-9]', '', 'g') <> ''
     AND f.deleted_at IS NULL
   ORDER BY e.entity_id,
            CASE WHEN f.source = 'legal_entity' THEN 1 ELSE 0 END,
            f.updated_at DESC,
            f.facility_id ASC
)
INSERT INTO legal_entity_facility_links (entity_id, facility_id, match_strategy, migrated_at)
SELECT entity_id, facility_id, 'brn', now()::text
  FROM matches
ON CONFLICT (entity_id) DO UPDATE SET
  facility_id = excluded.facility_id,
  match_strategy = excluded.match_strategy,
  migrated_at = excluded.migrated_at;

-- 2) Create facility rows for legal entities that did not match any facility.
INSERT INTO facilities (
  facility_id,
  company_name,
  business_registration_no,
  site_address,
  site_address_verbatim,
  phone_number,
  normalized_company_name,
  normalized_address,
  source,
  memo,
  corporate_registration_no,
  representative_name,
  contract_entity_type,
  legacy_company_id,
  contract_source_workbook,
  contract_source_sheet,
  contract_source_row,
  created_at,
  updated_at
)
SELECT
  'facl_' || substr(md5(e.entity_id), 1, 16) AS facility_id,
  e.entity_name,
  e.business_registration_no,
  e.address,
  true,
  e.phone_number,
  lower(regexp_replace(regexp_replace(COALESCE(e.entity_name, ''), '[\\s]', '', 'g'), '[\\(\\)（）]', '', 'g')),
  NULLIF(regexp_replace(COALESCE(e.address, ''), '\\s+', ' ', 'g'), ''),
  'legal_entity',
  e.memo,
  e.corporate_registration_no,
  e.representative_name,
  e.contract_entity_type,
  e.legacy_company_id,
  e.source_workbook,
  e.source_sheet,
  e.source_row,
  COALESCE(e.created_at, now()::text),
  now()::text
FROM legal_entities e
WHERE NOT EXISTS (
  SELECT 1
    FROM legal_entity_facility_links l
   WHERE l.entity_id = e.entity_id
)
ON CONFLICT (facility_id) DO UPDATE SET
  company_name = excluded.company_name,
  business_registration_no = COALESCE(facilities.business_registration_no, excluded.business_registration_no),
  site_address = COALESCE(facilities.site_address, excluded.site_address),
  site_address_verbatim = CASE WHEN facilities.site_address IS NULL THEN excluded.site_address_verbatim ELSE facilities.site_address_verbatim END,
  phone_number = COALESCE(facilities.phone_number, excluded.phone_number),
  normalized_company_name = COALESCE(facilities.normalized_company_name, excluded.normalized_company_name),
  normalized_address = COALESCE(facilities.normalized_address, excluded.normalized_address),
  memo = COALESCE(facilities.memo, excluded.memo),
  corporate_registration_no = COALESCE(facilities.corporate_registration_no, excluded.corporate_registration_no),
  representative_name = COALESCE(facilities.representative_name, excluded.representative_name),
  contract_entity_type = COALESCE(facilities.contract_entity_type, excluded.contract_entity_type),
  legacy_company_id = COALESCE(facilities.legacy_company_id, excluded.legacy_company_id),
  contract_source_workbook = COALESCE(facilities.contract_source_workbook, excluded.contract_source_workbook),
  contract_source_sheet = COALESCE(facilities.contract_source_sheet, excluded.contract_source_sheet),
  contract_source_row = COALESCE(facilities.contract_source_row, excluded.contract_source_row),
  updated_at = excluded.updated_at;

-- 3) Link the generated facility rows.
INSERT INTO legal_entity_facility_links (entity_id, facility_id, match_strategy, migrated_at)
SELECT
  e.entity_id,
  'facl_' || substr(md5(e.entity_id), 1, 16),
  'generated_from_legal_entity',
  now()::text
FROM legal_entities e
WHERE NOT EXISTS (
  SELECT 1
    FROM legal_entity_facility_links l
   WHERE l.entity_id = e.entity_id
)
ON CONFLICT (entity_id) DO UPDATE SET
  facility_id = excluded.facility_id,
  match_strategy = excluded.match_strategy,
  migrated_at = excluded.migrated_at;

-- 4) Backfill missing fields in already-existing matched facilities without overwriting user/IEPS data.
UPDATE facilities f
   SET business_registration_no = COALESCE(f.business_registration_no, e.business_registration_no),
       site_address = COALESCE(f.site_address, e.address),
       phone_number = COALESCE(f.phone_number, e.phone_number),
       memo = COALESCE(f.memo, e.memo),
       corporate_registration_no = COALESCE(f.corporate_registration_no, e.corporate_registration_no),
       representative_name = COALESCE(f.representative_name, e.representative_name),
       contract_entity_type = COALESCE(f.contract_entity_type, e.contract_entity_type),
       legacy_company_id = COALESCE(f.legacy_company_id, e.legacy_company_id),
       contract_source_workbook = COALESCE(f.contract_source_workbook, e.source_workbook),
       contract_source_sheet = COALESCE(f.contract_source_sheet, e.source_sheet),
       contract_source_row = COALESCE(f.contract_source_row, e.source_row),
       updated_at = now()::text
  FROM legal_entity_facility_links l
  JOIN legal_entities e ON e.entity_id = l.entity_id
 WHERE f.facility_id = l.facility_id
   AND l.match_strategy = 'brn';

-- 5) Backfill canonical facility references for runtime code.
UPDATE contracts c
   SET counterparty_facility_id = l.facility_id
  FROM legal_entity_facility_links l
 WHERE c.counterparty_entity_id = l.entity_id
   AND c.counterparty_facility_id IS NULL;

UPDATE contract_outsourcing o
   SET counterparty_facility_id = l.facility_id
  FROM legal_entity_facility_links l
 WHERE o.counterparty_entity_id = l.entity_id
   AND o.counterparty_facility_id IS NULL;

UPDATE facility_operating_entities r
   SET related_facility_id = l.facility_id
  FROM legal_entity_facility_links l
 WHERE r.entity_id = l.entity_id
   AND r.related_facility_id IS NULL;
