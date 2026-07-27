-- 102_mail_categories_spam.sql
-- 코넨사인 메일 G2-12 — 카테고리(사용자 폴더 연동)·스팸 발신자 차단·메일함 설정.
-- 카테고리는 mail_folders 의 사용자 폴더(system_kind IS NULL)와 동일 엔티티 — 생성/삭제가 보관함 폴더와 자동 연동.
-- 멱등.

-- 받은편지함 메일의 카테고리 라벨(사용자 폴더 참조). 보관 시 이 폴더로 이동한다.
ALTER TABLE mail_message_state
  ADD COLUMN IF NOT EXISTS category_id text REFERENCES mail_folders(folder_id) ON DELETE SET NULL;

-- 사용자 폴더(카테고리) 이름은 메일함 내 유일.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_folders_user_name
  ON mail_folders(mailbox_id, name) WHERE system_kind IS NULL;

-- 스팸 발신자 차단 목록 — 수신 파이프라인이 조회해 스팸함으로 분류.
CREATE TABLE IF NOT EXISTS mail_spam_senders (
  mailbox_id text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  sender     text NOT NULL,              -- 소문자 이메일
  created_at text NOT NULL,
  PRIMARY KEY (mailbox_id, sender)
);

-- 메일함별 설정(스팸 키워드·보관기간·용량 배분 등) — jsonb 자유 스키마.
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
