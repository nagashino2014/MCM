-- 281: 메일 가져오기(I-1) — 2026-10-16 사용자 요청
-- 아마란스 메일함 백업 ZIP·.eml(이후 .mbox·IMAP)로 과거 송수신 메일을 본인 MCM 메일함에 옮긴다.
-- 작업은 instrumentation 틱이 조금씩 처리하고(cursor 로 이어서), 결과는 imported + duplicate + failed = total 로 맞춘다.
-- 설계: docs/mail-import-blueprint.md §3.
-- 관례: 멱등(IF NOT EXISTS). GRANT 없음(265 default privileges).

CREATE TABLE IF NOT EXISTS mail_import_jobs (
  job_id           text PRIMARY KEY,
  mailbox_id       text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  user_id          text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('file', 'imap')),
  source_label     text NOT NULL,                          -- '아마란스', '지메일' … (폴더 이름에 사용)
  source_address   text,                                   -- 원 계정 주소(보조 판별)
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'paused', 'done', 'failed', 'cancelled')),
  options          jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { inboxPlacement: boolean }
  -- 파일 방식: 파일마다 원본 메일함 종류
  uploads          jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{key, name, size, folderKind: inbox|sent|custom, folderName}]
  -- IMAP 방식(I-3). 비밀번호는 작업이 끝나면 NULL 로 지운다(설계 §5.3)
  imap_host        text,
  imap_port        integer,
  imap_user        text,
  imap_secret_enc  text,
  secret_expires_at text,
  -- 진행·결과
  cursor           jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { file: 순번, entry: 순번 } / IMAP 폴더·UID
  total_count      integer,                                -- 원본 항목 수(파일 방식은 ZIP 항목 합계)
  imported_count   integer NOT NULL DEFAULT 0,
  duplicate_count  integer NOT NULL DEFAULT 0,
  failed_count     integer NOT NULL DEFAULT 0,
  link_attachment_count integer NOT NULL DEFAULT 0,        -- 복구 안 되는 링크형 첨부가 든 메일 수
  bytes_imported   bigint NOT NULL DEFAULT 0,              -- 압축 해제 기준
  last_error       text,
  failures         jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 최근 실패 100건 [{file, entry, reason}]
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  finished_at      text
);
CREATE INDEX IF NOT EXISTS idx_mail_import_jobs_user ON mail_import_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_import_jobs_active ON mail_import_jobs(status, created_at)
  WHERE status IN ('pending', 'running', 'paused');
