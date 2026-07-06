-- 058_bujang_position_default_template.sql
-- 근본원인 보정: '부사장' 직급은 '사용 가능 직급' 관리 UI로 나중에 추가된 직급이라
--   (position_id 가 slug 가 아닌 cleanId 랜덤 hex, 예: pos-a547dac8)
--   position_default_templates 시드(026)에 누락되었다.
-- 그 결과 부사장 직급 인원은 계정 발급 시 '직급 기본 권한 템플릿 자동 부여'(044·발급로직)의
--   position_default_templates JOIN 에서 매핑을 못 찾아 권한 템플릿을 0개 부여받았고,
--   RBAC_ENFORCE 전환 시 admin 이 아닌 부사장 계정이 lock-out 될 위험이 있었다.
-- 다른 임원(대표이사/전무/상무/총괄본부장/이사)과 동일하게 tpl-exec 를 기본 매핑한다.
-- 044(전 직원 자동부여) 위에 적용. 멱등(ON CONFLICT DO NOTHING).
--
-- ※ 직급 추가 UI/API(savePosition)가 position_default_templates 매핑을 생성하지 않는 구조적 공백은
--   코드로 별도 보완한다. 이 마이그레이션은 이미 만들어진 '부사장' 직급 + 발급된 계정에 대한 데이터 보정이다.
-- ※ position_id 는 환경마다 다른 랜덤값이므로 하드코딩하지 않고 position_name = '부사장' 으로 식별한다.

-- 1) 부사장 → tpl-exec 기본 템플릿 매핑 (다른 임원과 동일 규칙)
INSERT INTO position_default_templates (position_id, template_id, scope_kind_default, scope_dept_default)
SELECT p.position_id, 'tpl-exec', NULL, NULL
  FROM positions p
 WHERE p.position_name = '부사장'
ON CONFLICT (position_id, template_id) DO NOTHING;

-- 2) 이미 발급된 부사장 계정에 tpl-exec 소급 부여
--    (044·발급로직과 동일한 assignment_id 규칙 'auto-<user_id>-<template_id>' → 완전 멱등)
INSERT INTO user_permission_assignments
  (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
   effective_from, effective_to, reason, assigned_by, assigned_at, revoked_at, revoked_by)
SELECT
  'auto-' || u.user_id || '-' || pdt.template_id,
  u.user_id,
  pdt.template_id,
  pdt.scope_kind_default,
  pdt.scope_dept_default,
  now()::text,
  NULL,
  '부사장 직급 기본 권한 템플릿 소급 부여(058)',
  NULL,
  now()::text,
  NULL,
  NULL
FROM users u
JOIN employee_profiles ep ON ep.employee_id = u.employee_id
JOIN positions p ON p.position_id = ep.position_id
JOIN position_default_templates pdt ON pdt.position_id = ep.position_id
WHERE u.employee_id IS NOT NULL
  AND u.status = 'active'
  AND p.position_name = '부사장'
ON CONFLICT (assignment_id) DO NOTHING;
