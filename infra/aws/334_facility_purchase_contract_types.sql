-- 334_facility_purchase_contract_types.sql
-- 사업장 '계약 유형'(2026-11-03 사용자 요청) — 사업장 등록·편집의 '대상 용역 카테고리'를 '계약 유형'으로 바꾸고
--   매출 계약(기존 facility_service_categories 5종)과 매입 계약(아래 4종) 두 줄로 나눈다.
--   매입 계약 유형: outsourcing(외주 계약) / subscription(정기 구독) / lease(임대 계약) / management(관리 계약)
--   값 목록은 frontend/lib/contracts/purchase/options.ts(PURCHASE_TYPE_ORDER)가 단일 원천이고 서버가 정규화한다.
--   기존 카테고리 표·값은 손대지 않고, 기존 사업장은 빈 배열로 시작한다(백필 없음).
-- 멱등: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS purchase_contract_types text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_facilities_purchase_contract_types ON facilities USING gin(purchase_contract_types);
