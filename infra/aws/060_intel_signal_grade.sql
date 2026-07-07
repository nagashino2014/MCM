-- 060_intel_signal_grade.sql
-- API & RAG: DART 신호 판별 정밀화. DS005(주요사항보고서 주요정보) 정형 API 상세로
-- 자산구분·취득목적을 얻어 신호 등급(confirmed/candidate/monitoring/excluded)을 부여한다.
-- 059 위에 적용. 멱등.

-- 신호 등급 + 정형 상세 컬럼(유형자산 양수 결정 tgastInhDecsn 등)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS signal_grade    text NOT NULL DEFAULT 'candidate';
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS asset_class     text;   -- ast_sen (토지/건물/기계장치…)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS acquire_purpose text;   -- inh_pp (양수목적)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS counterparty    text;   -- dlptn_cmpnm (거래상대방)
-- amount(bigint)는 059 기존 컬럼 재사용(inhdtl_inhprc), 원본 상세는 raw_json 에 저장.

-- 등급 값 제약(멱등 재적용)
ALTER TABLE intel_signals DROP CONSTRAINT IF EXISTS intel_signals_signal_grade_check;
ALTER TABLE intel_signals ADD  CONSTRAINT intel_signals_signal_grade_check
  CHECK (signal_grade IN ('confirmed','candidate','monitoring','excluded'));

CREATE INDEX IF NOT EXISTS ix_intel_signals_grade ON intel_signals (signal_grade);
