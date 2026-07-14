-- 068_intel_industry.sql
-- 업종 상관관계 축(블루프린트 확정 v2): 신호의 통합허가 대상 업종·관련성을 등급과 직교하는 별도 축으로.
-- industry = 대상 업종 id(코드 상수 20종 + industrial-complex/other + 설정 추가분).
-- industry_relevance 4단계: direct(대상 업종 자체·입주 기반) / supply_chain(밸류체인 유발) /
--                          low(제조지만 거리 있음) / none(비제조·무관).
-- 배제가 아니라 축 추가 — 리스트는 전체 노출(pill), RAG 검색·브리핑만 none 기본 제외.
-- 067 위에 적용. 멱등.

ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS industry           text;
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS industry_relevance text;
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS relevance_note     text;  -- supply_chain 일 때 유발 경로 한 줄

ALTER TABLE intel_signals DROP CONSTRAINT IF EXISTS intel_signals_industry_relevance_check;
ALTER TABLE intel_signals ADD  CONSTRAINT intel_signals_industry_relevance_check
  CHECK (industry_relevance IS NULL OR industry_relevance IN ('direct','supply_chain','low','none'));

CREATE INDEX IF NOT EXISTS ix_intel_signals_relevance ON intel_signals (industry_relevance);
CREATE INDEX IF NOT EXISTS ix_intel_signals_industry  ON intel_signals (industry);
