-- 192: 접속기록(access_log) — 개인정보보호 블루프린트 PR-P1.
-- 개보법 시행령의 개인정보처리시스템 접속기록(누가·언제·무엇을·어떤 처리) 축을 채운다.
--   기록 지점: 로그인 성공(웹·모바일 공용 verifyCredentials) / 인사서류 다운로드 / 급여대장·연말정산 조회
--   / 메일 별칭 변경 / RBAC 비상모드 기동 / 접속기록 조회 자체.
-- append-only: 트리거로 UPDATE·DELETE 를 차단한다(실수·앱 경로 변조 방지 — DB 원권한 통제는 P6).
--   보관은 무기한(삭제 배치 없음 — 1년 이상 요건 초과 충족).
-- 멱등.

CREATE TABLE IF NOT EXISTS access_log (
  log_id        bigserial PRIMARY KEY,
  actor_user_id text,                -- 로그인 실패 계열은 NULL 가능(현재는 성공만 기록)
  action        text NOT NULL,      -- login | view | download | delete | export | admin_change
  target_kind   text NOT NULL,      -- session | employee_doc | payroll | yearend | mail_alias | rbac_bypass | access_log ...
  target_id     text,
  detail        jsonb,
  created_at    text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_log_created ON access_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_actor ON access_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_kind ON access_log(target_kind, created_at DESC);

-- append-only 보호 — UPDATE/DELETE 는 앱 계정 포함 전면 차단(파기가 필요해지면 운영 계정이
-- 트리거를 내리고 파티션/기간 단위로만 정리한다는 절차를 전제).
CREATE OR REPLACE FUNCTION access_log_protect() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'access_log 는 append-only 입니다 (UPDATE/DELETE 금지)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_access_log_protect ON access_log;
CREATE TRIGGER trg_access_log_protect
  BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_protect();

-- 접속기록 조회 권한키 — 시스템 관리자 템플릿에 시드(111 관례).
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('security.access_log', 'security', 'access_log', '접속기록(access_log) 조회 — 열람 자체도 기록된다', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('security.access_log'), 1, 16),
       'tpl-system-admin', 'security.access_log', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'security.access_log'
   );
