-- 286: 할 일 보강 1·3(docs/todo-kanban-blueprint.md §26, 2026-10-18 사용자 결정 "보강 1·2·3 도입").
--   §26-3 체크리스트 템플릿 todo_templates — 반복 업무의 표준 하위 작업 세트를 저장해 한 번에 생성한다. 항목에 공정 단계(stage_order)·
--     마감 오프셋을 둘 수 있어 업무 보고 연계(285 단계 매핑)까지 템플릿으로 자동화된다.
--     board_id NULL = 개인 템플릿(작성자만), 보드 id = 보드 템플릿(보드 멤버 공용, 편집은 보드 소유자·작성자).
--     items: jsonb 배열 [{ "title": "자료 수집", "stageOrder": 1, "dueOffsetDays": 3, "progressNote": "" }, ...]
--   §26-1 메일·메신저 → 할 일 — todo_items.link_kind CHECK 에 'mail'(메일 메시지 id)·'chat'("<roomId>:<messageId>") 을 허용한다.
--     274 의 인라인 CHECK 를 이름으로 찾아 교체(285 의 todo_activity action 과 같은 방식).
--   선행: 274(todo_boards·todo_items). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS todo_templates (
  template_id   text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  board_id      text REFERENCES todo_boards(board_id) ON DELETE CASCADE,
  name          text NOT NULL,
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  use_count     integer NOT NULL DEFAULT 0,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_templates_owner ON todo_templates(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_templates_board ON todo_templates(board_id, updated_at DESC) WHERE board_id IS NOT NULL;

-- link_kind 확장(mail·chat)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname INTO cname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'todo_items' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%link_kind%';
  IF cname IS NOT NULL AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = cname)) NOT LIKE '%''chat''%' THEN
    EXECUTE format('ALTER TABLE todo_items DROP CONSTRAINT %I', cname);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_items_link_kind_check_v2') THEN
    ALTER TABLE todo_items ADD CONSTRAINT todo_items_link_kind_check_v2
      CHECK (link_kind IS NULL OR link_kind IN ('contract', 'facility', 'sales_project', 'approval_doc', 'work_task', 'directive', 'url', 'mail', 'chat'));
  END IF;
END $$;
