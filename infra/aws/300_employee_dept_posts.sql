-- 300: 겸직(복수 부서 보직) — employee_dept_posts 신설 + 인사 이력 겸직 이벤트 + 부서장 보직 백필.
--
-- 배경(2026-10-20 사용자 요청·결정, docs/concurrent-dept-post-design-2026-10-20.md §8 D-1~D-8 제안값 확정):
--   한도경 부장이 통합환경2본부장과 화학안전본부장을 겸직한다. 직원 1명 = 부서 1개(employee_profiles.dept_id)라
--   겸직 부서의 업무추진계획·결재 부서 문서함·업무보고 알림·부서 수주·수금 현황을 볼 수 없었다.
--   - 소속은 하나(employee_profiles.dept_id = 주 소속), 보직은 여럿(이 표). self_dept 권한 범위 = 활성 보직 부서 전체(D-2).
--   - "부서장"의 진실원 = post_kind='head' 행. 주 소속 부서의 부서장도 is_primary=1 로 같은 표에 기록한다.
--   - 부서장 보직 등록 시 tpl-dept-lead 가 없으면 자동 배정(assignment_id 'post-<userId>-tpl-dept-lead', D-3) — 앱 저장 API 가 처리.
--   - 한도경의 화학안전본부 겸직은 이름으로 넣지 않고 배포 후 관리 화면에서 등록한다(등록 화면 실증 겸).
-- 새 권한 키 없음(보직 관리는 기존 조직·인사 관리 권한 사용). 멱등.

CREATE TABLE IF NOT EXISTS employee_dept_posts (
  post_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  dept_id text NOT NULL REFERENCES departments(dept_id) ON DELETE CASCADE,
  post_kind text NOT NULL CHECK (post_kind IN ('head', 'member')),   -- head = 부서장, member = 겸직 부서원
  title text,                                                         -- 표시용 직책(예: 본부장). 직급(position)은 그대로
  is_primary smallint NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)), -- 1 = 주 소속 부서의 부서장 행
  effective_from text,                                                -- YYYY-MM-DD(293 과 같은 10자리 규칙)
  effective_to text,
  revoked_at text,
  revoked_by text REFERENCES users(user_id) ON DELETE SET NULL,
  note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- 활성(미해제) 보직은 (직원, 부서)당 1개
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_dept_posts_active
  ON employee_dept_posts(employee_id, dept_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_dept_posts_dept
  ON employee_dept_posts(dept_id, post_kind) WHERE revoked_at IS NULL;

-- 인사 이력: 겸직 발령·해제 이벤트(to_dept_id = 겸직 부서). 206 의 휴직·복직(leave_start/leave_end)을 보존한다.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'employee_hr_events'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%event_type%'
       AND pg_get_constraintdef(oid) NOT LIKE '%concurrent_start%'
  LOOP
    EXECUTE format('ALTER TABLE employee_hr_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'employee_hr_events'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%concurrent_start%'
  ) THEN
    ALTER TABLE employee_hr_events ADD CONSTRAINT employee_hr_events_event_type_check
      CHECK (event_type IN ('promotion', 'transfer', 'resignation', 'leave_start', 'leave_end', 'concurrent_start', 'concurrent_end'));
  END IF;
END $$;

-- 백필: 활성 tpl-dept-lead 보유 재직자(보직 자동 배정 'post-…' 제외) → 주 소속 부서의 부서장 보직(is_primary=1)
INSERT INTO employee_dept_posts (post_id, employee_id, dept_id, post_kind, title, is_primary, effective_from, note, created_at, updated_at)
SELECT DISTINCT 'post-' || ep.employee_id || '-' || ep.dept_id, ep.employee_id, ep.dept_id, 'head', NULL, 1,
       left(to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), 10), '300 백필(tpl-dept-lead 보유)',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM employee_profiles ep
  JOIN users u ON u.employee_id = ep.employee_id
 WHERE ep.status = 'active' AND ep.dept_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM user_permission_assignments a
      WHERE a.user_id = u.user_id AND a.template_id = 'tpl-dept-lead' AND a.revoked_at IS NULL
        AND a.assignment_id NOT LIKE 'post-%'   -- 보직 자동 배정분(겸직 부서장)은 주 소속 부서장의 근거가 아니다(재실행 대비)
        AND (a.effective_to IS NULL OR a.effective_to = '' OR left(a.effective_to, 10) >= to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))
   )
   AND NOT EXISTS (
     SELECT 1 FROM employee_dept_posts p
      WHERE p.employee_id = ep.employee_id AND p.dept_id = ep.dept_id AND p.revoked_at IS NULL
   )
ON CONFLICT (post_id) DO NOTHING;

-- 점검(읽기 전용):
--   SELECT p.dept_id, ep.name, p.post_kind, p.is_primary FROM employee_dept_posts p
--     JOIN employee_profiles ep ON ep.employee_id = p.employee_id WHERE p.revoked_at IS NULL ORDER BY 1, 2;
