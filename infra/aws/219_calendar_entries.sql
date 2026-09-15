-- 219: 일정 메뉴 — 회의·면접·미팅 일정 직접 등록 + 정기 회의 규칙(주간회의·간부간담회).
-- 화면: /calendar 날짜 셀 클릭 → 등록 메뉴(출장/휴가/교육 신청 + 회의/면접/미팅 등록). 모바일 동일.
-- 모델:
--   calendar_meeting_rules — 정기 회의 규칙(n번째 요일). 월 조회 시 해당 월 occurrence 를 calendar_entries 에
--                            멱등 생성(rule_id+occurrence_key). 규칙 변경 시 미래·미수정 occurrence 는 삭제 후 재생성.
--   calendar_entries        — 회의(meeting)/면접(interview)/미팅(visit) 공용. 종류별 부가 정보는 extra jsonb.
--                            면접 extra: {candidateName, postingId, postingTitle, resume:{storageKey,fileName,contentType,size}}
--                            미팅 extra: {visitors, contractId, contractTitle, topic}
-- 권한: 회의 = 관리자·임원(tpl-system-admin·tpl-exec) / 면접 = 관리자 + 면접 관리 템플릿(이재영·이도희 시드).
-- 멱등.

-- ── 권한키 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('calendar.meeting.manage',   'calendar', 'manage', '일정 — 회의 일정 등록·편집·정기 회의 규칙 설정(관리자·임원)', 'all', 0, now()::text),
  ('calendar.interview.manage', 'calendar', 'manage', '일정 — 면접 일정 등록·편집·이력서 첨부(면접 관리자)',        'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자(111) — 두 키 모두
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(k.key), 1, 16), 'tpl-system-admin', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('calendar.meeting.manage'), ('calendar.interview.manage')) AS k(key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = k.key
   );

-- 임원(tpl-exec, 026) — 회의 관리
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-exec-cal-meeting', 'tpl-exec', 'calendar.meeting.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-exec')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-exec' AND g.permission_key = 'calendar.meeting.manage'
   );

-- 면접 관리 템플릿 — 인원 부여는 관리 화면에서도 가능(아래는 초기 지정자 시드)
INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_at, updated_at)
SELECT 'tpl-interview-manager', '면접 일정 관리',
       '일정 메뉴에서 면접 일정을 등록·편집하고 이력서를 첨부합니다. 채용 담당자용.',
       1, 1, now()::text, now()::text
 WHERE NOT EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-interview-manager');

INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-interview-mgr-manage', 'tpl-interview-manager', 'calendar.interview.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE NOT EXISTS (
   SELECT 1 FROM permission_template_grants g
    WHERE g.template_id = 'tpl-interview-manager' AND g.permission_key = 'calendar.interview.manage'
 );

-- 초기 지정자: 이재영·이도희(재직자, 계정 연결된 사람만). 이미 부여돼 있으면 건너뜀.
INSERT INTO user_permission_assignments
  (assignment_id, user_id, template_id, effective_from, reason, assigned_at)
SELECT 'upa-interview-' || substr(md5(u.user_id), 1, 16), u.user_id, 'tpl-interview-manager',
       to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), '219 면접 일정 관리 초기 지정', now()::text
  FROM employee_profiles e
  JOIN users u ON u.user_id = e.user_id
 WHERE e.name IN ('이재영', '이도희')
   AND e.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM user_permission_assignments a
      WHERE a.user_id = u.user_id AND a.template_id = 'tpl-interview-manager' AND a.revoked_at IS NULL
   );

-- ── 정기 회의 규칙 — "매월 n번째 요일" 방식(weeks: 그 달의 n번째 해당 요일, 5번째는 원칙적으로 제외) ──
CREATE TABLE IF NOT EXISTS calendar_meeting_rules (
  rule_id      text  PRIMARY KEY,
  name         text  NOT NULL,                       -- 회의명(주간회의·간부간담회)
  weekday      int   NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=일 … 6=토
  weeks        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [1,3] = 첫째·셋째 해당 요일
  start_time   text  NOT NULL DEFAULT '09:00',       -- HH:mm
  end_time     text  NOT NULL DEFAULT '10:00',
  location     text,
  attendee_ids jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 기본 참석자 employee_id[] (occurrence 생성 시 복사)
  is_active    int   NOT NULL DEFAULT 1,
  sort_order   int   NOT NULL DEFAULT 100,
  created_at   text  NOT NULL,
  updated_at   text  NOT NULL
);

INSERT INTO calendar_meeting_rules (rule_id, name, weekday, weeks, start_time, end_time, location, sort_order, created_at, updated_at)
VALUES
  ('rule-weekly-meeting',  '주간회의',   1, '[1,3]'::jsonb, '09:00', '10:00', '회의실', 10, now()::text, now()::text),
  ('rule-exec-roundtable', '간부간담회', 1, '[2,4]'::jsonb, '09:00', '10:00', '회의실', 20, now()::text, now()::text)
ON CONFLICT (rule_id) DO NOTHING;

-- ── 직접 등록 일정(회의·면접·미팅) ──
CREATE TABLE IF NOT EXISTS calendar_entries (
  entry_id       text  PRIMARY KEY,
  kind           text  NOT NULL CHECK (kind IN ('meeting', 'interview', 'visit')),
  title          text  NOT NULL,                     -- 회의명 / 면접 "면접 : 성명" / 미팅 "미팅 : 방문자"
  entry_date     text  NOT NULL,                     -- YYYY-MM-DD
  start_time     text,                               -- HH:mm
  end_time       text,
  location       text,
  attendee_ids   jsonb NOT NULL DEFAULT '[]'::jsonb, -- 회사 참석자 employee_id[]
  note           text,
  extra          jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_id        text  REFERENCES calendar_meeting_rules(rule_id) ON DELETE SET NULL,
  occurrence_key text,                               -- 'YYYY-MM:n' (규칙의 n번째 요일)
  is_modified    int   NOT NULL DEFAULT 0,           -- 정기 occurrence 를 사람이 손댔는지(규칙 재생성 보호)
  is_canceled    int   NOT NULL DEFAULT 0,           -- 정기 회의 미시행(캘린더 비표시·기록 유지)
  created_by     text,                               -- users.user_id
  created_at     text  NOT NULL,
  updated_at     text  NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_entries_rule_occ
  ON calendar_entries(rule_id, occurrence_key) WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_entries_date ON calendar_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_kind ON calendar_entries(kind, entry_date);
