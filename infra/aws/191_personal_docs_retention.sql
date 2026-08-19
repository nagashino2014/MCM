-- 191: 개인문서함 + 파일 보존정책 실행 로그.
-- 개인문서함(/files/personal): 사용자별 할당 용량(인원별 용량 배분 모달의 '개인 문서함' 값) 내
--   자유 업로드·삭제·전송(메일 작성창 첨부 프리필 / 메신저 DM 발송). 본인 스코프 전용 —
--   관리자 파일함(/files) 통합 목록에는 포함하지 않는다(개인 공간, 개보법 §3 최소침해).
-- file_retention_runs: 자동 삭제 배치(file-retention-tick)의 실행 이력 — 감사 추적용.
-- 멱등.

CREATE TABLE IF NOT EXISTS personal_documents (
  document_id  text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  content_type text,
  byte_size    bigint NOT NULL DEFAULT 0,
  sha256       text,
  storage_provider text,
  storage_bucket   text,
  storage_key  text NOT NULL,
  created_at   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_documents_user ON personal_documents(user_id, created_at DESC);

-- 사용자별 저장 용량 할당 — 기본 5GB. 인원별 용량 배분 모달(MailQuotaModal)에서 관리자 설정.
CREATE TABLE IF NOT EXISTS user_storage_quotas (
  user_id    text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  personal_doc_quota_bytes bigint NOT NULL DEFAULT 5368709120,
  updated_at text NOT NULL,
  updated_by text
);

-- 보존정책 배치 실행 이력(일 1회) — 무엇이 언제 얼마나 지워졌는지 남긴다.
CREATE TABLE IF NOT EXISTS file_retention_runs (
  run_id        bigserial PRIMARY KEY,
  ran_at        text NOT NULL,
  deleted_count integer NOT NULL DEFAULT 0,
  detail        jsonb
);
