-- 319: 입찰 제안서 초안·발행판. 2026-10-31 원격 모든 브랜치 최대 번호 318 확인(GPT 작업본의 317은 main 의 317_overtime 과 충돌해 재번호).
-- 선행: 회사소개서 권한(catalog.manage/publish, 309). 신규 권한 부여 없음. 멱등.
-- 초안/발행본은 catalog.manage, 발행은 catalog.publish도 요구한다. 전 직원 catalog.view는 쓰지 않는다.
-- 발행 원본·도식 PNG·HWPX를 같은 트랜잭션에 저장한다. 발행 행을 수정하거나 삭제하는 API는 없다.
CREATE TABLE IF NOT EXISTS proposal_documents (
  document_id text PRIMARY KEY,
  document jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at text NOT NULL,
  created_by text NOT NULL,
  updated_at text NOT NULL,
  updated_by text NOT NULL,
  CHECK (document->>'id' = document_id),
  CHECK (document->>'schemaVersion' IN ('1', '2'))
);
CREATE INDEX IF NOT EXISTS idx_proposal_documents_updated ON proposal_documents(updated_at DESC);
CREATE TABLE IF NOT EXISTS proposal_editions (
  edition_id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES proposal_documents(document_id),
  revision integer NOT NULL CHECK (revision >= 1),
  document_snapshot jsonb NOT NULL,
  figure_snapshot jsonb NOT NULL,
  hwpx_bytes bytea NOT NULL CHECK (octet_length(hwpx_bytes) <= 31457280),
  hwpx_sha256 text NOT NULL CHECK (length(hwpx_sha256) = 64),
  file_name text NOT NULL,
  created_at text NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposal_editions_document ON proposal_editions(document_id, created_at DESC);
