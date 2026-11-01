-- 정기 브리핑 전용 신규 모델. 319·320 적용 후 실행한다.
BEGIN;
CREATE TABLE IF NOT EXISTS intel_briefing_profiles (
  profile_id text PRIMARY KEY, owner_user_id text NOT NULL REFERENCES users(user_id),
  name text NOT NULL, enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  config jsonb NOT NULL, next_run_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intel_briefing_recipients (
  profile_id text NOT NULL REFERENCES intel_briefing_profiles(profile_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id), channels jsonb NOT NULL DEFAULT '["inbox"]',
  PRIMARY KEY(profile_id,user_id)
);
CREATE TABLE IF NOT EXISTS intel_briefing_runs (
  run_id text PRIMARY KEY, profile_id text NOT NULL REFERENCES intel_briefing_profiles(profile_id),
  trigger text NOT NULL CHECK(trigger IN ('scheduled','manual')), request_key text,
  scheduled_for timestamptz NOT NULL, period_start timestamptz, period_end timestamptz, initial_baseline boolean NOT NULL DEFAULT true, profile_version integer NOT NULL, config_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','waiting_sources','running','ready','published','no_change','failed','blocked_budget','canceled')),
  attempt integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  snapshot_id text, briefing_id text, generated_result jsonb, error text, requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_intel_briefing_scheduled ON intel_briefing_runs(profile_id,scheduled_for) WHERE trigger='scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS ux_intel_briefing_manual ON intel_briefing_runs(profile_id,request_key) WHERE trigger='manual';
CREATE INDEX IF NOT EXISTS ix_intel_briefing_due ON intel_briefing_runs(status,next_attempt_at,lease_until);
CREATE TABLE IF NOT EXISTS intel_briefing_snapshots (
  snapshot_id text PRIMARY KEY, run_id text NOT NULL UNIQUE REFERENCES intel_briefing_runs(run_id),
  as_of timestamptz NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intel_profile_seen_revisions (
  profile_id text NOT NULL REFERENCES intel_briefing_profiles(profile_id), profile_version integer NOT NULL,
  evidence_id text NOT NULL, revision text NOT NULL, run_id text NOT NULL REFERENCES intel_briefing_runs(run_id),
  PRIMARY KEY(profile_id,profile_version,evidence_id,revision)
);
ALTER TABLE intel_rag_briefings ADD COLUMN IF NOT EXISTS access_scope text NOT NULL DEFAULT 'legacy_sales';
ALTER TABLE intel_rag_briefings ADD COLUMN IF NOT EXISTS profile_id text REFERENCES intel_briefing_profiles(profile_id);
ALTER TABLE intel_rag_briefings ADD COLUMN IF NOT EXISTS run_id text REFERENCES intel_briefing_runs(run_id);
ALTER TABLE intel_rag_briefings ADD COLUMN IF NOT EXISTS snapshot_id text REFERENCES intel_briefing_snapshots(snapshot_id);
ALTER TABLE intel_rag_briefings ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
ALTER TABLE intel_rag_briefings ADD COLUMN IF NOT EXISTS previous_briefing_id text REFERENCES intel_rag_briefings(briefing_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_intel_briefing_run_report ON intel_rag_briefings(run_id) WHERE run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS intel_notification_outbox (
  delivery_id text PRIMARY KEY, dedup_key text NOT NULL UNIQUE, profile_id text NOT NULL REFERENCES intel_briefing_profiles(profile_id),
  briefing_id text REFERENCES intel_rag_briefings(briefing_id), event_id text, user_id text NOT NULL REFERENCES users(user_id),
  channel text NOT NULL CHECK(channel IN ('inbox','email','app')), kind text NOT NULL CHECK(kind IN ('briefing','important')),
  payload jsonb NOT NULL, digest_delivery_id text REFERENCES intel_notification_outbox(delivery_id), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','skipped')),
  attempt integer NOT NULL DEFAULT 0, retry_limit integer NOT NULL DEFAULT 3, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_token text, lease_until timestamptz,
  provider_id text, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_intel_delivery_due ON intel_notification_outbox(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_intel_delivery_digest ON intel_notification_outbox(digest_delivery_id) WHERE digest_delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_intel_delivery_daily ON intel_notification_outbox(user_id,channel,updated_at) WHERE kind='important';
CREATE TABLE IF NOT EXISTS intel_notification_attempts (
  attempt_id text PRIMARY KEY, delivery_id text NOT NULL REFERENCES intel_notification_outbox(delivery_id),
  attempt integer NOT NULL, status text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_id,attempt)
);
CREATE TABLE IF NOT EXISTS intel_briefing_audit (
  audit_id bigserial PRIMARY KEY, profile_id text, run_id text, actor_user_id text, action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intel_briefing_runtime (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intel_briefing_signal_checks (
  signal_id text PRIMARY KEY REFERENCES intel_signals(signal_id) ON DELETE CASCADE,
  source_updated_at timestamptz NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
