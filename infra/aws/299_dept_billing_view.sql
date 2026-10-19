-- 299: 부서장 전용 "부서 수주·수금 현황" 열람 키(billing.dept.view) — 2026-10-19 사용자 요청.
--
-- 배경: 298 에서 계약 Dashboard·수주/수금/발행 현황(billing.view)을 관리자·인사/회계·대표이사로 한정했다.
--   부서장은 자기 부서(수행부서 = contracts.owning_dept_id)의 수주·계산서 발행·수금 현황만 한 화면에서 볼 수 있어야 한다.
--   → 별도 키 billing.dept.view 를 두고 /contracts/dept-billing 화면과 기존 현황 API 의 scope=dept 분기가 이 키로 판정한다.
-- 사용자 결정(2026-10-19): 집계 = 수행부서 계약만(부서원 참여 타 부서 계약 제외) / 화면 = 요약 4칸 + 수주·미발행·미수금·수금 4탭 /
--   조작 = 조회와 엑셀 내려받기만(수금 입력·미수 조치·발행 요청 처리는 회계 담당).
-- 배분: tpl-dept-lead = self_dept(본인 소속 부서), tpl-system-admin = all(부서 선택). 멱등.

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES ('billing.dept.view', 'billing', 'dept_view', '부서 수주·수금 현황 — 수행부서 계약의 수주·계산서 발행·수금·미수금 조회(부서장)', 'self_dept,all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || t.prefix || '-' || substr(md5('billing.dept.view'), 1, 16), t.template_id, 'billing.dept.view', t.scope_kind, 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('sysadm', 'tpl-system-admin', 'all'),
               ('lead',   'tpl-dept-lead',    'self_dept')) AS t(prefix, template_id, scope_kind)
  JOIN permission_templates pt ON pt.template_id = t.template_id
 WHERE EXISTS (SELECT 1 FROM permissions WHERE permission_key = 'billing.dept.view')
   AND NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = t.template_id AND g.permission_key = 'billing.dept.view');

-- 점검: SELECT template_id, scope_kind FROM permission_template_grants WHERE permission_key = 'billing.dept.view';
