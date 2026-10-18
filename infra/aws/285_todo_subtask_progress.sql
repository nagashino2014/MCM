-- 285: To-do 2차 개편(docs/todo-kanban-blueprint.md §25, 2026-10-18 사용자 확정).
--   §25-2 하위 작업 진척 — todo_items 에 진행율·진척 내용·공정 단계 매핑·갱신 시각.
--     progress_pct        : 0~100(NULL=미기입). 하위 작업 체크(완료)=100. 상위 작업 진행율은 하위 평균(저장하지 않고 계산).
--     progress_note       : 진척 내용(업무 보고 추진내역의 재료).
--     stage_order         : 관련 대상(계약 contract_process_stages / 업무추진계획 Task work_task_process_stages)의 공정 단계 번호.
--                           NULL=미매핑. 단계 표가 바뀌면 끊길 수 있어 FK 는 두지 않는다(보고 생성 시 현재 표와 대조).
--     progress_updated_at : 진행율·진척 내용을 마지막으로 바꾼 시각(ISO).
--   §25-1 담당 규칙 — 담당은 항상 1명(기본 작성자). 옛 행의 NULL 담당을 작성자로 보정한다(쓰기 경로는 더 이상 NULL 을 만들지 않는다).
--   §25-3 업무 보고 연계 — 활동 로그 action 에 'progress'(진척 입력)·'work_report'(보고 초안 생성)를 허용한다.
--   선행: 274(todo_*)·276. GRANT 없음(265 default privileges). 멱등.

ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS progress_pct        integer;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS progress_note       text;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS stage_order         integer;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS progress_updated_at text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_items_progress_pct_range') THEN
    ALTER TABLE todo_items ADD CONSTRAINT todo_items_progress_pct_range CHECK (progress_pct IS NULL OR (progress_pct >= 0 AND progress_pct <= 100));
  END IF;
END $$;

-- 담당 NULL → 작성자(§25-1)
UPDATE todo_items SET assignee_user_id = owner_user_id WHERE assignee_user_id IS NULL;

-- 활동 로그 action 확장 — 274 의 인라인 CHECK 를 이름으로 찾아 교체한다.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname INTO cname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'todo_activity' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%action%';
  IF cname IS NOT NULL AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = cname)) NOT LIKE '%work_report%' THEN
    EXECUTE format('ALTER TABLE todo_activity DROP CONSTRAINT %I', cname);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_activity_action_check_v2') THEN
    ALTER TABLE todo_activity ADD CONSTRAINT todo_activity_action_check_v2
      CHECK (action IN ('create', 'update', 'status', 'assign', 'due', 'move', 'share', 'comment', 'complete', 'reopen', 'snooze', 'archive', 'progress', 'work_report'));
  END IF;
END $$;
