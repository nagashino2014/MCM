-- 319 공식 정보원·문서 버전. 기존 고정 revision의 custom 수집기가 읽지 않도록
-- 공식 소스의 기존 enabled는 0으로 유지하고 official_config.enabled만 새 실행기가 사용한다.
BEGIN;
ALTER TABLE scraper_sources ADD COLUMN IF NOT EXISTS official_provider text;
ALTER TABLE scraper_sources ADD COLUMN IF NOT EXISTS official_config jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS ux_scraper_sources_official_provider
  ON scraper_sources(official_provider) WHERE official_provider IS NOT NULL;

CREATE TABLE IF NOT EXISTS intel_source_documents (
  document_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES scraper_sources(source_id) ON DELETE RESTRICT,
  external_id text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('trend','statistic','policy','company_event')),
  title text NOT NULL,
  url text NOT NULL,
  published_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  current_revision_id text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','removed')),
  signal_id text REFERENCES intel_signals(signal_id) ON DELETE SET NULL,
  UNIQUE(source_id, external_id)
);
CREATE TABLE IF NOT EXISTS intel_source_document_revisions (
  revision_id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES intel_source_documents(document_id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  normalized_text text NOT NULL DEFAULT '',
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  rights_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intel_source_documents_current_revision_fk' AND conrelid='intel_source_documents'::regclass) THEN
    ALTER TABLE intel_source_documents ADD CONSTRAINT intel_source_documents_current_revision_fk
      FOREIGN KEY (current_revision_id) REFERENCES intel_source_document_revisions(revision_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_intel_documents_signal ON intel_source_documents(signal_id) WHERE signal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_intel_documents_source_type ON intel_source_documents(source_id, document_type);
CREATE INDEX IF NOT EXISTS ix_intel_document_revisions_fetched ON intel_source_document_revisions(fetched_at, revision_id);
CREATE INDEX IF NOT EXISTS ix_intel_document_revisions_document_time ON intel_source_document_revisions(document_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS ix_intel_document_revisions_content ON intel_source_document_revisions(document_id, content_hash);

CREATE TABLE IF NOT EXISTS intel_indicator_observations (
  observation_id text PRIMARY KEY,
  revision_id text NOT NULL UNIQUE REFERENCES intel_source_document_revisions(revision_id) ON DELETE RESTRICT,
  series_key text NOT NULL,
  period text NOT NULL,
  unit text,
  value numeric,
  raw_value text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_intel_indicator_series_period ON intel_indicator_observations(series_key, period);
COMMIT;
