-- 053_facility_contact_dept_type.sql
-- 사업장 담당자에 부서유형(계약/환경) 속성 추가. 영업 사업장 담당자 카드·연락처 관리 연동.
-- 001(facility_contact_people) 위에 적용. 멱등. 기존 항목 모두 유지 + dept_type 만 추가.
--   contract = 계약부서, env = 환경부서.

ALTER TABLE facility_contact_people
  ADD COLUMN IF NOT EXISTS dept_type text;

ALTER TABLE facility_contact_people DROP CONSTRAINT IF EXISTS facility_contact_people_dept_type_check;
ALTER TABLE facility_contact_people ADD  CONSTRAINT facility_contact_people_dept_type_check
  CHECK (dept_type IS NULL OR dept_type IN ('contract','env'));
