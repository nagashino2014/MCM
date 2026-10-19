-- 294_view_all_template.sql (구 213_view_all_template.sql — 213 이 213_regulatory_filings.sql 과 중복이라 2026-10-19 재번호, 내용 동일·멱등. 스테이징에는 213 으로 이미 적용됨)
-- "전체 조회(검수용)" 권한 템플릿 — 수정 기능 없이 모든 메뉴를 열람만 하는 계정용.
--
-- 용도: 내부 검수자·감사인·신규 임원 온보딩처럼 "전 화면을 읽기만" 해야 하는 경우.
-- ⚠ 스토어 심사용 데모 계정에는 붙이지 말 것 — staffing.view(전 직원 인사)·billing.view(재무)·
--   contract.view(전 계약)이 scope=all 로 열리므로 외부인에게 줄 권한이 아니다(심사는 '일반 직원'이면 충분).
--
-- 구성: permissions 중 action 이 view/read 이고 scope 'all' 을 지원하며 is_dangerous=0 인 키를
--       scope=all/allow 로 부여. 111(시스템 관리자)과 같은 동적 SELECT 라 새 조회 키가 추가되면
--       이 파일을 다시 실행해 채운다(멱등, WHERE NOT EXISTS). 인원 부여는 관리 화면에서 한다.
--
-- 관례: 멱등(WHERE NOT EXISTS). 관례상 text 타임스탬프.

-- 1) 템플릿
INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_at, updated_at)
SELECT 'tpl-view-all', '전체 조회(검수용)',
       '모든 모듈의 조회(view/read) 권한을 전사 범위로 보유. 수정·삭제·관리 권한 없음. 검수·감사·온보딩용.',
       1, 1,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE NOT EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-view-all');

-- 2) 조회 계열 권한을 scope=all 로 부여(재실행하면 새로 추가된 조회 키도 채워진다)
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-viewall-' || substr(md5(p.permission_key), 1, 16),
       'tpl-view-all', p.permission_key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM permissions p
 WHERE p.action IN ('view', 'read')
   AND (',' || p.scopes_supported || ',') LIKE '%,all,%'
   AND COALESCE(p.is_dangerous, 0) = 0
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-view-all' AND g.permission_key = p.permission_key
   );
