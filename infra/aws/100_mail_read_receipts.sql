-- 100_mail_read_receipts.sql
-- 코넨사인 메일 G2-10 — 수신 확인(읽음 추적). 발송 메일에 수신자별 추적 픽셀을 삽입하고,
-- 수신자가 메일을 열면(이미지 로드) /api/mail/track 이 여기에 기록한다(그룹웨어 표준 방식).
-- 한계: 이미지 차단 클라이언트는 미검출(다우오피스 등 동일). 멱등.

CREATE TABLE IF NOT EXISTS mail_read_receipts (
  message_id      text NOT NULL REFERENCES mail_messages(message_id) ON DELETE CASCADE,
  recipient       text NOT NULL,          -- 수신자 이메일(소문자)
  first_opened_at text NOT NULL,
  last_opened_at  text NOT NULL,
  open_count      integer NOT NULL DEFAULT 1,
  PRIMARY KEY (message_id, recipient)
);
CREATE INDEX IF NOT EXISTS idx_mail_read_receipts_msg ON mail_read_receipts(message_id);
