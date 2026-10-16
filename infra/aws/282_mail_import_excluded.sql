-- 282: 메일 가져오기 I-2·I-3 — 제외 집계 열 — 2026-10-16
-- 지메일 Takeout(.mbox)의 스팸·휴지통·채팅, IMAP 기간 밖 메일처럼 "일부러 가져오지 않은" 항목을 실패와 구분해 센다.
-- 집계 규칙: 원본 항목 수 = 가져옴 + 중복 + 실패 + 제외. 설계: docs/mail-import-blueprint.md §2.5.
-- 관례: 멱등(IF NOT EXISTS). GRANT 없음(265 default privileges).

ALTER TABLE mail_import_jobs
  ADD COLUMN IF NOT EXISTS excluded_count integer NOT NULL DEFAULT 0;
