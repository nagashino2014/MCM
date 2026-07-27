-- 097_mail_send_log.sql
-- 회사 도메인 메일 P1 — 발송 로그(멱등). + 바운스(P2)·설정 테이블 선행 생성.
-- 발송 디스패처 패턴은 approval_notify_log(멱등 dedup_key)을 이식했다.
-- 설계: docs/company-email-blueprint.md §4(마이그레이션 097). 멱등.

-- 발송 시도·SES 결과. dedup_key 로 중복 발송(재시도/더블클릭)을 1회로 억제.
CREATE TABLE IF NOT EXISTS mail_send_log (
  send_id        text PRIMARY KEY,
  mailbox_id     text REFERENCES mailboxes(mailbox_id) ON DELETE SET NULL,
  message_id     text REFERENCES mail_messages(message_id) ON DELETE SET NULL,
  dedup_key      text NOT NULL UNIQUE,
  ses_message_id text,
  to_count       integer NOT NULL DEFAULT 0,
  ok             integer NOT NULL DEFAULT 0,
  error          text,
  created_at     text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_send_log_mailbox ON mail_send_log(mailbox_id, created_at DESC);

-- 바운스/신고(complaint) 수신(P2) — SNS 구독 워커가 적재해 하드바운스 주소를 발송 차단.
CREATE TABLE IF NOT EXISTS mail_bounces (
  bounce_id      text PRIMARY KEY,
  address        text NOT NULL,
  bounce_type    text,          -- 'hard'|'soft'|'complaint'
  ses_message_id text,
  detail         jsonb,
  suppressed     integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_bounces_address ON mail_bounces(address);

-- 메일 전역 설정(싱글턴 key-value). 도메인·보존기간 등. P4 에서 확장.
CREATE TABLE IF NOT EXISTS mail_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at text NOT NULL
);
