-- 110_permission_template_fill.sql
-- 어느 템플릿에도 배분되지 않은 '고아 권한' 12종을 채운다.
--
-- 배경(2026-07-29 실측): 등록 권한 49개 중 전자결재(approval.*)·게시판(board.*)·
-- 휴지통(trash.*)·감사(audit.read)·조직편집(org.edit)·잠금해제(work_plan.lock_release)가
-- 어떤 permission_template_grants 행에도 없었다. RBAC_ENFORCE=true 환경에서
-- requirePermission 은 admin 만 하드코딩으로 통과시키므로, 결과적으로
-- **admin 3명 외 전 직원이 전자결재·게시판을 사용할 수 없는 상태**였다
-- (모바일 M2 검증 중 이유억 대표 계정의 403 으로 발견).
--
-- 그룹웨어 기능(E-P1 전자결재, G6-B 게시판)을 추가하며 권한 키는 만들었으나
-- 템플릿 배분을 빠뜨린 것이 원인. admin 우회 때문에 개발 중에는 드러나지 않았다.
--
-- scope_kind 는 checkPermission(lib/auth/rbac.ts)의 범위 규칙:
--   all = 제한 없음 / self_dept = 본인 부서 / self = 본인 / participant = 참여 건.
-- 결재·게시판은 'all' 로 준다 — 문서 단위 접근 통제는 라우트가 따로 한다
--   (결재 상세는 기안자·결재선·참조자·문서함 공개범위로, 승인은 "내 차례(step)"로 판정).
-- 관례: 멱등(WHERE NOT EXISTS). 존재하지 않는 템플릿/권한은 조인에서 자연히 제외된다.

-- 배분 대상 정의: (권한 키, 템플릿, 범위)
WITH grants(permission_key, template_id) AS (
  VALUES
    -- 전자결재·게시판 = 전 직원이 쓰는 기본 기능
    ('approval.view',   'tpl-staff-basic'), ('approval.view',   'tpl-dept-lead'),
    ('approval.view',   'tpl-exec'),        ('approval.view',   'tpl-sales'),
    ('approval.view',   'tpl-hr'),          ('approval.view',   'tpl-data-review'),
    ('approval.view',   'tpl-admin-rbac'),
    -- act 는 넓게 주되, 실제 결재 가능 여부는 API 가 "내 차례(step)인지"로 판정한다
    ('approval.act',    'tpl-staff-basic'), ('approval.act',    'tpl-dept-lead'),
    ('approval.act',    'tpl-exec'),        ('approval.act',    'tpl-sales'),
    ('approval.act',    'tpl-hr'),          ('approval.act',    'tpl-data-review'),
    ('approval.act',    'tpl-admin-rbac'),

    ('board.view',      'tpl-staff-basic'), ('board.view',      'tpl-dept-lead'),
    ('board.view',      'tpl-exec'),        ('board.view',      'tpl-sales'),
    ('board.view',      'tpl-hr'),          ('board.view',      'tpl-data-review'),
    ('board.view',      'tpl-admin-rbac'),
    ('board.write',     'tpl-staff-basic'), ('board.write',     'tpl-dept-lead'),
    ('board.write',     'tpl-exec'),        ('board.write',     'tpl-sales'),
    ('board.write',     'tpl-hr'),          ('board.write',     'tpl-data-review'),
    ('board.write',     'tpl-admin-rbac'),

    -- 운영 권한
    ('approval.manage', 'tpl-hr'),          ('approval.manage', 'tpl-admin-rbac'),
    ('board.manage',    'tpl-hr'),          ('board.manage',    'tpl-admin-rbac'),

    -- 휴지통: 조회·복구는 부서장/영업, 영구삭제는 관리자만
    ('trash.view',      'tpl-dept-lead'),   ('trash.view',      'tpl-sales'),
    ('trash.view',      'tpl-admin-rbac'),
    ('trash.restore',   'tpl-dept-lead'),   ('trash.restore',   'tpl-sales'),
    ('trash.restore',   'tpl-admin-rbac'),
    ('trash.purge',     'tpl-admin-rbac'),

    -- 관리자 전용
    ('audit.read',      'tpl-admin-rbac'),
    ('org.edit',        'tpl-admin-rbac'),

    -- 업무보고 잠금 해제 = 부서장·임원
    ('work_plan.lock_release', 'tpl-dept-lead'),
    ('work_plan.lock_release', 'tpl-exec')
)
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT
  -- 결정적 id — 재실행해도 같은 행을 가리킨다.
  'grant-fill-' || substr(md5(g.template_id || ':' || g.permission_key), 1, 16),
  g.template_id,
  g.permission_key,
  -- 부서장의 업무보고 잠금 해제만 본인 부서로 한정, 나머지는 제한 없음.
  CASE WHEN g.permission_key = 'work_plan.lock_release' AND g.template_id = 'tpl-dept-lead'
       THEN 'self_dept' ELSE 'all' END,
  'allow',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM grants g
  JOIN permission_templates t ON t.template_id = g.template_id
  JOIN permissions p ON p.permission_key = g.permission_key
 WHERE NOT EXISTS (
   SELECT 1 FROM permission_template_grants x
    WHERE x.template_id = g.template_id AND x.permission_key = g.permission_key
 );
