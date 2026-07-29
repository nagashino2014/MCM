-- 111_system_admin_template.sql
-- RBAC B단계 — role(admin) 하드코딩 우회를 제거하기 위한 **선행 안전장치**.
--
-- 배경: checkPermission/requirePermission 이 `role === 'admin'` 이면 무조건 통과시킨다.
-- 이 우회를 없애면 관리자도 템플릿 권한만 갖게 되는데, 지금 상태에서 그냥 없애면
-- 부족한 권한이 생기는 계정이 있다(실측: 이도희 8개 부족). 그래서 **전 권한 템플릿**을
-- 만들어 관리자에게 부여한 뒤에 우회를 제거한다.
--
-- 이후 "관리자로 지정" = 이 템플릿을 부여하는 것이 된다(users.role 은 UI 힌트로만 남는다).
-- ⚠ 새 권한 키를 추가하면 이 템플릿에도 넣어야 한다 — 이 파일을 다시 실행하면 자동 반영된다(멱등).
--
-- 관례: 멱등(WHERE NOT EXISTS). 관례상 text 타임스탬프.

-- 1) 메일 관리 권한 키 신설 — 별칭·메일설정 라우트가 requireAdmin 으로 막혀 있어
--    권한 키로 교체하려면 키가 필요하다.
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
SELECT 'mail.manage', 'mail', 'manage', '메일 별칭·배포리스트·서버 설정 관리', 'all', 0,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = 'mail.manage');

-- 2) 시스템 관리자 템플릿
INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_at, updated_at)
SELECT 'tpl-system-admin', '시스템 관리자',
       '전 권한 보유. role 우회 제거 후 관리자 권한의 근거가 되는 템플릿.',
       1, 1,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE NOT EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin');

-- 3) 등록된 모든 권한을 scope=all 로 부여(재실행하면 새로 추가된 키도 채워진다)
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(p.permission_key), 1, 16),
       'tpl-system-admin', p.permission_key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM permissions p
 WHERE NOT EXISTS (
   SELECT 1 FROM permission_template_grants g
    WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = p.permission_key
 );

-- 4) 현재 role=admin 인 활성 계정에 부여
INSERT INTO user_permission_assignments
  (assignment_id, user_id, template_id, effective_from, assigned_by, assigned_at)
-- assigned_by 는 users FK 라 마이그레이션 식별자를 넣을 수 없다 → NULL(시스템 부여).
SELECT 'assign-sysadm-' || substr(md5(u.user_id), 1, 16),
       u.user_id, 'tpl-system-admin',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       NULL,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM users u
 WHERE u.role = 'admin' AND u.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM user_permission_assignments a
      WHERE a.user_id = u.user_id AND a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL
   );

-- 5) 메일 관리 권한은 시스템 관리자에게만(위 3에서 이미 포함되지만, 신설 키가
--    3보다 늦게 들어오는 순서 문제를 피하려 한 번 더 보정한다)
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('mail.manage'), 1, 16),
       'tpl-system-admin', 'mail.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permissions WHERE permission_key = 'mail.manage')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'mail.manage'
   );
