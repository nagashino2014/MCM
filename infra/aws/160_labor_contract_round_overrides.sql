-- 160: 근로계약 일괄 갱신 라운드 — 인원별 예외 산정(overrides) 저장 (2026-08-14)
-- 미리보기 표에서 '예외' 체크 → '산정' 모달로 개인별 인상률/인상액·사유를 지정하면
-- 일괄 작성 시 해당 인원만 예외 산식이 적용된다.
-- 구조: { "<employeeId>": { "mode": "rate"|"amount", "value": number,
--                            "reason": "성과우수"|"성과부진"|"인사평가 우수"|"인사평가 미흡",
--                            "reasonDetail": string } }
ALTER TABLE labor_contract_rounds ADD COLUMN IF NOT EXISTS overrides jsonb;
