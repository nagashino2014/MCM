-- 305_mail_sender_rules_contacts.sql
-- 코넨사인 메일 — 보낸 사람 팝업 메뉴(10-21 사용자 요청).
-- 1) 발신자별 자동 분류 규칙: 이 주소로 온 메일을 받은편지함의 지정 분류(카테고리 = 사용자 폴더)로 라벨링.
--    지정 시 기존 받은편지함 메일에 소급 적용하고, 이후 수신(inbound.ts)은 규칙을 조회해 category_id 를 붙인다.
-- 2) 개인 메일 주소록: 팝업의 [주소록 추가]로 저장, 메일 쓰기 받는 사람 자동완성에 함께 나온다.
--    (주소록 메뉴의 외부 연락처는 사업장 담당자 원장이라 개인이 바로 추가할 수 없어 메일함 단위로 둔다)
-- 멱등.

CREATE TABLE IF NOT EXISTS mail_sender_rules (
  mailbox_id  text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  sender      text NOT NULL,              -- 소문자 이메일
  category_id text NOT NULL REFERENCES mail_folders(folder_id) ON DELETE CASCADE,
  created_at  text NOT NULL,
  PRIMARY KEY (mailbox_id, sender)
);

CREATE TABLE IF NOT EXISTS mail_contacts (
  mailbox_id   text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  address      text NOT NULL,             -- 소문자 이메일
  display_name text,
  created_at   text NOT NULL,
  PRIMARY KEY (mailbox_id, address)
);
