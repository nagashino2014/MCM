-- 048_sales_permissions.sql
-- 영업·마케팅 P1/P2 권한키: sales.* (영업 프로젝트·활동) + contact.* (사업장 담당자/명함).
-- 043(rbac 전체 카탈로그·tpl-sales 등) 위에 적용. 멱등. 데이터만 추가/갱신(앱 동작은 가드 교체 시점에).
-- 설계: memory/sales-marketing-blueprint.md 연락처 통합 결정.
--   - sales.* : participant scope 는 sales_project_members 기준(rbac.ts 확장과 짝). 043 에서 CHECK 에 participant 허용됨.
--   - contact.* : 연락처/담당자 모달과 영업 담당자 패널이 공용. export 만 위험(개인정보 출력 통제).

-- 1) 권한 카탈로그
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('sales.view',     'sales',  'view',   '영업 프로젝트·활동 조회',      'participant,self_dept,specific_dept,all', 0, now()::text),
  ('sales.edit',     'sales',  'edit',   '영업 프로젝트·활동 등록·수정', 'participant,self_dept,all',               0, now()::text),
  ('sales.delete',   'sales',  'delete', '영업 프로젝트·활동 삭제',      'self_dept,all',                           1, now()::text),
  ('contact.view',   'contact','view',   '사업장 담당자(연락처) 조회',   'all',                                     0, now()::text),
  ('contact.edit',   'contact','edit',   '사업장 담당자(명함) 등록·수정','all',                                     0, now()::text),
  ('contact.export', 'contact','export', '사업장 담당자(명함) 목록 출력','self_dept,all',                           1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 2) grants — 시스템 템플릿 보강.
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect, conditions_json, created_at)
VALUES
  -- 영업관리(tpl-sales): 전사 범위
  ('grant-sales-sales-view',    'tpl-sales','sales.view',     'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-sales-edit',    'tpl-sales','sales.edit',     'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-sales-delete',  'tpl-sales','sales.delete',   'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-contact-view',  'tpl-sales','contact.view',   'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-contact-edit',  'tpl-sales','contact.edit',   'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-contact-export','tpl-sales','contact.export', 'all', NULL,'allow',NULL,now()::text),
  -- 임원(tpl-exec): 영업 전사 열람
  ('grant-exec-sales-view',     'tpl-exec','sales.view',      'all', NULL,'allow',NULL,now()::text),
  ('grant-exec-contact-view',   'tpl-exec','contact.view',    'all', NULL,'allow',NULL,now()::text),
  -- 부서장(tpl-dept-lead): 소속 부서 영업 조회 + 연락처 열람
  ('grant-lead-sales-view',     'tpl-dept-lead','sales.view', 'self_dept', NULL,'allow',NULL,now()::text),
  ('grant-lead-contact-view',   'tpl-dept-lead','contact.view','all', NULL,'allow',NULL,now()::text),
  -- 팀원(tpl-staff-basic): 본인 참여 영업건만(participant) + 연락처 열람
  ('grant-staff-sales-view',    'tpl-staff-basic','sales.view','participant', NULL,'allow',NULL,now()::text),
  ('grant-staff-contact-view',  'tpl-staff-basic','contact.view','all', NULL,'allow',NULL,now()::text)
ON CONFLICT (grant_id) DO UPDATE SET
  template_id = EXCLUDED.template_id, permission_key = EXCLUDED.permission_key,
  scope_kind = EXCLUDED.scope_kind, scope_dept_id = EXCLUDED.scope_dept_id,
  effect = EXCLUDED.effect, conditions_json = EXCLUDED.conditions_json;
