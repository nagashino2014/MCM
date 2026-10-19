-- 289: users.role 을 admin | member 2값으로 축소 — role 일원화 WP6 (docs/rbac-role-unification-plan.md §2 WP6).
--
-- 배경(2026-10-19 사용자 확정, docs/open-test-permission-plan-2026-10-19.md §6-5):
--   권한의 근거는 권한 템플릿(permission_template_grants)뿐이다. editor/viewer 는 의미를 폐기하고
--   admin 은 부트스트랩 플래그(seed.ts 최초 관리자 생성·RBAC_ADMIN_BYPASS 비상 우회)로만 남긴다.
--   "관리자 지정"은 tpl-system-admin 템플릿 부여로 통일하며, 마지막 관리자 보호도 템플릿 보유자 기준이다.
-- 순서: CHECK 제약을 먼저 풀어야 UPDATE 가 통과한다(001 의 인라인 CHECK 는 자동명 users_role_check 이지만
--   환경마다 다를 수 있어 role 을 언급하는 CHECK 를 카탈로그에서 찾아 제거한다). 멱등.

-- 1) role 컬럼의 기존 CHECK 제약 제거
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'users'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(c.conname);
  END LOOP;
END $$;

-- 2) editor / viewer → member (updated_at 은 관례상 ISO text)
UPDATE users
   SET role = 'member',
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE role IN ('editor', 'viewer');

-- 3) 2값 CHECK 재설정
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member'));

-- 4) 점검(읽기 전용, 적용 뒤 확인용)
-- role 분포: SELECT role, status, COUNT(*) FROM users GROUP BY 1, 2 ORDER BY 1, 2;
-- lock-out 점검(활성 계정 중 유효 템플릿 0개 — 테스트 시드 외 0행이어야 함):
--   SELECT u.user_id, u.login_id, u.name FROM users u
--    WHERE u.status = 'active'
--      AND NOT EXISTS (SELECT 1 FROM user_permission_assignments a
--                       WHERE a.user_id = u.user_id AND a.revoked_at IS NULL
--                         AND (a.effective_from IS NULL OR a.effective_from <= to_char(now(), 'YYYY-MM-DD'))
--                         AND (a.effective_to IS NULL OR a.effective_to >= to_char(now(), 'YYYY-MM-DD')));
-- 시스템 관리자 보유자(1명 이상이어야 함):
--   SELECT u.login_id, u.name FROM users u
--     JOIN user_permission_assignments a ON a.user_id = u.user_id AND a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL
--    WHERE u.status = 'active';
