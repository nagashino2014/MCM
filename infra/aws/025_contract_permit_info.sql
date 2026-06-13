-- 계약 상세 허가 정보 (통합허가 분류 전용).
-- 계약 관리 > 계약 상세의 '허가 정보' 섹션과
-- 수주/수금/발행 현황 > 완료 현황 탭의 완료일(허가일)에서 사용한다.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS permit_issued_at text; -- 허가일 (YYYY-MM-DD)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS permit_no text;        -- 허가번호
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS permit_note text;      -- 비고
