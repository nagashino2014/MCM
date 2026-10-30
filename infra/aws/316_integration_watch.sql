-- 316: 외부 연동 상태 감시(쉐도우 모니터링) — 심장박동·판정 상태 표 + 화면 권한.
--   (docs/integration-watchdog-blueprint.md, 2026-10-30 사용자 확정)
-- 배경: 2026-10-01 고정 스케줄 이미지 만료로 야간 intel 배치가 한 달간 조용히 실패했다. 수집 경로마다 실패 모양이
--   달라 오류 로그가 아니라 "마지막 성공 시각"을 기대 주기와 비교해 이상일 때만 알린다.
-- 선행: 001(alerts), 012(permissions·permission_templates·tpl-system-admin). GRANT 없음(265 default privileges). 멱등.

-- ── 1) 심장박동 — 수집 경로가 직접 남기는 "돌았다/성공했다" 기록 ──
--   source      : intel.dart · intel.eiass · intel.news · intel.press · intel.gosi_me · intel.gosi_eum · adt.collector …
--   last_seen_at: 마지막으로 실행(호출)된 시각. 실패해도 갱신한다.
--   last_ok_at  : 마지막으로 성공한 시각. 오류 없이 끝나고 항목을 1건 이상 훑었을 때만 갱신한다
--                 (오류를 삼키고 0건으로 끝나는 수집기도 실패로 잡기 위해 — 2026-10 환경청 RSS 0건 사례).
CREATE TABLE IF NOT EXISTS integration_heartbeats (
  source       text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL,
  last_ok_at   timestamptz,
  last_error   text,
  detail       jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 2) 판정 상태 — 감시 틱이 대상별로 upsert. 전이(정상→이상·지속·복구)로 알림 여부를 정한다 ──
--   status        : ok | failing | unknown(판정 근거 없음 — 알림 안 함)
--   failing_since : 이상으로 바뀐 시각(복구 시 NULL)
--   last_alert_at : 마지막 이상 알림 시각 — 지속 시 24시간마다 재알림
CREATE TABLE IF NOT EXISTS integration_health (
  check_key       text PRIMARY KEY,
  grp             text NOT NULL,
  label           text NOT NULL,
  status          text NOT NULL DEFAULT 'unknown',
  reason          text,
  last_ok_at      timestamptz,
  failing_since   timestamptz,
  last_alert_at   timestamptz,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  detail          jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_health_status_check') THEN
    ALTER TABLE integration_health
      ADD CONSTRAINT integration_health_status_check CHECK (status IN ('ok', 'failing', 'unknown'));
  END IF;
END $$;

-- ── 3) 화면 권한(/admin/integrations) — 시스템 관리자에게만 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('ops.integration.view', 'ops', 'integration_view', '외부 연동 상태 조회·지금 점검(/admin/integrations)', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('ops.integration.view'), 1, 16),
       'tpl-system-admin', 'ops.integration.view', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'ops.integration.view'
   );
