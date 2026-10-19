-- 288: 할 일 선행·후행 의존 관계(docs/todo-kanban-blueprint.md §28-3, 보강 4, 2026-10-19 사용자 확정 E~H 권고안).
--   todo_item_deps(item_id=후행, depends_on_item_id=선행). 상위·하위 작업 모두 가능. 자기 참조·순환은 앱이 거절(DFS).
--   의미: 선행이 완료되지 않은 후행은 "대기(blocked)" 표시(상태는 바꾸지 않음). 완료 차단은 완료 조건 complete_rules.deps 로 선택.
--   선행: 274. GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS todo_item_deps (
  item_id            text NOT NULL REFERENCES todo_items(item_id) ON DELETE CASCADE,
  depends_on_item_id text NOT NULL REFERENCES todo_items(item_id) ON DELETE CASCADE,
  created_by         text,
  created_at         text NOT NULL,
  PRIMARY KEY (item_id, depends_on_item_id),
  CHECK (item_id <> depends_on_item_id)
);
CREATE INDEX IF NOT EXISTS idx_todo_item_deps_on ON todo_item_deps(depends_on_item_id);
