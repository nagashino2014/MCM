-- 105_facility_org_category.sql
-- 주소록 '연락처 구분'(기관 유형) — 공공기관/공기업/민간기업/금융기관/협력업체/협회·조합.
-- 담당자 개인이 아니라 소속 사업장(facilities)의 속성이다. 담당자 여러 명이 같은 사업장에
-- 속하면 구분은 사업장에 한 번만 지정하면 된다.
-- 설계: docs/groupware-ux-overhaul-blueprint.md §7(주소록). 멱등.

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS org_category text;

CREATE INDEX IF NOT EXISTS idx_facilities_org_category ON facilities(org_category);
