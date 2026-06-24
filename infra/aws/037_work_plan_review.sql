-- 037_work_plan_review.sql
-- 부서장 감독: 보고별 '부서장 의견'(reviewer_comment) + Task 이슈 지원(work_plan_issues.task_id).
-- 멱등: IF NOT EXISTS.

-- 1) 부서장 의견 — 보고 단위.
ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS reviewer_comment text;

-- 2) Task 이슈 — work_plan_issues 를 contract_id XOR task_id 로 일반화(둘 다 nullable).
ALTER TABLE work_plan_issues ADD COLUMN IF NOT EXISTS task_id text REFERENCES work_tasks(task_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_wpi_issue_task ON work_plan_issues(task_id);
