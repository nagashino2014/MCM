-- 095_mail_core.sql
-- 회사 도메인 메일(코넨사인 메일) P1 — 메일함 코어 스키마.
-- 계정별 mailbox + 메시지 + 첨부 + 별칭. 발송(P1)은 mailboxes/mail_messages/mail_attachments 를 쓴다.
-- 설계: docs/company-email-blueprint.md §4(마이그레이션 095). 멱등.

-- 계정별 메일함(주소의 원천). address = {local_part}@{도메인}.
-- local_part 는 042 의 users.email_local(기존 개인메일 앞자리 승계) 을 기본값으로 채운다(P5 에서 검수).
CREATE TABLE IF NOT EXISTS mailboxes (
  mailbox_id     text PRIMARY KEY,
  user_id        text REFERENCES users(user_id) ON DELETE SET NULL,
  employee_id    text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  address        text NOT NULL UNIQUE,
  local_part     text NOT NULL,
  display_name   text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  signature_html text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mailboxes_user ON mailboxes(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailboxes_local ON mailboxes(local_part);

-- 별칭/배포리스트(개인함 아님) → 실수신자 fan-out. P4 관리 UI 에서 채운다.
CREATE TABLE IF NOT EXISTS mail_aliases (
  alias_id     text PRIMARY KEY,
  alias_local  text NOT NULL UNIQUE,          -- 'sales', 'hr', 'all' ...
  kind         text NOT NULL DEFAULT 'alias' CHECK (kind IN ('alias', 'list')),
  target_mailbox_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active       integer NOT NULL DEFAULT 1,
  created_at   text NOT NULL
);

-- 송·수신 메시지(스레드의 원자). direction='out' 발송본 / 'in' 수신본(P2).
CREATE TABLE IF NOT EXISTS mail_messages (
  message_id      text PRIMARY KEY,
  mailbox_id      text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('in', 'out')),
  rfc_message_id  text,                        -- RFC822 Message-ID 헤더(<uuid@domain>)
  thread_id       text,                        -- References 기반 스레드 그룹
  in_reply_to     text,
  references_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  from_addr       text,
  to_addrs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addrs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  bcc_addrs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to        text,
  subject         text,
  snippet         text,                        -- 본문 미리보기(목록용, 최대 ~200자)
  body_text       text,
  body_html       text,
  raw_s3_key      text,                        -- 원문 MIME(수신 P2). 발송은 null 가능
  size_bytes      bigint,
  has_attachments integer NOT NULL DEFAULT 0,
  ses_message_id  text,                        -- 발송 추적/바운스 매칭
  sent_at         text,
  received_at     text,
  created_at      text NOT NULL,
  -- 수신 멱등(같은 메일함에 동일 RFC Message-ID 중복 적재 방지). 발송본은 rfc_message_id 항상 유일.
  UNIQUE (mailbox_id, rfc_message_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_messages_mailbox ON mail_messages(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_created ON mail_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS mail_attachments (
  attachment_id text PRIMARY KEY,
  message_id    text NOT NULL REFERENCES mail_messages(message_id) ON DELETE CASCADE,
  filename      text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  s3_key        text NOT NULL,
  content_id    text,                          -- 인라인 이미지(cid:)
  created_at    text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_message ON mail_attachments(message_id);
