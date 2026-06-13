-- Remove the legacy legal_entities master after facility-based references are canonical.
-- This migration is intentionally guarded: if any row would lose its canonical
-- facility reference, it raises before dropping legacy columns/tables.

-- Last-chance backfill from the compatibility mapping created in 021.
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

DO $$
DECLARE
  missing_contracts integer;
  missing_outsourcing_counterparties integer;
  missing_operating_entities integer;
  unmapped_legal_entities integer;
BEGIN
  SELECT COUNT(*)
    INTO missing_contracts
    FROM contracts
   WHERE counterparty_facility_id IS NULL;

  IF missing_contracts > 0 THEN
    RAISE EXCEPTION 'Cannot drop legal_entities: % contracts still have no counterparty_facility_id', missing_contracts;
  END IF;

  SELECT COUNT(*)
    INTO missing_outsourcing_counterparties
    FROM contract_outsourcing
   WHERE counterparty_entity_id IS NOT NULL
     AND counterparty_facility_id IS NULL;

  IF missing_outsourcing_counterparties > 0 THEN
    RAISE EXCEPTION 'Cannot drop legal_entities: % contract_outsourcing rows still have only counterparty_entity_id', missing_outsourcing_counterparties;
  END IF;

  SELECT COUNT(*)
    INTO missing_operating_entities
    FROM facility_operating_entities
   WHERE related_facility_id IS NULL;

  IF missing_operating_entities > 0 THEN
    RAISE EXCEPTION 'Cannot drop legal_entities: % facility_operating_entities rows still have no related_facility_id', missing_operating_entities;
  END IF;

  SELECT COUNT(*)
    INTO unmapped_legal_entities
    FROM legal_entities e
   WHERE NOT EXISTS (
     SELECT 1
       FROM legal_entity_facility_links l
      WHERE l.entity_id = e.entity_id
   );

  IF unmapped_legal_entities > 0 THEN
    RAISE EXCEPTION 'Cannot drop legal_entities: % legal_entities rows are not mapped to facilities', unmapped_legal_entities;
  END IF;
END $$;

ALTER TABLE contracts
  ALTER COLUMN counterparty_facility_id SET NOT NULL;

ALTER TABLE facility_operating_entities
  ALTER COLUMN related_facility_id SET NOT NULL;

ALTER TABLE contracts
  DROP COLUMN IF EXISTS counterparty_entity_id;

ALTER TABLE contract_outsourcing
  DROP COLUMN IF EXISTS counterparty_entity_id;

ALTER TABLE facility_operating_entities
  DROP COLUMN IF EXISTS entity_id;

DROP TABLE IF EXISTS legal_entity_facility_links;
DROP TABLE IF EXISTS legal_entities;
