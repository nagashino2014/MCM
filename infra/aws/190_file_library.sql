-- 190: 파일함(파일 · 문서함) — 통합 파일 관리 권한키 + 파일 저장 정책.
-- 화면: /files (전자결재·메신저·시설 자료·게시판·업무이슈 첨부의 통합 목록·열기·삭제).
-- 정책: 파일 크기 구간(≤5MB / ≤50MB / >50MB)별 보존기간(6개월/1년/5년/영구) 설정.
--   1차는 설정 저장 + 목록의 '보존기간 경과' 표시까지 — 자동 삭제 배치는 후속.
-- 멱등.

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('files.manage', 'files', 'manage', '파일함 — 전사 첨부파일 통합 조회·삭제·저장 정책 관리', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자 템플릿(tpl-system-admin, 111) grant 보충 — 111 주석의 필수 절차:
-- "새 권한 키를 추가하면 이 템플릿에도 넣어야 한다". 누락 시 관리자조차 403(role 우회가 없다).
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('files.manage'), 1, 16),
       'tpl-system-admin', 'files.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'files.manage'
   );

-- 파일 저장 정책 — 크기 구간당 1행(고정 3행). retention 은 '6m'|'1y'|'5y'|'permanent'.
CREATE TABLE IF NOT EXISTS file_retention_policies (
  size_tier  text PRIMARY KEY CHECK (size_tier IN ('le5mb', 'le50mb', 'gt50mb')),
  retention  text NOT NULL DEFAULT 'permanent' CHECK (retention IN ('6m', '1y', '5y', 'permanent')),
  updated_at text NOT NULL,
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL
);

INSERT INTO file_retention_policies (size_tier, retention, updated_at)
VALUES
  ('le5mb',  'permanent', now()::text),
  ('le50mb', 'permanent', now()::text),
  ('gt50mb', 'permanent', now()::text)
ON CONFLICT (size_tier) DO NOTHING;
