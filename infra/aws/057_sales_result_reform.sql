-- 057_sales_result_reform.sql
-- '결과 발표' → '영업 결과' 개편: 영업 결과 5종(낙찰/탈락/재투찰/사업장 거절/사업 추진 중단).
-- 050의 bid_result CHECK 확장. 멱등.
-- 아울러 과거이력 탭용 용역 분류 컬럼을 sales_projects 에 추가.

ALTER TABLE sales_activities DROP CONSTRAINT IF EXISTS sales_activities_bid_result_check;
ALTER TABLE sales_activities ADD  CONSTRAINT sales_activities_bid_result_check
  CHECK (bid_result IS NULL OR bid_result IN
    ('won_bid','lost_bid','rebid','facility_declined','project_halted'));

-- 과거이력 탭: 용역별(대분류) / 세분류. 계약 분류와 동일 축.
ALTER TABLE sales_projects
  ADD COLUMN IF NOT EXISTS service_category    text,  -- integrated_permit|chem|esg|etc
  ADD COLUMN IF NOT EXISTS service_subcategory text;  -- first|change_permit|change_report|post_mgmt|review
