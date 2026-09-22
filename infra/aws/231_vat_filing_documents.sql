-- B3A: 신고 증빙 원문을 주체별로 불변 보관한다. 신고·납부의 진위를 자동 확인하는 표가 아니다.
BEGIN;

CREATE TABLE IF NOT EXISTS vat_filing_documents (
  document_id text PRIMARY KEY CHECK (length(document_id) BETWEEN 1 AND 200),
  subject_id text NOT NULL REFERENCES vat_filing_subjects(subject_id),
  request_id text NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 1 AND 200),
  uploader_user_id text NOT NULL CHECK (length(uploader_user_id) BETWEEN 1 AND 200),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200 AND file_name !~ '[[:cntrl:]/\\]'),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf', 'image/jpeg', 'image/png', 'application/json', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(content_bytes) = size_bytes),
  CHECK (encode(sha256(content_bytes), 'hex') = content_sha256),
  UNIQUE (document_id, subject_id)
);
CREATE INDEX IF NOT EXISTS vat_filing_documents_subject_idx ON vat_filing_documents(subject_id, created_at, document_id);

CREATE OR REPLACE FUNCTION reject_vat_filing_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VAT filing documents are immutable; update, delete and truncate are prohibited' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS vat_filing_documents_immutable ON vat_filing_documents;
CREATE TRIGGER vat_filing_documents_immutable BEFORE UPDATE OR DELETE ON vat_filing_documents
  FOR EACH ROW EXECUTE FUNCTION reject_vat_filing_document_mutation();
DROP TRIGGER IF EXISTS vat_filing_documents_no_truncate ON vat_filing_documents;
CREATE TRIGGER vat_filing_documents_no_truncate BEFORE TRUNCATE ON vat_filing_documents
  FOR EACH STATEMENT EXECUTE FUNCTION reject_vat_filing_document_mutation();

COMMIT;
