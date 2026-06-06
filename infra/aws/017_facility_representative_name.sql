ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS representative_name text;

CREATE INDEX IF NOT EXISTS idx_facilities_representative_name
  ON facilities(representative_name);
