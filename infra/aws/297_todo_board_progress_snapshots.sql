-- 297: 보드 진척 일일 스냅샷(docs/todo-kanban-blueprint.md §29-3 2차, 2026-10-19).
--   프로젝트·부서 보드마다 하루 1행 — 미완 상위 할 일의 하위 진행율 평균·미완/완료 상위 건수. remind-tick 이 KST 날짜별로 1회 적재(INSERT … NOT EXISTS, 멱등).
--   주간 리포트가 지난주 같은 요일 스냅샷과 비교해 "변화량 ±" 를 보여 준다. 선행: 274. GRANT 없음(265 default privileges).

CREATE TABLE IF NOT EXISTS todo_board_progress_snapshots (
  board_id      text NOT NULL REFERENCES todo_boards(board_id) ON DELETE CASCADE,
  snapshot_date text NOT NULL,            -- KST YYYY-MM-DD
  avg_pct       integer NOT NULL DEFAULT 0,
  open_n        integer NOT NULL DEFAULT 0,
  done_n        integer NOT NULL DEFAULT 0,
  created_at    text NOT NULL,
  PRIMARY KEY (board_id, snapshot_date)
);
