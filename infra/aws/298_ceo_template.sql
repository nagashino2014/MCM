-- 298: 대표이사 권한 템플릿(tpl-ceo) 신설 + 결재 전 문서 열람·인사 민감정보 열람 키 분리
--   (docs/ceo-role-design-2026-10-19.md, 2026-10-19 사용자 확정 §3.3 C-1~C-7 제안값).
--
-- 배경: 오너(대표이사)와 피고용 임원이 같은 tpl-exec(전사 조회 + 검토·지시)를 공유했다. 대표이사는
--   관리자 설정 메뉴만 막고 대부분의 업무 메뉴를 열람·조작하되, 삭제·병합·영구삭제·급여/성과급 확정·
--   외부 전송·과금은 실무자가 실행하고 대표는 결재로 승인한다.
-- 규칙(마이그 110·120 사고의 교훈): 새 권한키 = 카탈로그 시드 + tpl-system-admin grant 보충 + 업무 템플릿 배분을
--   한 파일에서 끝낸다. 멱등(ON CONFLICT·WHERE NOT EXISTS). 관례상 text 타임스탬프.
--
-- 새 키
--   approval.read_all      전자결재 — 전 문서 열람(운영 권한 approval.manage 와 분리, C-1)
--   staffing.sensitive.view 인사 — 계좌·인사 서류·승진/전보/퇴사 이력 열람(staffing.view 전사 범위와 분리, C-4·E-1)
--     → 관리자·인사담당(tpl-hr)만. 임원(tpl-exec)·대표이사(tpl-ceo)는 미부여(제안값).

-- ── 1) 권한 카탈로그 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('approval.read_all',       'approval', 'read_all',       '전자결재 — 전 문서 열람(결재 운영 권한과 분리)',            'all', 0, now()::text),
  ('staffing.sensitive.view', 'staffing', 'sensitive_view', '인사 — 직원 계좌·인사 서류·승진/전보/퇴사 이력 열람',       'all', 1, now()::text),
  ('sales.staff.manage',      'sales',    'staff_manage',   '영업 — 영업 담당자 지정·해제(영업/마케팅 메뉴 개방)',       'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- ── 2) 시스템 관리자·인사담당 보충(누락 시 관리자조차 403) ──
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || t.prefix || '-' || substr(md5(t.permission_key), 1, 16),
       t.template_id, t.permission_key, 'all', 'allow', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          ('sysadm', 'tpl-system-admin', 'approval.read_all'),
          ('sysadm', 'tpl-system-admin', 'staffing.sensitive.view'),
          ('sysadm', 'tpl-system-admin', 'sales.staff.manage'),
          ('hr',     'tpl-hr',           'staffing.sensitive.view')
       ) AS t(prefix, template_id, permission_key)
  JOIN permission_templates pt ON pt.template_id = t.template_id
  JOIN permissions p ON p.permission_key = t.permission_key
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = t.template_id AND g.permission_key = t.permission_key);

-- ── 3) 대표이사 템플릿 ──
INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_by, created_at, updated_at)
SELECT 'tpl-ceo', '대표이사',
       '전사 업무 메뉴를 열람·조작합니다(계약·영업·사업장·업무계획·성과급 산정·급여 편집·사규·설문·대외 신고·휴지통 복원 포함). 관리자 설정·삭제·병합·급여/성과급 확정·외부 전송·과금은 제외합니다.',
       1, 1, NULL, now()::text, now()::text
 WHERE NOT EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-ceo');

