-- 099_mail_signatures.sql
-- 코넨사인 메일 G2-9 — 메일 서명 템플릿(서식명 지정·복수 저장·기본 지정, 네이버 메일 방식).
-- 기존 mailboxes.signature_html(단일)은 하위호환 폴백으로 유지(기본 서명 없을 때만 사용).
-- 설계: docs/company-email-blueprint.md §4 / groupware-ux-overhaul-blueprint.md §5. 멱등.

CREATE TABLE IF NOT EXISTS mail_signatures (
  signature_id text PRIMARY KEY,
  mailbox_id   text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  name         text NOT NULL,            -- 서식명(예: "기본 서명", "영업용")
  body_html    text NOT NULL,
  is_default   integer NOT NULL DEFAULT 0, -- 새 메일 작성 시 자동 삽입(메일함당 1개)
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_signatures_mailbox ON mail_signatures(mailbox_id);
