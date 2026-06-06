-- Contract ordering subject and business-certificate based facility industry fields.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS ordering_subject_type text;

CREATE INDEX IF NOT EXISTS idx_contracts_ordering_subject_type
  ON contracts(ordering_subject_type);

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS business_certificate_business_type text,
  ADD COLUMN IF NOT EXISTS business_certificate_business_item text,
  ADD COLUMN IF NOT EXISTS business_certificate_corporate_registration_no text,
  ADD COLUMN IF NOT EXISTS business_certificate_ocr_text text;

CREATE INDEX IF NOT EXISTS idx_facilities_business_certificate_corporate_no
  ON facilities(business_certificate_corporate_registration_no);
