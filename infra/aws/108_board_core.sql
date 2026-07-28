-- 108_board_core.sql
-- 공지·게시판(G6-B) — 전사 공지 + 부서별 게시판.
--   scope='company' : 전 임직원 대상 공지
--   scope='dept'    : 소속 부서원 간 전달사항·공지(dept_id 필수)
-- 공지 기간(notice_from~notice_to)과 상단 고정 기간(pin_from~pin_to)을 따로 둔다.
-- 알림은 메일/모바일 푸시를 각각 선택(둘 다 가능). 푸시 인프라는 후속 구축.
-- 설계: docs/groupware-ux-overhaul-blueprint.md §7. 멱등.

CREATE TABLE IF NOT EXISTS board_posts (
  post_id       text PRIMARY KEY,
  scope         text NOT NULL CHECK (scope IN ('company', 'dept')),
  dept_id       text REFERENCES departments(dept_id) ON DELETE SET NULL,
  title         text NOT NULL,
  body_html     text NOT NULL DEFAULT '',
  notice_from   text,                       -- YYYY-MM-DD (게시 시작)
  notice_to     text,                       -- YYYY-MM-DD (게시 종료, 지나면 목록에서 '종료' 표기)
  pinned        integer NOT NULL DEFAULT 0, -- 상단 고정 사용 여부
  pin_from      text,                       -- 고정 시작(YYYY-MM-DD)
  pin_to        text,                       -- 고정 종료(YYYY-MM-DD)
  notify_email  integer NOT NULL DEFAULT 0,
  notify_push   integer NOT NULL DEFAULT 0,
  author_user_id text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    text NOT NULL,
  updated_at    text NOT NULL,
  deleted_at    text
);
CREATE INDEX IF NOT EXISTS idx_board_posts_scope ON board_posts(scope, dept_id);
CREATE INDEX IF NOT EXISTS idx_board_posts_created ON board_posts(created_at DESC);

-- 첨부(work_plan_issue_attachments 스키마 관례 준용 — 로컬/S3 양쪽 지원).
CREATE TABLE IF NOT EXISTS board_attachments (
  attachment_id    text PRIMARY KEY,
  post_id          text NOT NULL REFERENCES board_posts(post_id) ON DELETE CASCADE,
  file_name        text NOT NULL,
  content_type     text,
  byte_size        bigint,
  sha256           text,
  storage_provider text,
  storage_bucket   text,
  storage_key      text NOT NULL,
  public_path      text,
  created_by       text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at       text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_attachments_post ON board_attachments(post_id);

-- 읽음 표시 — 읽은 사람만 행이 생긴다(전사 공개 글이라 사전 지정이 불가).
CREATE TABLE IF NOT EXISTS board_post_reads (
  post_id text NOT NULL REFERENCES board_posts(post_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  read_at text NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_board_reads_user ON board_post_reads(user_id);

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('board.view',   'board', 'view',   '공지·게시판 조회',            'self_dept,specific_dept,all', 0, now()::text),
  ('board.write',  'board', 'write',  '부서 게시판 글 작성·수정',    'self_dept,all',               0, now()::text),
  ('board.manage', 'board', 'manage', '전사 공지 작성·타인 글 관리', 'all',                         1, now()::text)
ON CONFLICT (permission_key) DO UPDATE
  SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
      scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;
