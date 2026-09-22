-- G-03: preserve generation-time source evidence independently of human line edits.
-- Legacy entries are intentionally not backfilled with invented historical evidence.
CREATE TABLE IF NOT EXISTS journal_source_snapshots (
  entry_id text PRIMARY KEY REFERENCES journal_entries(entry_id) ON DELETE CASCADE,
  snapshot_version integer NOT NULL DEFAULT 1 CHECK (snapshot_version = 1),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_json jsonb NOT NULL CHECK (jsonb_typeof(source_json) = 'object'),
  captured_at text NOT NULL
);
