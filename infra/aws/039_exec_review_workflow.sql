-- 039_exec_review_workflow.sql
-- 임원 검토·지시 워크플로:
--  - exec_status: NULL | 'directed'(임원 지시 하달) | 're_reported'(부서장 재보고)
--  - director_response: 임원 지시에 대한 부서장 시정조치/답변
--  - re_report_count: 재보고 횟수(1회 제한)
--  - summary_text: 추진내역 AI 요약(80자) — 부서장 머징 시 생성
-- 임원 지시 내용/분류는 work_plan_directives(report_id, level='exec') 재사용.
-- 멱등.

ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS exec_status text;
ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS director_response text;
ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS re_report_count int NOT NULL DEFAULT 0;
ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS summary_text text;
CREATE INDEX IF NOT EXISTS idx_wpr_exec_status ON work_plan_reports(exec_status);
