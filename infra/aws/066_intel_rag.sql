-- 066_intel_rag.sql
-- D단계: 벡터 DB + RAG. intel_signals 전 등급(excluded/monitoring 포함)을 임베딩해 축적하고,
-- "RAG & 영업 발굴" 화면의 질의형 브리핑(pgvector 유사도 검색 → Claude 생성 보고서)에 쓴다.
-- 065 위에 적용. 멱등. 임베딩 모델 = Voyage voyage-3.5-lite(1024차원) — 차원 변경 시 테이블 재생성 필요.

CREATE EXTENSION IF NOT EXISTS vector;

-- 신호 1건 = 임베딩 1건(제목·요약·본문을 합친 단일 문서, 청크 분할 없음 — 본문 최대 3000자라 충분)
CREATE TABLE IF NOT EXISTS intel_embeddings (
  signal_id   text PRIMARY KEY REFERENCES intel_signals(signal_id) ON DELETE CASCADE,
  content     text NOT NULL,             -- 임베딩에 사용한 문서 텍스트(브리핑 컨텍스트로 재사용)
  embedding   vector(1024) NOT NULL,
  model       text NOT NULL,             -- 임베딩 모델(예: voyage-3.5-lite)
  created_at  text NOT NULL
);

-- 코사인 근사 검색(HNSW). 수천~수만 건 규모에 충분.
CREATE INDEX IF NOT EXISTS ix_intel_embeddings_hnsw
  ON intel_embeddings USING hnsw (embedding vector_cosine_ops);

-- 질의형 브리핑 이력(질문·답변·출처 스냅샷 보관 — 신호가 삭제돼도 이력은 유지)
CREATE TABLE IF NOT EXISTS intel_rag_briefings (
  briefing_id  text PRIMARY KEY,
  question     text NOT NULL,
  answer_md    text,                     -- Claude 생성 브리핑(마크다운)
  sources      jsonb,                    -- [{signalId, score, source, companyName, reportName, disclosedAt}]
  filters      jsonb,                    -- 검색 범위 스냅샷(source/grade/from/to)
  model        text,                     -- 생성 모델
  status       text NOT NULL DEFAULT 'done',  -- done/error
  error        text,
  created_by   text,                     -- users.user_id (FK 없이 느슨하게 — 계정 삭제와 무관하게 보존)
  created_at   text NOT NULL
);

ALTER TABLE intel_rag_briefings DROP CONSTRAINT IF EXISTS intel_rag_briefings_status_check;
ALTER TABLE intel_rag_briefings ADD  CONSTRAINT intel_rag_briefings_status_check
  CHECK (status IN ('done','error'));

CREATE INDEX IF NOT EXISTS ix_intel_rag_briefings_created ON intel_rag_briefings (created_at DESC);
