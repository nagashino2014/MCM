-- 050_sales_schedule_fields.sql
-- 영업 스케쥴(캘린더) 재구축: sales_activities 확장 + 다차 견적/투찰(jsonb) + 활동 담당인력(정/부/입찰).
-- 047 위에 적용. 멱등. activity_type 을 8종으로 재정의(스테이징 활동 데이터 없음 → 정리 적기).
-- 설계: memory/sales-marketing-blueprint.md, SVG(영업스케쥴1.svg) + 스샷3.

ALTER TABLE sales_activities
  ADD COLUMN IF NOT EXISTS ended_at      text,   -- 종료일시(복수일 일정. NULL이면 당일)
  ADD COLUMN IF NOT EXISTS progress_note text,   -- 경과(200자, 수정 시 노출)
  ADD COLUMN IF NOT EXISTS bid_result    text,   -- 투찰결과: won_bid|lost_bid|rebid
  ADD COLUMN IF NOT EXISTS quotes        jsonb,  -- 다차 견적 [{seq,amount,submittedAt}]
  ADD COLUMN IF NOT EXISTS bids          jsonb,  -- 다차 투찰 [{seq,amount,biddedAt}]
  ADD COLUMN IF NOT EXISTS color         text;   -- 바 색상 오버라이드(선택; 기본은 일정명 색)

-- 투찰결과 CHECK
ALTER TABLE sales_activities DROP CONSTRAINT IF EXISTS sales_activities_bid_result_check;
ALTER TABLE sales_activities ADD  CONSTRAINT sales_activities_bid_result_check
  CHECK (bid_result IS NULL OR bid_result IN ('won_bid','lost_bid','rebid'));

-- activity_type 8종 재정의(인라인 CHECK 자동제약명 교체)
ALTER TABLE sales_activities DROP CONSTRAINT IF EXISTS sales_activities_activity_type_check;
ALTER TABLE sales_activities ADD  CONSTRAINT sales_activities_activity_type_check
  CHECK (activity_type IN
    ('telemarketing','email','visit','site_briefing','quote','proposal_meeting','bid','result'));

-- 활동 담당인력(정=lead / 부=deputy / 입찰=bidding). 조직 인원(employee_profiles) 기준.
CREATE TABLE IF NOT EXISTS sales_activity_assignees (
  activity_id text NOT NULL REFERENCES sales_activities(activity_id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  role_kind   text NOT NULL CHECK (role_kind IN ('lead','deputy','bidding')),
  created_at  text NOT NULL,
  PRIMARY KEY (activity_id, employee_id, role_kind)
);

CREATE INDEX IF NOT EXISTS idx_sales_activity_assignees_activity ON sales_activity_assignees(activity_id);
CREATE INDEX IF NOT EXISTS idx_sales_activity_assignees_employee ON sales_activity_assignees(employee_id);
