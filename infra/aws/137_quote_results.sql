-- 137: 견적 Q5 — 수주 결과 상세 기입 + 세분류 정정.
-- 설계: docs/quotation-blueprint.md §5-5(영업·계약 연동 → 견적가 대비 수주율 리포트 → 시장
--       보정계수 재조정). 136 의 quotations.result(pending|won|lost|dropped) 를 분석 가능한
--       수준으로 확장한다: 결정일·경쟁 낙찰가(실주)·수주 금액·사유 코드·계약 연결.
-- 관례: text 타임스탬프, integer boolean, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 결과 상세 컬럼
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS result_at     text;   -- 결과 확정일 YYYY-MM-DD
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS result_amount bigint; -- 수주=계약금액 / 실주=경쟁 낙찰가(파악 시)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS result_reason text;   -- 사유 코드(lib/quote/types QUOTE_RESULT_REASONS)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS contract_id   text;   -- 수주 시 계약 연결(contracts.contract_id, 선택)

CREATE INDEX IF NOT EXISTS idx_quotations_result ON quotations(result, service_subtype);

-- 2) 세분류 정정(2026-08-06 사용자 지시) — 견적 기준 세트에 한한다.
--    영업허가: 통합허가 → 장외&화관법 / 장외영향평가 → 화학사고예방관리계획.
--    (계약관리 CONTRACT_SERVICE_OPTIONS 및 기존 계약 데이터는 그대로 둔다)
UPDATE quote_rate_sets s
   SET service_type = '장외&화관법'
 WHERE s.service_subtype = '영업허가' AND s.service_type = '통합허가'
   AND NOT EXISTS (SELECT 1 FROM quote_rate_sets t
                    WHERE t.service_type = '장외&화관법' AND t.service_subtype = '영업허가' AND t.version = s.version);

UPDATE quote_rate_sets s
   SET service_subtype = '화학사고예방관리계획'
 WHERE s.service_subtype = '장외영향평가'
   AND NOT EXISTS (SELECT 1 FROM quote_rate_sets t
                    WHERE t.service_type = s.service_type AND t.service_subtype = '화학사고예방관리계획' AND t.version = s.version);
