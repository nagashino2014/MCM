-- 067_intel_dedup.sql
-- 뉴스 중복 병합: 같은 사건을 다룬 변형 기사(다른 언론사·재작성)가 키워드 수집으로 별개 신호가 되는 문제.
-- 삭제 대신 duplicate_of(대표 신호 ID) 마킹으로 보존 — 리스트·RAG 검색 기본에서는 중복을 제외하고,
-- 대표 신호를 통해 원문 접근은 유지한다. 판정은 임베딩 코사인(rag-indexer.markNewsDuplicates).
-- 066 위에 적용. 멱등.

ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS duplicate_of text;  -- 대표 신호 signal_id (FK 없이 느슨하게)

CREATE INDEX IF NOT EXISTS ix_intel_signals_duplicate_of ON intel_signals (duplicate_of);
