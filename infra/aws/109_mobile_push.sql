-- 109_mobile_push.sql
-- 모바일 푸시 알림 인프라(M1) — Expo Push Service 기반.
--   mobile_push_tokens  : 기기별 Expo push token(사용자당 여러 기기 가능)
--   mobile_notify_prefs : 사용자별 이벤트 수신 여부 + 방해금지 시간대
--   mobile_push_log     : 발송 이력 + dedup(중복 발송 방지)
-- 기존 approval_notify_settings(이벤트별 채널 on/off)에는 push 채널을 컬럼으로 추가한다.
-- 설계: docs/mobile-app-integration-blueprint.md §4. 멱등.

CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  token_id     text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expo_token   text NOT NULL UNIQUE,          -- ExponentPushToken[...]
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  device_id    text,                          -- 기기 식별(같은 기기 재설치 시 갱신용)
  app_version  text,
  created_at   text NOT NULL,
  last_seen_at text NOT NULL,
  revoked_at   text,                          -- 로그아웃·수신거부·DeviceNotRegistered
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user ON mobile_push_tokens(user_id) WHERE revoked_at IS NULL;

-- 사용자별 이벤트 수신 설정. 행이 없으면 "기본값 수신"으로 간주한다(카탈로그 기본값은 앱/서버 상수).
CREATE TABLE IF NOT EXISTS mobile_notify_prefs (
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_key  text NOT NULL,                   -- board.posted, approval.step_pending, ...
  enabled    integer NOT NULL DEFAULT 1,
  updated_at text NOT NULL,
  PRIMARY KEY (user_id, event_key)
);

-- 방해금지(사용자당 1행). quiet_from > quiet_to 이면 자정을 넘는 구간(예: 22:00~07:00).
CREATE TABLE IF NOT EXISTS mobile_notify_quiet_hours (
  user_id    text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  enabled    integer NOT NULL DEFAULT 1,
  quiet_from text NOT NULL DEFAULT '22:00',   -- HH:MM (KST)
  quiet_to   text NOT NULL DEFAULT '07:00',
  updated_at text NOT NULL
);

-- 발송 이력. dedup_key UNIQUE 로 재호출·재활성 시 중복 발송을 막는다
-- (approval_notify_log 와 동일한 claim 패턴).
CREATE TABLE IF NOT EXISTS mobile_push_log (
  push_id     text PRIMARY KEY,
  user_id     text REFERENCES users(user_id) ON DELETE SET NULL,
  event_key   text NOT NULL,
  dedup_key   text NOT NULL UNIQUE,
  target_ref  text,                           -- 대상 식별(post_id·doc_id 등)
  title       text,
  body        text,
  link        text,                           -- 앱 딥링크 경로(/board/xxx)
  ok          integer NOT NULL DEFAULT 0,
  detail      text,                           -- sent | failed | skipped(사유)
  tickets     jsonb,                          -- Expo 티켓/영수증 원문
  created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_log_user ON mobile_push_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_push_log_event ON mobile_push_log(event_key, created_at DESC);

-- 결재 알림 채널에 push 추가(기존 email/alimtalk 과 나란히). 기본 on.
-- ⚠ approval_notify_settings 는 마이그 091(AX-P0)에서 생기는데 환경에 따라 아직 없을 수 있다
--   (staging 실측 2026-07-28). 없으면 조용히 건너뛰고, 091 적용 시 이 파일을 다시 실행하면 된다.
--   컬럼이 없어도 앱은 동작한다 — getNotifySetting 이 push_enabled 기본 on 으로 폴백한다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'approval_notify_settings') THEN
    ALTER TABLE approval_notify_settings ADD COLUMN IF NOT EXISTS push_enabled integer NOT NULL DEFAULT 1;
  END IF;
END $$;
