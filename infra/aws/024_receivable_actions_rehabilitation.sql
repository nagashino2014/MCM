-- 장기 미수금 대응 조치에 회생 절차 진행(rehabilitation)·채권 포기(debt_waiver) 유형과
-- 진행 단계 컬럼 추가.

ALTER TABLE receivable_actions
  DROP CONSTRAINT IF EXISTS receivable_actions_action_type_check;

ALTER TABLE receivable_actions
  ADD CONSTRAINT receivable_actions_action_type_check
  CHECK (action_type IN ('verbal_dunning', 'content_proof', 'debt_collection', 'rehabilitation', 'debt_waiver'));

-- 회생 절차 진행 단계 (예: 회생 개시 결정, 회생계획 인가 등 — 12자 내외)
ALTER TABLE receivable_actions
  ADD COLUMN IF NOT EXISTS progress_stage text;
