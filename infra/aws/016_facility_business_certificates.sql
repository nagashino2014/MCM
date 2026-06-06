-- Business registration certificate document history for facilities.

CREATE TABLE IF NOT EXISTS facility_business_certificates (
  certificate_id text PRIMARY KEY,
  facility_id text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  version_no integer NOT NULL DEFAULT 1,
  is_current integer NOT NULL DEFAULT 1,
  display_name text NOT NULL,
  original_filename text,
  content_type text,
  byte_size integer,
  sha256 text,
  storage_provider text NOT NULL,
  storage_bucket text,
  storage_key text NOT NULL,
  public_path text,
  business_type text,
  business_item text,
  corporate_registration_no text,
  ocr_text text,
  parsed_json jsonb,
  memo text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_business_certificates_facility
  ON facility_business_certificates(facility_id);

CREATE INDEX IF NOT EXISTS idx_facility_business_certificates_current
  ON facility_business_certificates(facility_id, is_current);

CREATE INDEX IF NOT EXISTS idx_facility_business_certificates_created_at
  ON facility_business_certificates(created_at);
