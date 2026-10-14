-- 274: To-do · Kanban(개인 할 일·보드·공유·댓글·활동·알림 설정) — docs/todo-kanban-blueprint.md §6·§14 (2026-10-13).
--   전자결재(출장·휴가·초과근무) 밖의 개인 업무 스케줄·미팅 약속을 기록하고, 필요하면 작업 단위로 공유한다.
--   - todo_boards / todo_columns : 개인 기본 보드(첫 접근 시 자동 생성)·프로젝트·부서·공유 보드와 열(열↔상태 매핑 선택)
--                                  프로젝트 보드 = 용역(§19-11): project_name·client_name·contract_id·facility_id·color(파스텔 키)
--   - todo_items                 : 할 일. do_date(언제 할지)·due_date(언제까지) 2중 날짜, 반복 프리셋, 하위 작업(parent 1단)
--   - todo_board_members / todo_item_shares : 보드 멤버 3단·작업 공유(담당·협업·참조)
--   - todo_comments / todo_activity : 댓글(@멘션)·활동 로그(diff)
--   - todo_user_prefs            : 알림 기본 시각·아침 요약·퀵애드 파싱·주 시작 등
--   순서는 fractional index 문자열(position text COLLATE "C") — 바이트 순 비교가 보장돼야 한다.
--   관리자(todo.admin)는 보드·멤버 관리만 — 개인 보드 작업 본문은 가시성 함수(lib/todo/visibility.ts)가 막는다.
--   work_tasks(업무추진계획)와 무관 — 이름 충돌 회피로 todo_* 접두.
--   GRANT 없음(265 default privileges). 멱등.

