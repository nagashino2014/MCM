-- 044_assign_default_templates.sql
-- RBAC 완전 전환 마무리: 직급 기본 매핑(position_default_templates)으로 전 직원 계정에 권한 템플릿 자동 부여.
-- 042(계정통합)·043(권한 카탈로그) 위에 적용. 멱등(ON CONFLICT DO NOTHING).
-- 부여 자체는 동작을 바꾸지 않는다(RBAC_ENFORCE=false 동안은 grant 가 평가되지 않음). enforce 전환 전 데이터 준비.
-- 직급은 계정(users)이 아니라 조직 인원(employee_profiles)에 있으므로 user → employee_profiles → position_default_templates 로 연결한다.
-- tpl-sales(영업관리)·tpl-hr(인사/회계)는 직급 무관 수동 부여 대상이라 여기서 다루지 않는다.

INSERT INTO user_permission_assignments
  (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
   effective_from, effective_to, reason, assigned_by, assigned_at, revoked_at, revoked_by)
SELECT
  'auto-' || u.user_id || '-' || pdt.template_id AS assignment_id,
  u.user_id,
  pdt.template_id,
  pdt.scope_kind_default,
  pdt.scope_dept_default,
  now()::text,
  NULL,
  '직급 기본 권한 템플릿 자동 부여(044)',
  NULL,
  now()::text,
  NULL,
  NULL
FROM users u
JOIN employee_profiles ep ON ep.employee_id = u.employee_id
JOIN position_default_templates pdt ON pdt.position_id = ep.position_id
WHERE u.employee_id IS NOT NULL
  AND u.status = 'active'
ON CONFLICT (assignment_id) DO NOTHING;
