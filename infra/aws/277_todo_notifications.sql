-- 277: 할 일 인앱 알림함(docs/todo-kanban-blueprint.md §9 2차, 2026-10-14).
--   푸시(lib/todo/notify.ts sendPush)와 같은 이벤트를 수신자별 행으로 남겨 웹 탑바 알림함·모바일 알림함에서 읽는다.
--   푸시는 수신 설정·방해금지로 걸러지지만 인앱 행은 항상 남긴다(놓친 알림의 보관함). 읽음은 read_at.
--   선행: 274(todo_items). 멱등.

CREATE TABLE IF NOT EXISTS todo_notifications (
  notif_id      text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event         text NOT NULL,            -- todo.assigned | todo.comment | todo.status | todo.remind | todo.digest
  title         text NOT NULL,
  body          text,
  link          text,                     -- 웹 경로(/todo?item=<id> · /todo). 모바일은 deeplink.routeForLink 로 해석
  item_id       text REFERENCES todo_items(item_id) ON DELETE CASCADE,
  actor_user_id text,                     -- 행위자(배정·댓글·상태 변경을 한 사람). 리마인드·요약은 NULL
  read_at       text,
  created_at    text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_notifications_user_created ON todo_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_notifications_user_unread ON todo_notifications(user_id, created_at DESC) WHERE read_at IS NULL;
