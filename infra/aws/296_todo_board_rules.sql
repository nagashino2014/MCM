-- 296: 할 일 보드 자동화 규칙(docs/todo-kanban-blueprint.md §29-2, 보강 6, 2026-10-19 결정 K·L 권고안).
--   todo_board_rules: 보드별 "트리거 → (조건) → 행동" 1차 범위 — 트리거 completed/status/due_before/subtasks_done,
--   행동 set_status/assign/notify(메신저 방·인앱)/apply_template. 실행 로그는 todo_activity update {rule} 로 남기고,
--   todo_rule_runs 가 (규칙, 할 일, run_key) 멱등 — 같은 이벤트·같은 마감 전 알림을 두 번 실행하지 않고 규칙이 일으킨 변경은 규칙을 다시 타지 않는다(깊이 1).
--   선행: 274(todo_boards·todo_items). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS todo_board_rules (
  rule_id     text PRIMARY KEY,
  board_id    text NOT NULL REFERENCES todo_boards(board_id) ON DELETE CASCADE,
  name        text NOT NULL,
  enabled     integer NOT NULL DEFAULT 1,
  trigger     jsonb NOT NULL,                   -- {"kind":"completed"|"status"|"due_before"|"subtasks_done","status"?:..., "days"?:n}
  condition   jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"priorityMin"?:0-3,"titlePrefix"?:"[긴급]","linkKind"?:"contract"}
  action      jsonb NOT NULL,                   -- {"kind":"set_status"|"assign"|"notify"|"apply_template", ...}
  position    integer NOT NULL DEFAULT 0,
  run_count   integer NOT NULL DEFAULT 0,
  last_run_at text,
  created_by  text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_board_rules_board ON todo_board_rules(board_id, position);

CREATE TABLE IF NOT EXISTS todo_rule_runs (
  rule_id    text NOT NULL REFERENCES todo_board_rules(rule_id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES todo_items(item_id) ON DELETE CASCADE,
  run_key    text NOT NULL,                     -- completed:<completed_at> | status:<to>:<updated_at> | due_before:<date> | subtasks_done:<date>
  created_at text NOT NULL,
  PRIMARY KEY (rule_id, item_id, run_key)
);
