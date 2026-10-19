-- 288: 급여·성과급 권한키 신설 + 템플릿 배분 — role 일원화 WP1 (docs/rbac-role-unification-plan.md).
--
-- 배경: 급여(/api/payroll/**)·성과급 변경(/api/bonus/**) 라우트 33개가 deprecated `requireAdmin`(users.role=admin)
--   으로 막혀 있었다. 권한 키 자체가 카탈로그에 없어 템플릿으로 열 수 없었던 회귀(8월)를 바로잡는다.
-- 규칙(마이그 110·120 사고의 교훈): 새 권한키 = 카탈로그 시드 + tpl-system-admin grant 보충 + 업무 템플릿 배분을
--   **한 파일에서** 끝낸다. 누락 시 관리자조차 403(role 우회가 없다).
-- 배분(2026-10-19 사용자 확정, docs/open-test-permission-plan-2026-10-19.md §6):
--   tpl-system-admin 전부(all) / tpl-hr(인사·회계) payroll.* + bonus.* 전부(all) /
--   tpl-exec(임원) payroll.view·finance.view 조회만(all, bonus.view 는 026 에서 보유) /
--   tpl-view-all(검수용) payroll.view(all — 213 재실행과 같은 결과를 여기서 먼저 채운다) /
--   tpl-staff-basic·tpl-dept-lead 는 미부여(본인 명세서는 세션 라우트 /api/payroll/my-* 가 담당).
-- 라우트 ↔ 키: GET 조회 = payroll.view / 변경 = payroll.edit / 대장 확정·차수 발송·EDI 등록·연말정산 확정 = payroll.close /
--   파일·바인딩 다운로드 = payroll.export / 산정·배분·비용·초안 = bonus.calculate / 설정 = bonus.confirm / 명세서 PDF·발송 = bonus.send.
-- 멱등(ON CONFLICT·WHERE NOT EXISTS). 관례상 text 타임스탬프.

-- ── 1) 권한 카탈로그 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('payroll.view',    'payroll', 'view',      '급여 — 급여대장·명세서·근로계약·세율표·연말정산 조회',          'all', 0, now()::text),
  ('payroll.edit',    'payroll', 'edit',      '급여 — 대장 생성·항목·규칙·세액 프로필·근로계약·상여 계획 수정', 'all', 0, now()::text),
  ('payroll.close',   'payroll', 'close',     '급여 — 대장 확정·명세서 발송·차수 발송·EDI 등록·연말정산 확정',  'all', 1, now()::text),
  ('payroll.export',  'payroll', 'export',    '급여 — 명세서·근로계약서 파일·연말정산 바인딩 다운로드',          'all', 0, now()::text),
  ('bonus.calculate', 'bonus',   'calculate', '성과급 — 산정·배분·비용 입력·초안 작성',                          'all', 0, now()::text),
  ('bonus.confirm',   'bonus',   'confirm',   '성과급 — 산정 설정(요율·절대평가) 변경·확정',                    'all', 1, now()::text),
  ('bonus.send',      'bonus',   'send',      '성과급 — 지급 명세서 PDF 생성·발송',                              'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- ── 2) 템플릿 배분 — 결정적 grant_id(grant-<prefix>-<md5(key)16>), 템플릿이 없으면 조인에서 자연히 제외 ──
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || t.prefix || '-' || substr(md5(t.permission_key), 1, 16),
       t.template_id, t.permission_key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          -- 시스템 관리자: 전부
          ('sysadm',  'tpl-system-admin', 'payroll.view'),
          ('sysadm',  'tpl-system-admin', 'payroll.edit'),
          ('sysadm',  'tpl-system-admin', 'payroll.close'),
          ('sysadm',  'tpl-system-admin', 'payroll.export'),
          ('sysadm',  'tpl-system-admin', 'bonus.calculate'),
          ('sysadm',  'tpl-system-admin', 'bonus.confirm'),
          ('sysadm',  'tpl-system-admin', 'bonus.send'),
          -- 인사/회계 담당: 급여·성과급 처리 전부(§6-2)
          ('hr',      'tpl-hr',           'payroll.view'),
          ('hr',      'tpl-hr',           'payroll.edit'),
          ('hr',      'tpl-hr',           'payroll.close'),
          ('hr',      'tpl-hr',           'payroll.export'),
          ('hr',      'tpl-hr',           'bonus.view'),
          ('hr',      'tpl-hr',           'bonus.calculate'),
          ('hr',      'tpl-hr',           'bonus.confirm'),
          ('hr',      'tpl-hr',           'bonus.send'),
          -- 임원: 조회만(§6-1) — 급여대장·재무
          ('exec',    'tpl-exec',         'payroll.view'),
          ('exec',    'tpl-exec',         'finance.view'),
          -- 전체 조회(검수용): 조회 키만
          ('viewall', 'tpl-view-all',     'payroll.view')
       ) AS t(prefix, template_id, permission_key)
  JOIN permission_templates pt ON pt.template_id = t.template_id
  JOIN permissions p ON p.permission_key = t.permission_key
 WHERE NOT EXISTS (
   SELECT 1 FROM permission_template_grants g
    WHERE g.template_id = t.template_id AND g.permission_key = t.permission_key
 );

-- ── 3) 점검(읽기 전용, 적용 뒤 확인용) ──
-- 고아 권한키(어느 템플릿에도 없는 키) — 0행이어야 한다:
--   SELECT p.permission_key FROM permissions p
--    WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.permission_key = p.permission_key);
-- tpl-system-admin 누락 키 — 0행이어야 한다:
--   SELECT p.permission_key FROM permissions p
--    WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g
--                       WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = p.permission_key);
