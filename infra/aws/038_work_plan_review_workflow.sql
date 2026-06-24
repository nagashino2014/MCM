-- 038_work_plan_review_workflow.sql
-- 부서장 감독 리뷰 워크플로:
--  - review_status: NULL/'pending'(미검토) | 'rejected'(반려=재보고 대상) | 'confirmed'(확인=머징 대상) | 'merged'(통합 완료)
--  - reviewer_comment_kind: 'amend'(의견 첨삭) | 'supplement'(보완 요구) | 'correction'(오기 정정 요청)
-- 멱등.

ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS review_status text;
ALTER TABLE work_plan_reports ADD COLUMN IF NOT EXISTS reviewer_comment_kind text;
CREATE INDEX IF NOT EXISTS idx_wpr_review_status ON work_plan_reports(review_status);