-- 임원(tpl-exec) 20키 + 조작 키(설계서 §3.1). 전부 scope=all.
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-ceo-' || substr(md5(k.key), 1, 16), 'tpl-ceo', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          -- 임원과 동일
          ('approval.view'), ('approval.act'), ('board.view'), ('board.write'),
          ('contract.view'), ('billing.view'), ('sales.view'), ('contact.view'), ('facility.view'),
          ('work_plan.view'), ('work_plan.directive'), ('work_plan.lock_release'),
          ('bonus.view'), ('staffing.view'), ('staffing.evaluation.read'), ('staffing.record.view'),
          ('payroll.view'), ('finance.view'), ('calendar.meeting.manage'), ('todo.admin'),
          -- 계약·수금
          ('contract.edit'), ('billing.edit'), ('billing.export'), ('certificate.issue'),
          -- 영업·사업장
          ('sales.edit'), ('contact.edit'), ('contact.export'), ('facility.edit'),
          -- 업무추진계획
          ('work_plan.edit'), ('work_plan.merge'), ('work_plan.edit.locked'),
          -- 성과급·인사
          ('staffing.evaluation.write'), ('bonus.calculate'), ('staffing.changes.record'),
          -- 급여
          ('payroll.edit'), ('payroll.export'),
          -- 전자결재·게시판 (C-1: 전 문서 열람은 read_all, 운영 설정 approval.manage 는 미부여)
          ('approval.read_all'), ('board.manage'),
          -- 일정·설문·사규·자산
          ('calendar.interview.manage'), ('survey.view'), ('survey.manage'), ('rules.view'), ('rules.manage'), ('asset.manage'),
          -- 대외 신고
          ('filing.view'), ('filing.manage'),
          -- 데이터·휴지통(복원만)
          ('data.view'), ('data.review'), ('trash.view'), ('trash.restore'),
          -- 조회·분석 (C-5: 접속기록·AI 사용량은 관리 메뉴 노출이라 미부여, 감사 로그는 부여)
          ('org.view'), ('reports.nlq'), ('audit.read'),
          -- 영업 담당자 지정(영업 메뉴 개방, 2026-10-19 추가 지시)
          ('sales.staff.manage')
       ) AS k(key)
  JOIN permissions p ON p.permission_key = k.key
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = 'tpl-ceo' AND g.permission_key = k.key);

-- ── 4) 직급 기본 템플릿: 대표이사(ceo) → tpl-ceo (026 의 tpl-exec 매핑을 대체) ──
UPDATE position_default_templates SET template_id = 'tpl-ceo'
 WHERE position_id = 'ceo' AND template_id = 'tpl-exec';

-- ── 5) 현재 대표이사 재직자: tpl-exec 회수 + tpl-ceo 부여(멱등, 044·발급 규칙과 같은 auto- assignment_id) ──
UPDATE user_permission_assignments a
   SET revoked_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       revoked_by = NULL
  FROM users u JOIN employee_profiles ep ON ep.user_id = u.user_id
 WHERE a.user_id = u.user_id AND a.template_id = 'tpl-exec' AND a.revoked_at IS NULL
   AND ep.position_id = 'ceo' AND ep.status = 'active';

INSERT INTO user_permission_assignments
  (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
   effective_from, reason, assigned_by, assigned_at)
SELECT 'auto-' || u.user_id || '-tpl-ceo', u.user_id, 'tpl-ceo', NULL, NULL,
       to_char(now(), 'YYYY-MM-DD'), '대표이사 템플릿 전환(298)', NULL,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM users u JOIN employee_profiles ep ON ep.user_id = u.user_id
 WHERE ep.position_id = 'ceo' AND ep.status = 'active' AND u.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM user_permission_assignments x
                    WHERE x.user_id = u.user_id AND x.template_id = 'tpl-ceo' AND x.revoked_at IS NULL)
ON CONFLICT (assignment_id) DO NOTHING;

-- ── 6) 민감 현황·재무·급여 열람을 관리자·인사/회계·대표이사로 한정(2026-10-19 사용자 지시) ──
--   계약 Dashboard·수주/수금/발행 현황(billing.view)·재무(finance.view)·급여대장(payroll.view)은
--   tpl-system-admin·tpl-hr·tpl-ceo 만 보유한다. 291 에서 임원(tpl-exec)·검수용(tpl-view-all)에 준 payroll/finance 조회와
--   043·026 의 사원(participant)·부서장(self_dept)·임원(all) billing.view 를 회수한다.
--   영업관리(tpl-sales)도 회수한다(지시: 관리자·인사/회계·대표이사만). 현재 보유자 3명은 모두 tpl-system-admin 도 보유해 실제 변화 없음.
--   tpl-sales 의 billing.edit·billing.receivable.manage(입력·발행 요청 처리)는 유지 — 영업 전담자를 새로 두면 현황 열람은 별도 부여.
--   tpl-view-all 은 보유자 0명이며 213 재실행 시 view 키가 복원되므로 "부여 금지" 운영 메모로 관리한다.
DELETE FROM permission_template_grants
 WHERE (template_id IN ('tpl-exec', 'tpl-view-all') AND permission_key IN ('payroll.view', 'finance.view'))
    OR (template_id IN ('tpl-staff-basic', 'tpl-dept-lead', 'tpl-exec', 'tpl-sales', 'tpl-view-all') AND permission_key IN ('billing.view', 'billing.export'));

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-hr-' || substr(md5(k.key), 1, 16), 'tpl-hr', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('billing.view'), ('finance.view')) AS k(key)
  JOIN permissions p ON p.permission_key = k.key
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = 'tpl-hr' AND g.permission_key = k.key);

