-- 096_mail_folders.sql
-- 회사 도메인 메일 P1 — 폴더/메시지 배치·플래그/드래프트.
-- 시스템 폴더(inbox/sent/drafts/trash/archive/spam)는 mailbox 생성 시 코드가 시드한다(lib/mail/mailbox.ts).
-- 설계: docs/company-email-blueprint.md §4(마이그레이션 096). 멱등.

CREATE TABLE IF NOT EXISTS mail_folders (
  folder_id   text PRIMARY KEY,
  mailbox_id  text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  name        text NOT NULL,
  system_kind text,   -- 'inbox'|'sent'|'drafts'|'trash'|'archive'|'spam' / NULL=사용자 폴더
  sort        integer NOT NULL DEFAULT 0,
  created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_folders_mailbox ON mail_folders(mailbox_id);
-- 시스템 폴더는 메일함당 종류별 1개.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_folders_sys
  ON mail_folders(mailbox_id, system_kind) WHERE system_kind IS NOT NULL;

-- 메시지 × 폴더 배치 + 플래그. 한 메시지가 여러 폴더(라벨)에 놓일 수 있어 조인 테이블.
CREATE TABLE IF NOT EXISTS mail_message_state (
  message_id text NOT NULL REFERENCES mail_messages(message_id) ON DELETE CASCADE,
  folder_id  text NOT NULL REFERENCES mail_folders(folder_id) ON DELETE CASCADE,
  mailbox_id text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  is_read    integer NOT NULL DEFAULT 0,
  is_starred integer NOT NULL DEFAULT 0,
  is_deleted integer NOT NULL DEFAULT 0,
  labels     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at text NOT NULL,
  PRIMARY KEY (message_id, folder_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_state_folder ON mail_message_state(folder_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_mail_state_mailbox ON mail_message_state(mailbox_id);

-- 작성 중 임시저장(자동저장). P3 에서 본격 사용.
CREATE TABLE IF NOT EXISTS mail_drafts (
  draft_id   text PRIMARY KEY,
  mailbox_id text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  to_addrs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addrs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  bcc_addrs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject    text,
  body_html  text,
  in_reply_to text,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_mailbox ON mail_drafts(mailbox_id);