-- ── 보드 ──
CREATE TABLE IF NOT EXISTS todo_boards (
  board_id          text PRIMARY KEY,
  name              text NOT NULL,
  kind              text NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'project', 'dept', 'shared')),
  owner_user_id     text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  scope_ref         text,                       -- dept: dept_id. (project 는 아래 contract_id 를 쓴다 — scope_ref 는 유지만 하고 사용하지 않음)
  is_default        integer NOT NULL DEFAULT 0, -- 개인 기본 보드 1(사용자당 1개)
  layout            text NOT NULL DEFAULT 'board' CHECK (layout IN ('list', 'board')),
  column_status_map integer NOT NULL DEFAULT 1, -- 열↔상태 매핑 사용 여부
  -- ── 프로젝트(용역) 보드 속성(§19-11, 2026-10-13) — kind=project 면 project_name 필수(앱 검증) ──
  project_name      text,                       -- 용역/프로젝트명. 할 일·결재 일정의 맥락 줄에 출력
  client_name       text,                       -- 발주처명(자체 수행 프로젝트면 NULL)
  contract_id       text REFERENCES contracts(contract_id) ON DELETE SET NULL,   -- 계약관리 용역 선택 시(§19-12 결재 연계 키)
  facility_id       text REFERENCES facilities(facility_id) ON DELETE SET NULL,  -- 대상 사업장(선택)
  color             text,                       -- 파스텔 색 키(lib/todo/types.ts TODO_BOARD_COLORS). NULL = 종류 기본색
  archived_at       text,
  created_at        text NOT NULL,
  created_by        text,
  updated_at        text NOT NULL,
  updated_by        text
);
CREATE INDEX IF NOT EXISTS idx_todo_boards_owner ON todo_boards(owner_user_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_todo_boards_contract ON todo_boards(contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_boards_default_per_user
  ON todo_boards(owner_user_id) WHERE is_default = 1;

-- ── 열 ──
CREATE TABLE IF NOT EXISTS todo_columns (
  column_id   text PRIMARY KEY,
  board_id    text NOT NULL REFERENCES todo_boards(board_id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    text COLLATE "C" NOT NULL DEFAULT 'a0', -- fractional index(lib/todo/position.ts, 정수부+소수부)
  status_map  text CHECK (status_map IS NULL OR status_map IN ('todo', 'doing', 'review', 'done', 'hold')),
  wip_limit   integer CHECK (wip_limit IS NULL OR wip_limit > 0),
  collapsed   integer NOT NULL DEFAULT 0,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_columns_board ON todo_columns(board_id, position);

-- ── 할 일 ──
CREATE TABLE IF NOT EXISTS todo_items (
  item_id              text PRIMARY KEY,
  board_id             text NOT NULL REFERENCES todo_boards(board_id) ON DELETE CASCADE,
  column_id            text REFERENCES todo_columns(column_id) ON DELETE SET NULL,
  parent_item_id       text REFERENCES todo_items(item_id) ON DELETE CASCADE, -- 하위 작업(1단계만)
  title                text NOT NULL,
  note                 text,
  status               text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'review', 'done', 'hold')),
  priority             integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  do_date              text,                        -- YYYY-MM-DD 언제 할지
  do_time              text,                        -- HH:mm
  duration_min         integer CHECK (duration_min IS NULL OR duration_min > 0),
  due_date             text,                        -- YYYY-MM-DD 언제까지
  all_day              integer NOT NULL DEFAULT 1,
  remind_at            text,                        -- ISO, 서버 tick 발송
  remind_sent_at       text,
  snoozed_until        text,
  recurrence           text,                        -- daily|weekdays|weekly:MO,WE|monthly:15|monthly:last|yearly:MM-DD|after:N
  recurrence_parent_id text,
  position             text COLLATE "C" NOT NULL DEFAULT 'a0',
  link_kind            text CHECK (link_kind IS NULL OR link_kind IN ('contract', 'facility', 'sales_project', 'approval_doc', 'work_task', 'directive', 'url')),
  link_id              text,
  link_label           text,
  color                text,
  owner_user_id        text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assignee_user_id     text REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at         text,
  completed_by         text,
  archived_at          text,
  created_at           text NOT NULL,
  created_by           text,
  updated_at           text NOT NULL,
  updated_by           text
);
CREATE INDEX IF NOT EXISTS idx_todo_items_assignee ON todo_items(assignee_user_id, status, do_date);
CREATE INDEX IF NOT EXISTS idx_todo_items_owner ON todo_items(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_todo_items_board_col ON todo_items(board_id, column_id, position);
CREATE INDEX IF NOT EXISTS idx_todo_items_remind ON todo_items(remind_at) WHERE remind_sent_at IS NULL AND status <> 'done';
CREATE INDEX IF NOT EXISTS idx_todo_items_due ON todo_items(due_date);
CREATE INDEX IF NOT EXISTS idx_todo_items_parent ON todo_items(parent_item_id);

-- ── 보드 멤버 ──
CREATE TABLE IF NOT EXISTS todo_board_members (
  board_id   text NOT NULL REFERENCES todo_boards(board_id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  added_by   text,
  created_at text NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_todo_board_members_user ON todo_board_members(user_id);

-- ── 작업 공유(개인 보드 작업을 특정인에게) ──
CREATE TABLE IF NOT EXISTS todo_item_shares (
  item_id    text NOT NULL REFERENCES todo_items(item_id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'watcher' CHECK (role IN ('assignee', 'collaborator', 'watcher')),
  added_by   text,
  created_at text NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_todo_item_shares_user ON todo_item_shares(user_id);

-- ── 댓글 ──
CREATE TABLE IF NOT EXISTS todo_comments (
  comment_id text PRIMARY KEY,
  item_id    text NOT NULL REFERENCES todo_items(item_id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body       text NOT NULL,
  mentions   jsonb NOT NULL DEFAULT '[]'::jsonb, -- user_id 배열
  created_at text NOT NULL,
  deleted_at text
);
CREATE INDEX IF NOT EXISTS idx_todo_comments_item ON todo_comments(item_id, created_at);

-- ── 활동 로그 ──
CREATE TABLE IF NOT EXISTS todo_activity (
  activity_id text PRIMARY KEY,
  item_id     text NOT NULL REFERENCES todo_items(item_id) ON DELETE CASCADE,
  user_id     text,
  action      text NOT NULL CHECK (action IN ('create', 'update', 'status', 'assign', 'due', 'move', 'share', 'comment', 'complete', 'reopen', 'snooze', 'archive')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_activity_item ON todo_activity(item_id, created_at);

-- ── 사용자 설정 ──
CREATE TABLE IF NOT EXISTS todo_user_prefs (
  user_id                     text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  default_remind_all_day_time text NOT NULL DEFAULT '09:00',  -- 종일 작업 알림 시각(KST)
  default_remind_before_min   integer NOT NULL DEFAULT 30,    -- 시간 작업 N분 전
  digest_time                 text DEFAULT '08:30',            -- 아침 요약(NULL=끔)
  evening_review_time         text,                            -- 저녁 리뷰(NULL=끔)
  quick_add_parse             integer NOT NULL DEFAULT 1,
  week_start                  integer NOT NULL DEFAULT 1,     -- 1=월 0=일
  card_density                text NOT NULL DEFAULT 'comfortable' CHECK (card_density IN ('comfortable', 'compact')),
  show_done_days              integer NOT NULL DEFAULT 7,
  show_approval_events        integer NOT NULL DEFAULT 1,     -- 내 할 일에 결재 일정(회색 행) 표시
  digest_sent_on              text,                            -- 마지막 아침 요약 발송일(KST YYYY-MM-DD)
  updated_at                  text NOT NULL
);

-- ── 권한키 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('todo.admin', 'todo', 'admin', '할 일 — 공유·부서·프로젝트 보드 목록·멤버 관리(개인 작업 본문은 볼 수 없음)', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자(tpl-system-admin)·임원(tpl-exec) = 전사. 부서 보드 생성은 tpl-dept-lead 템플릿 배정 여부로 별도 판정.
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || t.prefix || '-' || substr(md5('todo.admin'), 1, 16), t.template_id,
       'todo.admin', t.scope_kind, 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          ('sysadm', 'tpl-system-admin', 'all'),
          ('exec',   'tpl-exec',         'all')
       ) AS t(prefix, template_id, scope_kind)
 WHERE EXISTS (SELECT 1 FROM permission_templates pt WHERE pt.template_id = t.template_id)
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = t.template_id AND g.permission_key = 'todo.admin'
   );
