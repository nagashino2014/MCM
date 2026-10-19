-- 295: 할 일 주간 리포트 설정(docs/todo-kanban-blueprint.md §29-3, 보강 7, 2026-10-19 결정 M 권고안).
--   todo_user_prefs 에 주간 요약 요일(기본 1=월)·시각(기본 08:40, NULL=끔)·메일 수신(기본 1)·마지막 발송일을 추가한다.
--   발송은 remind-tick 의 dispatchTodoWeekly(lib/todo/weekly.ts) — 인앱 알림 todo.weekly + 푸시 + 사내 메일함 내부 배달(noreply@MAIL_DOMAIN).
--   선행: 274(todo_user_prefs). GRANT 없음(265 default privileges). 멱등.

ALTER TABLE todo_user_prefs ADD COLUMN IF NOT EXISTS weekly_digest_dow  integer NOT NULL DEFAULT 1;      -- 0=일 … 6=토
ALTER TABLE todo_user_prefs ADD COLUMN IF NOT EXISTS weekly_digest_time text DEFAULT '08:40';             -- KST HH:MM, NULL=끔
ALTER TABLE todo_user_prefs ADD COLUMN IF NOT EXISTS weekly_digest_mail integer NOT NULL DEFAULT 1;      -- 1=사내 메일함에도 배달
ALTER TABLE todo_user_prefs ADD COLUMN IF NOT EXISTS weekly_sent_on     text;                             -- 마지막 주간 요약 발송일(KST YYYY-MM-DD)
