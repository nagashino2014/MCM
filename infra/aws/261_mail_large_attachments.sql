-- 261: 메일 대용량 첨부(다운로드 링크) — 2026-09-17 사용자 요청
-- 메일 첨부는 SES 원문 한도(40MB, base64 실효 ~28MB)와 수신 측 한도(네이버·Gmail 25MB 안팎) 때문에
-- 원문 첨부 총량을 25MB 로 둔다(10-12 상향, 종전 20MB). 탐색기([내 PC])로 고른 파일은 이 한도를 넘어도 첨부할 수 있게 하고,
-- 넘치는 파일은 S3 에 올린 뒤 본문에 다운로드 링크(앱 경유, 기본 30일)로 넣는다.
-- 링크는 presigned URL 을 직접 넣지 않는다 — ECS 태스크 역할 자격증명은 수 시간 만에 만료돼 링크가 먼저 죽기 때문.
-- 관례: 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS mail_large_attachments (
  upload_id text PRIMARY KEY,
  token text NOT NULL UNIQUE,                    -- 다운로드 링크 토큰(무작위 32바이트, 외부 수신자용 무인증 경로)
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text,
  byte_size bigint NOT NULL DEFAULT 0,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  message_id text,                               -- 발송된 메일(mail_messages) id
  expires_at text,                               -- 발송 시점 + 보관기간
  download_count integer NOT NULL DEFAULT 0,
  last_downloaded_at text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_large_attachments_user ON mail_large_attachments(user_id, status);
