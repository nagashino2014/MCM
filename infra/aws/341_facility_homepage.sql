-- 341_facility_homepage.sql
-- 사업장 홈페이지(2026-11-06 사용자 요청). 명함 파서·연락처 가져오기가 채운다.
-- 담당자가 아니라 회사(사업장)의 속성이므로 facilities 에 둔다. 멱등.

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS homepage_url text;
