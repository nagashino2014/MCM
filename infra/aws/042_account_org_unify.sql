-- 042_account_org_unify.sql
-- 계정-조직 통합 1단계(PR-A1): 조직 인원(employee_profiles) = 계정(users) 모델로 전환하기 위한 스키마.
-- 로그인 식별자(사번 login_id / 이메일 로컬파트 email_local) + 비밀번호 강제 변경 플래그 + 사번(employee_no) UNIQUE.
-- 012(users/employee_profiles) 위에 적용. 멱등.
-- 설계: docs/permission-rbac-redesign.md §7.5 / docs/account-org-unify-plan.md Step 1.

-- 1) users: 로그인 식별자 & 강제 변경 플래그.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_id text,
  ADD COLUMN IF NOT EXISTS email_local text,
  ADD COLUMN IF NOT EXISTS must_change_password integer NOT NULL DEFAULT 0;

-- 사번(login_id)·이메일 로컬파트(email_local)는 각각 전체 UNIQUE. NULL 은 충돌하지 않도록 partial unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_id
  ON users(login_id) WHERE login_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_local
  ON users(email_local) WHERE email_local IS NOT NULL;

-- 2) employee_profiles.employee_no = 사번(로그인 ID). 컬럼은 012 에서 이미 존재 → UNIQUE 인덱스만.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_employee_no
  ON employee_profiles(employee_no) WHERE employee_no IS NOT NULL;

-- 3) 기존 email 계정의 email_local 백필.
--    로컬파트(@앞)가 유일한 계정만 채운다. 충돌 그룹(같은 로컬파트 2건 이상)은 전부 NULL 로 두어 사번 전용으로 만든다(§7.5-3 확정).
UPDATE users u
   SET email_local = split_part(u.email, '@', 1),
       updated_at = now()::text
 WHERE u.email_local IS NULL
   AND u.email IS NOT NULL
   AND position('@' in u.email) > 0
   AND NOT EXISTS (
     SELECT 1 FROM users u2
      WHERE u2.user_id <> u.user_id
        AND split_part(u2.email, '@', 1) = split_part(u.email, '@', 1)
   );

-- 4) account.manage 권한키 선시드(가드 교체 전 등록). 템플릿 부여는 권한 카탈로그 단계에서.
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES ('account.manage', 'account', 'manage', '계정(사번) 발급·비밀번호 리셋', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported,
  is_dangerous = EXCLUDED.is_dangerous;
