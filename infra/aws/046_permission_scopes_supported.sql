-- 046_permission_scopes_supported.sql
-- 세부 권한별 '지원 적용범위(scopes_supported)'를 업무 규칙(권한 매트릭스)에 맞게 고정.
-- 권한 템플릿 생성 모달은 이 값 내에서만 적용범위를 선택할 수 있다(단일이면 고정).
-- scope 코드: participant(참여용역)/self(본인)/self_dept(소속부서)/specific_dept(선택부서)/all(전사).
-- UPDATE 라 멱등. 카탈로그(043 등)는 ON CONFLICT 로 갱신되므로 여기서 scopes_supported 만 재지정.

UPDATE permissions p SET scopes_supported = v.scopes
FROM (VALUES
  ('contract.view',              'participant,self_dept,specific_dept,all'),
  ('contract.edit',              'all'),
  ('contract.delete',            'all'),
  ('billing.view',               'participant,self_dept,all'),
  ('billing.edit',               'all'),
  ('billing.export',             'all'),
  ('billing.receivable.manage',  'all'),
  ('facility.view',              'all'),
  ('facility.edit',              'all'),
  ('facility.merge',             'all'),
  ('facility.delete',            'all'),
  ('data.view',                  'all'),
  ('data.review',                'all'),
  ('data.collect',               'all'),
  ('work_plan.directive',        'all'),
  ('work_plan.edit',             'self,self_dept'),
  ('work_plan.edit.locked',      'self_dept,all'),
  ('work_plan.lock_release',     'all'),
  ('work_plan.merge',            'self_dept'),
  ('work_plan.view',             'self,self_dept,specific_dept,all'),
  ('staffing.changes.record',    'self_dept,all'),
  ('staffing.documents.manage',  'all'),
  ('staffing.edit',              'all'),
  ('staffing.evaluation.read',   'self_dept,all'),
  ('staffing.evaluation.write',  'self_dept'),
  ('staffing.view',              'self,self_dept,all'),
  ('bonus.view',                 'self_dept,all'),
  ('certificate.issue',          'all'),
  ('org.edit',                   'all'),
  ('org.view',                   'all'),
  ('account.manage',             'all'),
  ('rbac.assignment.manage',     'all'),
  ('rbac.template.manage',       'all'),
  ('audit.read',                 'all'),
  ('trash.purge',                'all'),
  ('trash.restore',              'all'),
  ('trash.view',                 'all')
) AS v(key, scopes)
WHERE p.permission_key = v.key;
