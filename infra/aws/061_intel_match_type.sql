-- 061_intel_match_type.sql
-- API & RAG: 후보 선정 로직 재설계(모집단 역전). 매칭 근거 구분 컬럼 추가.
-- direct  = 공시 회사의 BRN/회사명이 facilities(통합허가 대상)와 직접 매칭
-- counterparty = (2단계) 거래상대방이 통합허가 대상 — 본문/정형 파싱으로 검출
-- 060 위에 적용. 멱등.

ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'direct';

ALTER TABLE intel_signals DROP CONSTRAINT IF EXISTS intel_signals_match_type_check;
ALTER TABLE intel_signals ADD  CONSTRAINT intel_signals_match_type_check
  CHECK (match_type IN ('direct','counterparty'));
