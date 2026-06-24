-- 업무보고(업무추진계획)·수행인력·성과급 연계의 기반 시드. (PR-0 선결)
-- 012~014(조직/RBAC/HR) 위에 적용한다.
-- 전자결재·미계약비용(prospect)·성과급 본체 스키마는 보류이며,
-- 여기서는 (1) 계약 담당 본부 컬럼과 (2) 곧 사용할 권한 카탈로그/템플릿/직급매핑만 선시드한다.

-- 1) 계약 담당 본부(= '수행 부서') — 수동 지정 컬럼.
--    성과급 본부 귀속·실적증명·수행인력 화면의 기준이 된다. 자동 추정은 두지 않는다.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS owning_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_owning_dept ON contracts(owning_dept_id);

-- 2) 신규 권한 카탈로그 — 업무추진계획 / 수행인력 변동·평가 / 성과급 조회.
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('work_plan.view',            'work_plan', 'view',            '업무추진계획 조회',                 'self,self_dept,specific_dept,all', 0, now()::text),
  ('work_plan.edit',            'work_plan', 'edit',            '업무추진계획 작성·수정',            'self,self_dept',                   0, now()::text),
  ('work_plan.edit.locked',     'work_plan', 'edit.locked',     '잠금된 업무추진계획 수정(사유 강제)', 'self_dept,all',                    1, now()::text),
  ('work_plan.merge',           'work_plan', 'merge',           '부서장 1차보고 머지',               'self_dept',                        0, now()::text),
  ('work_plan.lock_release',    'work_plan', 'lock_release',    '업무추진계획 잠금 해제',            'all',                              1, now()::text),
  ('staffing.changes.record',   'staffing',  'changes.record',  '수행인력 변동 기록(본부장)',         'self_dept,all',                    1, now()::text),
  ('staffing.evaluation.write', 'staffing',  'evaluation.write','반기 참여도·평점 입력(본부장)',       'self_dept',                        1, now()::text),
  ('staffing.evaluation.read',  'staffing',  'evaluation.read', '반기 평점 열람',                    'self_dept,all',                    0, now()::text),
  ('bonus.view',                'bonus',     'view',            '성과급 산정 내역 열람',              'self_dept,all',                    0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported,
  is_dangerous = EXCLUDED.is_dangerous;

-- 3) 임원 템플릿 신규 + 부서장/일반직원 템플릿 보강.
INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_by, created_at, updated_at)
VALUES
  ('tpl-exec', '임원', '전사 업무추진계획·평점·성과급 내역을 열람합니다.', 1, 1, NULL, now()::text, now()::text)
ON CONFLICT (template_id) DO UPDATE SET
  template_name = EXCLUDED.template_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  is_active = EXCLUDED.is_active,
  updated_at = now()::text;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect, conditions_json, created_at)
VALUES
  -- 임원: 전사 열람
  ('grant-exec-wp-view',        'tpl-exec',       'work_plan.view',            'all',       NULL, 'allow', NULL, now()::text),
  ('grant-exec-eval-read',      'tpl-exec',       'staffing.evaluation.read',  'all',       NULL, 'allow', NULL, now()::text),
  ('grant-exec-bonus-view',     'tpl-exec',       'bonus.view',                'all',       NULL, 'allow', NULL, now()::text),
  ('grant-exec-staffing-view',  'tpl-exec',       'staffing.view',             'all',       NULL, 'allow', NULL, now()::text),
  ('grant-exec-contract-view',  'tpl-exec',       'contract.view',             'all',       NULL, 'allow', NULL, now()::text),
  -- 부서장 보강: 업무추진계획(작성·머지·잠금수정) + 수행인력 변동·평가 + 성과급 열람 (모두 self_dept)
  ('grant-lead-wp-view',        'tpl-dept-lead',  'work_plan.view',            'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-wp-edit',        'tpl-dept-lead',  'work_plan.edit',            'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-wp-merge',       'tpl-dept-lead',  'work_plan.merge',           'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-wp-edit-locked', 'tpl-dept-lead',  'work_plan.edit.locked',     'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-staffing-chg',   'tpl-dept-lead',  'staffing.changes.record',   'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-eval-write',     'tpl-dept-lead',  'staffing.evaluation.write', 'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-eval-read',      'tpl-dept-lead',  'staffing.evaluation.read',  'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-bonus-view',     'tpl-dept-lead',  'bonus.view',                'self_dept', NULL, 'allow', NULL, now()::text),
  -- 일반 직원 보강: 부서 보고 열람 + 본인 업무추진계획 작성
  ('grant-staff-wp-view',       'tpl-staff-basic','work_plan.view',            'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-staff-wp-edit',       'tpl-staff-basic','work_plan.edit',            'self',      NULL, 'allow', NULL, now()::text)
ON CONFLICT (grant_id) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  permission_key = EXCLUDED.permission_key,
  scope_kind = EXCLUDED.scope_kind,
  scope_dept_id = EXCLUDED.scope_dept_id,
  effect = EXCLUDED.effect,
  conditions_json = EXCLUDED.conditions_json;

-- 4) 직급별 기본 템플릿(자동 부여 후보 — admin 1-click 확인용 시드).
--    scope override 는 두지 않고(NULL) 템플릿 grant 의 scope 를 그대로 따른다.
INSERT INTO position_default_templates (position_id, template_id, scope_kind_default, scope_dept_default)
VALUES
  ('ceo',                      'tpl-exec',        NULL, NULL),
  ('executive-director',       'tpl-exec',        NULL, NULL),
  ('senior-managing-director', 'tpl-exec',        NULL, NULL),
  ('general-director',         'tpl-exec',        NULL, NULL),
  ('director',                 'tpl-exec',        NULL, NULL),
  ('general-manager',          'tpl-dept-lead',   NULL, NULL),
  ('ulsan-branch-head',        'tpl-dept-lead',   NULL, NULL),
  ('lab-director',             'tpl-dept-lead',   NULL, NULL),
  ('deputy-general-manager',   'tpl-staff-basic', NULL, NULL),
  ('manager',                  'tpl-staff-basic', NULL, NULL),
  ('assistant-manager',        'tpl-staff-basic', NULL, NULL),
  ('staff',                    'tpl-staff-basic', NULL, NULL),
  ('advisor',                  'tpl-staff-basic', NULL, NULL),
  ('senior-researcher',        'tpl-staff-basic', NULL, NULL),
  ('associate-researcher',     'tpl-staff-basic', NULL, NULL)
ON CONFLICT (position_id, template_id) DO UPDATE SET
  scope_kind_default = EXCLUDED.scope_kind_default,
  scope_dept_default = EXCLUDED.scope_dept_default;
