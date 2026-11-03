-- 335: 전자결재 양식별 고정 결재선 — 결재선 템플릿 + 역할 담당자 + 단계 역할·지정 대결자 기록.
--
-- 배경(2026-11-03 사용자 확정, docs/approval-fixed-line-plan-2026-11-03.md):
--   기안자가 결재선을 자유 지정하면 결재자를 빠뜨리거나 순서를 뒤섞는 일이 잦다(다우오피스 때와 같음).
--   양식마다 역할 단계(부서장·임원·대표이사·관리자)를 정해 두고, 앱이 기안자 소속으로 사람을 풀어 결재선을 고정한다.
--   - 기안자 본인 자리의 단계는 빼고 다음 단계로 올린다(비면 한 칸 위 역할, 대표이사 본인은 본인 1단계).
--   - 계약서·견적서는 최종안(field_values.doc_stage='final', 값 없으면 최종안 취급)일 때만 강제한다.
--   - 관리자 양식 4종은 관리자 부재(부재 등록·승인 휴가) 시 지정 대결자에게 넘긴다 — 최종 단계 대결 금지(D-2)의 예외.
-- 사람이 바뀌면 관리 화면(결재 운영 > 고정 결재선)에서 고친다. 시드는 DO NOTHING — 운영자가 바꾼 값을 재실행해도 보존.
-- 301 과 같이 외래키는 두지 않는다. 새 권한 키 없음(approval.manage). 멱등.

-- 1) 양식별 결재선 템플릿.
--    steps: [{ "role": "dept_head"|"exec"|"ceo"|"manager", "fallbackRole"?: 역할, "proxyUserIds"?: [user_id] }]
--      fallbackRole — 기안자가 그 단계 담당자 본인일 때 대신 넣을 역할(없으면 한 칸 위 사다리 역할).
--    enforce_when: NULL = 항상 강제. { "field": 키, "equals": 값, "whenMissing": "enforce"|"skip" } = 조건부.
CREATE TABLE IF NOT EXISTS approval_line_templates (
  form_id      text PRIMARY KEY,
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  enforce_when jsonb,
  enabled      integer NOT NULL DEFAULT 1,
  updated_by   text,
  updated_at   text NOT NULL
);

-- 2) 역할 담당자. dept_id '*' = 기본값, 부서 행이 기본값을 덮어쓴다.
--    ceo·exec·manager 는 (role, dept_id) 당 1명. exec_member = 결재 담당 부서와 무관하게 '임원'으로 취급할 사람
--    (본인 기안 시 임원 단계를 빼는 기준).
CREATE TABLE IF NOT EXISTS approval_line_role_users (
  entry_id   text PRIMARY KEY,
  role       text NOT NULL CHECK (role IN ('ceo', 'exec', 'manager', 'exec_member')),
  dept_id    text NOT NULL DEFAULT '*',
  user_id    text NOT NULL,
  updated_by text,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_line_role_assign
  ON approval_line_role_users(role, dept_id) WHERE role <> 'exec_member';
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_line_role_member
  ON approval_line_role_users(user_id) WHERE role = 'exec_member';

-- 3) 단계 기록 — 고정 결재선으로 들어간 역할(표기용)과 지정 대결자(최종 단계 대결 예외 근거). 자유 결재선은 NULL.
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS line_role text;
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS line_proxy_user_ids text[];

-- 4) 역할 담당자 시드 — 계정이 연결된 재직자만(다른 환경에서 직원 id 가 없으면 0행).
INSERT INTO approval_line_role_users (entry_id, role, dept_id, user_id, updated_by, updated_at)
SELECT s.entry_id, s.role, s.dept_id, ep.user_id, 'migration-335', now()::text
  FROM (VALUES
    ('alr-ceo-default',     'ceo',         '*',                  'emp-lee-woo-eok'),
    ('alr-exec-default',    'exec',        '*',                  'emp-jeong-dong-jong'),
    ('alr-exec-cnl',        'exec',        'carbon-neutral-lab', 'emp-shin-yong-sik'),
    ('alr-manager-default', 'manager',     '*',                  'emp-lee-jae-young'),
    ('alr-member-jdj',      'exec_member', '*',                  'emp-jeong-dong-jong'),
    ('alr-member-ssk',      'exec_member', '*',                  'emp-shin-yong-sik'),
    ('alr-member-koj',      'exec_member', '*',                  'emp-kwon-oh-jong'),
    ('alr-member-kmh',      'exec_member', '*',                  'emp_fcd00e65cea469c1')
  ) AS s(entry_id, role, dept_id, employee_id)
  JOIN employee_profiles ep ON ep.employee_id = s.employee_id AND ep.status = 'active' AND ep.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5) 양식별 템플릿 시드 — 양식이 있는 환경에서만(JOIN approval_forms).
