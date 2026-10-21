-- 306_mail_external_client.sql
-- 코넨사인 메일 — 외부 메일 프로그램(아웃룩 등 IMAP/SMTP) 연결 A안(docs/mail-external-client-plan.md §3).
-- 1) 메일 전용 앱 비밀번호: 계정별 발급·폐기, bcrypt 해시만 저장(평문은 발급 화면에 한 번만 보인다).
--    앱 로그인 비밀번호는 프로토콜에 쓰지 않는다.
-- 2) IMAP UID: 폴더(mail_folders)마다 UIDVALIDITY·다음 UID, 배치(mail_message_state)마다 UID.
--    웹의 폴더 이동은 state 행 삭제 + 재삽입이므로 INSERT 트리거 하나로 모든 경로(수신·발송·이동·가져오기)에
--    단조 증가 UID 가 붙는다. folder_id 를 UPDATE 로 바꾸는 경로가 생겨도 새 UID 를 받도록 UPDATE 트리거도 둔다.
-- 3) IMAP 전용 플래그(\Answered·\Deleted·키워드)와 게이트웨이 원문 캐시(크기·헤더·구조 고정 — 같은 UID 의
--    내용이 바뀌면 안 되므로 처음 내려줄 때 원문을 확정해 S3 에 두고 그 키를 기록한다).
-- 멱등. 기존 행 UID 백필은 표 잠금 아래에서 한 트랜잭션으로 한다(백필 중 새 배치가 끼어 UID 가 겹치지 않게).

BEGIN;

CREATE TABLE IF NOT EXISTS mail_app_passwords (
  app_password_id text PRIMARY KEY,
  mailbox_id      text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  user_id         text REFERENCES users(user_id) ON DELETE CASCADE,
  label           text NOT NULL,             -- 사용자가 붙인 이름(예: 사무실 아웃룩)
  password_hash   text NOT NULL,             -- bcrypt
  created_at      text NOT NULL,
  last_used_at    text,
  last_used_ip    text,
  last_used_proto text,                      -- imap | smtp
  revoked_at      text
);
CREATE INDEX IF NOT EXISTS idx_mail_app_passwords_mailbox ON mail_app_passwords(mailbox_id) WHERE revoked_at IS NULL;

ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS imap_uidvalidity bigint;
ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS imap_uidnext bigint NOT NULL DEFAULT 1;

ALTER TABLE mail_message_state ADD COLUMN IF NOT EXISTS imap_uid bigint;
ALTER TABLE mail_message_state ADD COLUMN IF NOT EXISTS imap_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_raw_key text;      -- app_data 버킷 키(확정 원문)
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_raw_size bigint;   -- RFC822.SIZE
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_header bytea;      -- 원문 헤더 블록(빈 줄 포함)
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_structure jsonb;   -- BODYSTRUCTURE 원천(MIME 트리 요약)

LOCK TABLE mail_message_state IN SHARE ROW EXCLUSIVE MODE;

UPDATE mail_folders
   SET imap_uidvalidity = (extract(epoch FROM clock_timestamp())::bigint)
 WHERE imap_uidvalidity IS NULL;

WITH base AS (
  SELECT folder_id, COALESCE(MAX(imap_uid), 0) AS max_uid
    FROM mail_message_state GROUP BY folder_id
), numbered AS (
  SELECT s.message_id, s.folder_id,
         b.max_uid + row_number() OVER (PARTITION BY s.folder_id ORDER BY s.created_at, s.message_id) AS uid
    FROM mail_message_state s JOIN base b ON b.folder_id = s.folder_id
   WHERE s.imap_uid IS NULL
)
UPDATE mail_message_state s
   SET imap_uid = n.uid
  FROM numbered n
 WHERE s.message_id = n.message_id AND s.folder_id = n.folder_id;

UPDATE mail_folders f
   SET imap_uidnext = GREATEST(f.imap_uidnext, x.max_uid + 1)
  FROM (SELECT folder_id, MAX(imap_uid) AS max_uid FROM mail_message_state GROUP BY folder_id) x
 WHERE x.folder_id = f.folder_id;

CREATE OR REPLACE FUNCTION mail_state_assign_imap_uid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.folder_id IS NOT DISTINCT FROM OLD.folder_id THEN
    RETURN NEW;
  END IF;
  UPDATE mail_folders
     SET imap_uidnext = imap_uidnext + 1,
         imap_uidvalidity = COALESCE(imap_uidvalidity, extract(epoch FROM clock_timestamp())::bigint)
   WHERE folder_id = NEW.folder_id
  RETURNING imap_uidnext - 1 INTO NEW.imap_uid;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_mail_state_imap_uid_ins ON mail_message_state;
CREATE TRIGGER trg_mail_state_imap_uid_ins
  BEFORE INSERT ON mail_message_state
  FOR EACH ROW EXECUTE FUNCTION mail_state_assign_imap_uid();

DROP TRIGGER IF EXISTS trg_mail_state_imap_uid_upd ON mail_message_state;
CREATE TRIGGER trg_mail_state_imap_uid_upd
  BEFORE UPDATE OF folder_id ON mail_message_state
  FOR EACH ROW EXECUTE FUNCTION mail_state_assign_imap_uid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_state_imap_uid ON mail_message_state(folder_id, imap_uid);

COMMIT;
