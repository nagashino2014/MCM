-- 043_rbac_full_catalog.sql
-- RBAC 완전 전환 B단계(B1): 권한 카탈로그 전체 + 시스템 템플릿 7종 + grants.
-- 012(권한 스키마)·026(work_plan/staffing 시드)·042(account.manage) 위에 적용. 멱등.
-- 설계: docs/permission-rbac-redesign.md §3, §3.5, §5.
-- 이 마이그레이션 자체는 데이터만 추가/갱신하며 앱 동작을 바꾸지 않는다(가드 교체는 B3).

-- 1) scope_kind 에 'participant'(본인 수행 용역) 허용 — CHECK 제약 확장. (§3.5-6)
ALTER TABLE permission_template_grants  DROP CONSTRAINT IF EXISTS permission_template_grants_scope_kind_check;
ALTER TABLE permission_template_grants  ADD  CONSTRAINT permission_template_grants_scope_kind_check
  CHECK (scope_kind IN ('self','participant','self_dept','specific_dept','all'));
ALTER TABLE user_permission_assignments DROP CONSTRAINT IF EXISTS user_permission_assignments_scope_override_kind_check;
ALTER TABLE user_permission_assignments ADD  CONSTRAINT user_permission_assignments_scope_override_kind_check
  CHECK (scope_override_kind IN ('self','participant','self_dept','specific_dept','all'));
ALTER TABLE position_default_templates  DROP CONSTRAINT IF EXISTS position_default_templates_scope_kind_default_check;
ALTER TABLE position_default_templates  ADD  CONSTRAINT position_default_templates_scope_kind_default_check
  CHECK (scope_kind_default IN ('self','participant','self_dept','specific_dept','all'));

-- 2) 권한 카탈로그 — 신규 키 + 기존 키 scope 보강(participant 추가).
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('facility.view',            'facility','view',             '사업장 조회',            'all',                                   0, now()::text),
  ('facility.edit',            'facility','edit',             '사업장 등록·수정',       'all',                                   0, now()::text),
  ('facility.merge',           'facility','merge',            '사업장 병합',            'all',                                   1, now()::text),
  ('facility.delete',          'facility','delete',           '사업장 삭제',            'all',                                   1, now()::text),
  ('contract.view',            'contract','view',             '계약 조회',              'participant,self_dept,specific_dept,all',0, now()::text),
  ('contract.edit',            'contract','edit',             '계약 등록·수정',         'participant,self_dept,specific_dept,all',0, now()::text),
  ('contract.delete',          'contract','delete',           '계약 삭제',              'self_dept,all',                         1, now()::text),
  ('billing.view',             'billing', 'view',             '수주/수금/발행 조회',    'participant,self_dept,all',             0, now()::text),
  ('billing.edit',             'billing', 'edit',             '수주·수금 입력',         'participant,self_dept,all',             0, now()::text),
  ('billing.receivable.manage','billing', 'receivable.manage','채권 조치 관리',         'self_dept,all',                         1, now()::text),
  ('billing.export',           'billing', 'export',           '청구/수금 내보내기',     'self_dept,all',                         0, now()::text),
  ('certificate.issue',        'certificate','issue',         '실적/거래 증명서 발급',  'self_dept,all',                         1, now()::text),
  ('work_plan.directive',      'work_plan','directive',       '임원 검토·지시 작성',    'all',                                   0, now()::text),
  ('data.view',                'data',    'view',             '수집 현황 조회',         'all',                                   0, now()::text),
  ('data.collect',             'data',    'collect',          '수집/파싱 실행·설정',    'all',                                   1, now()::text),
  ('trash.view',               'trash',   'view',             '휴지통 조회',            'self_dept,all',                         0, now()::text),
  ('trash.restore',            'trash',   'restore',          '휴지통 복원',            'self_dept,all',                         1, now()::text),
  ('trash.purge',              'trash',   'purge',            '영구 삭제',              'all',                                   1, now()::text),
  ('org.view',                 'org',     'view',             '조직도·직급 조회',       'all',                                   0, now()::text),
  ('org.edit',                 'org',     'edit',             '조직·직급 편집',         'all',                                   1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 3) 신규 시스템 템플릿 3종 (§5). 기존 4종(admin/exec/dept-lead/staff-basic)은 012·026.
INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_by, created_at, updated_at)
VALUES
  ('tpl-sales',       '영업관리',     '계약·수주/수금·증명서·사업장(전속)을 전사 범위로 관리합니다.', 1, 1, NULL, now()::text, now()::text),
  ('tpl-data-review', '데이터 검수',  '수집/파싱 실행과 검수, 사업장 조회를 담당합니다.',            1, 1, NULL, now()::text, now()::text),
  ('tpl-hr',          '인사/회계 담당','전사 인사정보 관리와 계정(사번) 발급을 담당합니다.',          1, 1, NULL, now()::text, now()::text)
