-- 063_intel_eiass.sql
-- 발주 신호 3차 소스: EIASS 환경영향평가 협의진행현황(source='eiass'). 웹 크롤링(공식 API는 지연 사본이라 미사용).
-- 환경영향평가(eia)/전략(sperss)/소규모(mperss) 협의 접수 = 공장·산단 신설의 법정 선행 신호(착공 6개월~2년 전).
-- 062 위에 적용. 멱등. external_id=EIASS 사업코드(예: HG20260394). 상세(사업비·규모·대행업체 등)는 raw_json.

ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS region        text; -- 소재지(사업위치 주소)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS agency        text; -- 협의기관(유역·지방환경청 등)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS progress_step text; -- 협의 진행단계(예: 검토서 본안-접수)

CREATE INDEX IF NOT EXISTS ix_intel_signals_region ON intel_signals (region);
CREATE INDEX IF NOT EXISTS ix_intel_signals_agency ON intel_signals (agency);
