-- 271: 수행인력 실적 — 인력별 수행 용역 이력·KPI·증빙 일괄 출력 화면(/staffing/records) 권한키.
-- 열람 범위(2026-10-02 사용자 확정):
--   관리자·임원 = 전 직원(scope all) / 부서장 = 소속 부서원만(scope self_dept) / 일반 직원 = 권한 없음(메뉴 미노출).
-- 신규 표 없음 — service_participants·contracts·service_evaluations·employee_hr_events 를 읽기만 한다.
-- 멱등.

-- ── 권한키 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('staffing.record.view', 'staffing', 'record.view', '수행인력 실적 — 인력별 수행 용역 이력 열람·증빙 일괄 출력', 'self_dept,specific_dept,all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자(tpl-system-admin)·임원(tpl-exec) = 전사, 부서장(tpl-dept-lead) = 소속 부서.
-- 시스템 관리자 grant 누락 시 관리자조차 403(role 우회가 없다).
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || t.prefix || '-' || substr(md5('staffing.record.view'), 1, 16), t.template_id,
       'staffing.record.view', t.scope_kind, 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          ('sysadm', 'tpl-system-admin', 'all'),
          ('exec',   'tpl-exec',         'all'),
          ('lead',   'tpl-dept-lead',    'self_dept')
       ) AS t(prefix, template_id, scope_kind)
 WHERE EXISTS (SELECT 1 FROM permission_templates pt WHERE pt.template_id = t.template_id)
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = t.template_id AND g.permission_key = 'staffing.record.view'
   );