ON CONFLICT (template_id) DO UPDATE SET
  template_name = EXCLUDED.template_name, description = EXCLUDED.description,
  is_system = EXCLUDED.is_system, is_active = EXCLUDED.is_active, updated_at = now()::text;

-- 4) grants — 신규 템플릿 + 기존 템플릿 보강(계약 가시성·사업장 등).
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect, conditions_json, created_at)
VALUES
  -- 영업관리(tpl-sales): 계약·billing·증명서·사업장 전속(all)
  ('grant-sales-contract-view',   'tpl-sales','contract.view',             'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-contract-edit',   'tpl-sales','contract.edit',             'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-contract-delete', 'tpl-sales','contract.delete',           'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-billing-view',    'tpl-sales','billing.view',              'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-billing-edit',    'tpl-sales','billing.edit',              'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-billing-recv',    'tpl-sales','billing.receivable.manage', 'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-billing-export',  'tpl-sales','billing.export',            'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-cert-issue',      'tpl-sales','certificate.issue',         'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-facility-view',   'tpl-sales','facility.view',             'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-facility-edit',   'tpl-sales','facility.edit',             'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-facility-merge',  'tpl-sales','facility.merge',            'all', NULL,'allow',NULL,now()::text),
  ('grant-sales-facility-delete', 'tpl-sales','facility.delete',           'all', NULL,'allow',NULL,now()::text),
  -- 데이터 검수(tpl-data-review)
  ('grant-data-view',             'tpl-data-review','data.view',           'all', NULL,'allow',NULL,now()::text),
  ('grant-data-review',           'tpl-data-review','data.review',         'all', NULL,'allow',NULL,now()::text),
  ('grant-data-collect',          'tpl-data-review','data.collect',        'all', NULL,'allow',NULL,now()::text),
  ('grant-data-facility-view',    'tpl-data-review','facility.view',       'all', NULL,'allow',NULL,now()::text),
  -- 인사/회계(tpl-hr): 전사 인사 + 계정 발급(권한위임 rbac.assignment.manage 는 제외)
  ('grant-hr-staffing-view',      'tpl-hr','staffing.view',                'all', NULL,'allow',NULL,now()::text),
  ('grant-hr-staffing-edit',      'tpl-hr','staffing.edit',                'all', NULL,'allow',NULL,now()::text),
  ('grant-hr-staffing-docs',      'tpl-hr','staffing.documents.manage',    'all', NULL,'allow',NULL,now()::text),
  ('grant-hr-org-view',           'tpl-hr','org.view',                     'all', NULL,'allow',NULL,now()::text),
  ('grant-hr-account-manage',     'tpl-hr','account.manage',               'all', NULL,'allow',NULL,now()::text),
  -- 임원(tpl-exec) 보강: billing/사업장 전사 열람
  ('grant-exec-billing-view',     'tpl-exec','billing.view',               'all', NULL,'allow',NULL,now()::text),
  ('grant-exec-facility-view',    'tpl-exec','facility.view',              'all', NULL,'allow',NULL,now()::text),
  ('grant-exec-wp-directive',     'tpl-exec','work_plan.directive',        'all', NULL,'allow',NULL,now()::text),
  -- 부서장(tpl-dept-lead) 보강: 계약 수정·billing 소속부서 범위
  ('grant-lead-contract-edit',    'tpl-dept-lead','contract.edit',         'self_dept', NULL,'allow',NULL,now()::text),
  ('grant-lead-billing-view',     'tpl-dept-lead','billing.view',          'self_dept', NULL,'allow',NULL,now()::text),
  -- 팀원(tpl-staff-basic): 본인 수행 용역의 계약·billing 만(participant)
  ('grant-staff-contract-view',   'tpl-staff-basic','contract.view',       'participant', NULL,'allow',NULL,now()::text),
  ('grant-staff-billing-view',    'tpl-staff-basic','billing.view',        'participant', NULL,'allow',NULL,now()::text)
ON CONFLICT (grant_id) DO UPDATE SET
  template_id = EXCLUDED.template_id, permission_key = EXCLUDED.permission_key,
  scope_kind = EXCLUDED.scope_kind, scope_dept_id = EXCLUDED.scope_dept_id,
  effect = EXCLUDED.effect, conditions_json = EXCLUDED.conditions_json;