-- ── 7) 영업/마케팅 메뉴 = 조직도로 지정한 영업 담당자 + 대표이사 + 관리자(2026-10-19 사용자 지시) ──
--   "영업 담당자"는 템플릿이 아니라 Salesboard "영업 제설정 > 영업 담당자 설정"에서 조직도로 지정한 인원(sales_assignees, 150).
--   지정·해제 시 앱(lib/sales/staff-access.ts)이 tpl-sales-staff 를 부여·회수한다. 여기서는 템플릿과 현재 지정자 백필만 한다.
--   사원(participant)·부서장(self_dept)·임원(all)·검수용의 sales.view 를 회수한다. 영업건 관계자로 등록된 다른 부서 직원도
--   지정되지 않으면 메뉴·영업 API 가 막힌다(관계자 기록은 유지). 영업관리(tpl-sales, 보유자 3명=전원 시스템 관리자)는 그대로.
--   담당자 정보(contact.view)는 주소록·모바일 담당자 화면이 같은 API 를 써서 전 직원 유지 — API 가드는 contact.view 로 옮겼다.
DELETE FROM permission_template_grants
 WHERE template_id IN ('tpl-staff-basic', 'tpl-dept-lead', 'tpl-exec', 'tpl-view-all') AND permission_key = 'sales.view';

INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_by, created_at, updated_at)
SELECT 'tpl-sales-staff', '영업 담당',
       '영업 제설정에서 지정된 영업 담당자. 영업/마케팅 전 화면 열람과 영업건·활동·담당자 등록·수정. 지정·해제 시 자동 부여·회수됩니다.',
       1, 1, NULL, now()::text, now()::text
 WHERE NOT EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-sales-staff');

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-salesstaff-' || substr(md5(k.key), 1, 16), 'tpl-sales-staff', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('sales.view'), ('sales.edit'), ('contact.view'), ('contact.edit')) AS k(key)
  JOIN permissions p ON p.permission_key = k.key
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = 'tpl-sales-staff' AND g.permission_key = k.key);

-- 현재 지정된 영업 담당자(계정 있는 활성 직원) 백필 — 앱의 syncSalesStaffGrants 와 같은 assignment_id 규칙.
INSERT INTO user_permission_assignments
  (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
   effective_from, reason, assigned_by, assigned_at)
SELECT DISTINCT ON (u.user_id) 'sales-staff-' || u.user_id, u.user_id, 'tpl-sales-staff', NULL, NULL,
       to_char(now(), 'YYYY-MM-DD'), '영업 담당자 지정(298 백필)', NULL,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM sales_assignees sa
  JOIN employee_profiles ep ON ep.employee_id = sa.employee_id AND ep.status = 'active'
  JOIN users u ON (u.employee_id = ep.employee_id OR u.user_id = ep.user_id) AND u.status = 'active'
ON CONFLICT (assignment_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL
 WHERE user_permission_assignments.revoked_at IS NOT NULL;

-- ── 8) 점검(읽기 전용) ──
-- 고아 키 0:  SELECT p.permission_key FROM permissions p WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.permission_key = p.permission_key);
-- 관리자 누락 0: SELECT p.permission_key FROM permissions p WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id='tpl-system-admin' AND g.permission_key=p.permission_key);
-- 대표이사 전환: SELECT u.name, a.template_id, a.revoked_at FROM user_permission_assignments a JOIN users u ON u.user_id=a.user_id JOIN employee_profiles ep ON ep.user_id=u.user_id WHERE ep.position_id='ceo';
-- tpl-ceo grant 수(54): SELECT count(*) FROM permission_template_grants WHERE template_id='tpl-ceo';
-- 영업 메뉴 보유자: SELECT g.template_id, count(DISTINCT a.user_id) FROM permission_template_grants g JOIN user_permission_assignments a ON a.template_id=g.template_id AND a.revoked_at IS NULL WHERE g.permission_key='sales.view' GROUP BY 1;
