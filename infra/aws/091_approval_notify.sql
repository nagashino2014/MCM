-- 091: 전자결재 알림(AX-P0) — 이벤트별 채널 설정 + 발송 로그(멱등 dedup).
-- 설계: docs/e-approval-differentiation-blueprint.md §9-1.
-- 관례: text 타임스탬프, integer boolean, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 이벤트별 채널 on/off — 이메일(SES) + 알림톡(솔라피) 병행.
--    remind_after_hours 는 remind 이벤트 전용(리마인드 대기시간, AX-P1에서 사용).
CREATE TABLE IF NOT EXISTS approval_notify_settings (
  event text PRIMARY KEY,                    -- step_pending|delegated|approved|rejected|remind
  email_enabled integer NOT NULL DEFAULT 1,
  alimtalk_enabled integer NOT NULL DEFAULT 1,
  remind_after_hours integer,
  updated_at text NOT NULL
);
INSERT INTO approval_notify_settings (event, email_enabled, alimtalk_enabled, remind_after_hours, updated_at) VALUES
  ('step_pending', 1, 1, NULL, now()::text),
  ('delegated',    1, 1, NULL, now()::text),
  ('approved',     1, 1, NULL, now()::text),
  ('rejected',     1, 1, NULL, now()::text),
  ('remind',       1, 1, 24,   now()::text)
ON CONFLICT (event) DO NOTHING;

-- 2) 발송 로그 — dedup_key UNIQUE 로 중복 발송 방지(재활성/리마인드 멱등).
--    채널별 결과는 channels jsonb(bid_match_notices.channel_results 패턴).
CREATE TABLE IF NOT EXISTS approval_notify_log (
  notify_id text PRIMARY KEY,
  doc_id text NOT NULL,
  step_id text,
  event text NOT NULL,
  recipient_user_id text,
  dedup_key text NOT NULL,
  channels jsonb,
  ok integer,
  detail text,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_notify_dedup ON approval_notify_log(dedup_key);
CREATE INDEX IF NOT EXISTS idx_approval_notify_doc ON approval_notify_log(doc_id);
