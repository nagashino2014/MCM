-- 337_mail_sender_rule_marks.sql
-- 코넨사인 메일 — 보낸 사람 [메일 분류 지정] 소급·해제 보완(11-03 사용자 보고: 지정해도 1건만 분류됨).
-- 발신자 규칙이 받은편지함 라벨(mail_message_state.category_id)을 바꾼 메일을 기록한다.
--   prev_category_id = 규칙이 바꾸기 전 라벨(없으면 NULL). [자동 분류 해제] 때 이 값으로 되돌린다.
--   mail_message_state 는 intel 브리핑 배치(고정 revision)도 쓰는 표라 열을 추가하지 않고 별도 표로 둔다.
-- 선행: 095·096(메일 표), 305(mail_sender_rules). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS mail_sender_rule_marks (
  mailbox_id       text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  message_id       text NOT NULL REFERENCES mail_messages(message_id) ON DELETE CASCADE,
  sender           text NOT NULL,          -- 규칙 키(mail_sender_rules.sender, 소문자 이메일)
  prev_category_id text REFERENCES mail_folders(folder_id) ON DELETE SET NULL,
  created_at       text NOT NULL,
  PRIMARY KEY (mailbox_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_sender_rule_marks_sender ON mail_sender_rule_marks (mailbox_id, sender);

-- 기존 규칙(305 이후 지정분)이 이미 라벨을 붙인 받은편지함 메일을 기록한다 — 이전 라벨은 남아 있지 않아 NULL(해제 시 미분류로).
INSERT INTO mail_sender_rule_marks (mailbox_id, message_id, sender, prev_category_id, created_at)
SELECT r.mailbox_id, s.message_id, r.sender, NULL, now()::text
  FROM mail_sender_rules r
  JOIN mail_message_state s ON s.mailbox_id = r.mailbox_id AND s.category_id = r.category_id
  JOIN mail_folders f ON f.folder_id = s.folder_id AND f.system_kind = 'inbox'
  JOIN mail_messages m ON m.message_id = s.message_id AND m.mailbox_id = r.mailbox_id
 WHERE lower(btrim(coalesce(substring(m.from_addr from '<([^>]+)>'), m.from_addr, ''))) = r.sender
ON CONFLICT (mailbox_id, message_id) DO NOTHING;