WITH proxy AS (
  SELECT COALESCE(jsonb_agg(ep.user_id), '[]'::jsonb) AS ids
    FROM employee_profiles ep
   WHERE ep.employee_id = 'emp-lee-do-hee' AND ep.status = 'active' AND ep.user_id IS NOT NULL
),
seed(form_id, steps, enforce_when) AS (
  SELECT v.form_id, v.steps, v.enforce_when
    FROM proxy,
    LATERAL (VALUES
      -- 대표이사만
      ('frm-hr-appointment',     '[{"role":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-annual-leave-pay',   '[{"role":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-bonus-payment-plan', '[{"role":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-labor-contract',     '[{"role":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-bonus-plan',         '[{"role":"ceo"}]'::jsonb, NULL::jsonb),
      -- 임원 → 대표이사
      ('frm-work-proposal',      '[{"role":"exec"},{"role":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-internal-notice',    '[{"role":"exec"},{"role":"ceo"}]'::jsonb, NULL::jsonb),
      -- 부서장 → 임원 → 대표이사 (계약서·견적서는 최종안만)
      ('frm-official-letter',    '[{"role":"dept_head"},{"role":"exec"},{"role":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-agreement',          '[{"role":"dept_head"},{"role":"exec"},{"role":"ceo"}]'::jsonb,
                                 '{"field":"doc_stage","equals":"final","whenMissing":"enforce"}'::jsonb),
      ('frm-quotation',          '[{"role":"dept_head"},{"role":"exec"},{"role":"ceo"}]'::jsonb,
                                 '{"field":"doc_stage","equals":"final","whenMissing":"enforce"}'::jsonb),
      -- 부서장 → 임원
      ('frm-education-request',  '[{"role":"dept_head"},{"role":"exec"}]'::jsonb, NULL::jsonb),
      ('frm-education-report',   '[{"role":"dept_head"},{"role":"exec"}]'::jsonb, NULL::jsonb),
      -- 부서장만
      ('frm-overtime-request',   '[{"role":"dept_head"}]'::jsonb, NULL::jsonb),
      ('frm-leave-request',      '[{"role":"dept_head"}]'::jsonb, NULL::jsonb),
      ('frm-biz-trip-request',   '[{"role":"dept_head"}]'::jsonb, NULL::jsonb),
      ('frm-biz-trip-report',    '[{"role":"dept_head"}]'::jsonb, NULL::jsonb),
      -- 관리자만(본인 기안이면 대표이사). 앞의 4종은 관리자 부재 시 지정 대결자.
      ('frm-expense-report',     jsonb_build_array(jsonb_build_object('role','manager','fallbackRole','ceo','proxyUserIds', proxy.ids)), NULL::jsonb),
      ('frm-expense-personal',   jsonb_build_array(jsonb_build_object('role','manager','fallbackRole','ceo','proxyUserIds', proxy.ids)), NULL::jsonb),
      ('frm-purchase-request',   jsonb_build_array(jsonb_build_object('role','manager','fallbackRole','ceo','proxyUserIds', proxy.ids)), NULL::jsonb),
      ('frm-certificate-request', jsonb_build_array(jsonb_build_object('role','manager','fallbackRole','ceo','proxyUserIds', proxy.ids)), NULL::jsonb),
      ('frm-absence-statement',  '[{"role":"manager","fallbackRole":"ceo"}]'::jsonb, NULL::jsonb),
      ('frm-expert-fee',         '[{"role":"manager","fallbackRole":"ceo"}]'::jsonb, NULL::jsonb)
    ) AS v(form_id, steps, enforce_when)
)
INSERT INTO approval_line_templates (form_id, steps, enforce_when, enabled, updated_by, updated_at)
SELECT seed.form_id, seed.steps, seed.enforce_when, 1, 'migration-335', now()::text
  FROM seed JOIN approval_forms f ON f.form_id = seed.form_id
ON CONFLICT (form_id) DO NOTHING;
