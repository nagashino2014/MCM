-- 051_sales_activity_attendee_role.sql
-- 영업 스케쥴 활동에 '참석자'(attendee) 역할 추가. 사업장방문/현장설명회/제안발표회의 참석 인원.
-- 050(sales_activity_assignees) 위에 적용. 멱등.

ALTER TABLE sales_activity_assignees DROP CONSTRAINT IF EXISTS sales_activity_assignees_role_kind_check;
ALTER TABLE sales_activity_assignees ADD  CONSTRAINT sales_activity_assignees_role_kind_check
  CHECK (role_kind IN ('lead','deputy','bidding','attendee'));
