-- 287: To-do 기간 일정 · 하위 작업 마일스톤 날짜(docs/todo-kanban-blueprint.md §27, 2026-10-19 사용자 확정 A~D 권고안).
--   §27-2 기간 일정 — todo_items.end_date(종료일, do_date 이상). do_date~end_date 가 기간. due_date(마감)는 별도.
--   §27-1 하위 작업 마일스톤 — actual_date(실제 일자)·milestone_kind(종류: pre_consult·main_consult·review_received·meeting·
--     kickoff_report·completion_report·submit·other). 예정일은 기존 do_date 를 쓴다. 상위 작업은 두 컬럼을 쓰지 않는다.
--   선행: 274·285. GRANT 없음(265 default privileges). 멱등.

ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS end_date       text;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS actual_date    text;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS milestone_kind text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_items_end_date_after_do') THEN
    ALTER TABLE todo_items ADD CONSTRAINT todo_items_end_date_after_do
      CHECK (end_date IS NULL OR do_date IS NULL OR end_date >= do_date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_items_milestone_kind_check') THEN
    ALTER TABLE todo_items ADD CONSTRAINT todo_items_milestone_kind_check
      CHECK (milestone_kind IS NULL OR milestone_kind IN ('pre_consult', 'main_consult', 'review_received', 'meeting', 'kickoff_report', 'completion_report', 'submit', 'other'));
  END IF;
END $$;

-- 기간 일정 조회(오늘 진행 중) 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_todo_items_period ON todo_items(do_date, end_date) WHERE end_date IS NOT NULL;
