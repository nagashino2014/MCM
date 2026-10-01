-- 270: 견적 기준 세트에 사업장 전용(개별) 범위 추가 (2026-10-01 사용자 요청)
-- 배경: 기준 세트는 세분류마다 1개가 모든 사업장에 공통 적용되는 표준셋이었다. 수도권매립지관리공사처럼
--       자체 산출내역서의 업무공량을 제시하는 발주처는 그 사업장 전용 기준 세트가 필요하다.
-- facility_id NULL = 표준 세트(종전과 동일), 값이 있으면 그 사업장 전용 세트.
-- 견적 기준 관리 화면의 '기준 세트(개별)' 탭에서 관리하고, 견적서 작성 화면은 수신처 사업장에
-- 전용 세트가 있으면 표준 대신 적용할 수 있다.
-- 관례: 멱등. 기존 행은 facility_id NULL(표준)로 남아 동작이 바뀌지 않는다.

ALTER TABLE quote_rate_sets
  ADD COLUMN IF NOT EXISTS facility_id text REFERENCES facilities(facility_id) ON DELETE CASCADE;

-- 136 의 UNIQUE (service_type, service_subtype, version) 는 같은 세분류의 사업장 전용 세트를 막는다
-- (제약 이름은 PostgreSQL 기본 명명). 사업장 범위를 포함한 유일 인덱스로 바꾼다.
ALTER TABLE quote_rate_sets
  DROP CONSTRAINT IF EXISTS quote_rate_sets_service_type_service_subtype_version_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_rate_sets_scope
  ON quote_rate_sets (service_type, service_subtype, version, COALESCE(facility_id, ''));

CREATE INDEX IF NOT EXISTS idx_quote_rate_sets_facility
  ON quote_rate_sets (facility_id) WHERE facility_id IS NOT NULL;
