-- 215: AI API 사용량 계측 — docs/ai-api-usage-management-blueprint.md P0.
-- 게이트웨이(frontend/lib/ai/claude-client.ts)가 Claude 호출 1건마다 1행을 남긴다.
--   토큰(입력/캐시 쓰기/캐시 읽기/출력)·비용(USD)·상태·소요·기능 키·사용자·대상 엔티티.
--   프롬프트·응답 원문은 저장하지 않는다(영수증·명함·연말정산 개인정보) — meta 에는 형상(블록 수·길이)만.
-- called_at 은 기존 관례(text ISO)와 달리 timestamptz — 일/월 집계와 KST 변환이 잦은 집계 전용 테이블이라 예외를 둔다.
-- 멱등.

CREATE TABLE IF NOT EXISTS ai_usage_log (
  log_id                       bigserial PRIMARY KEY,
  called_at                    timestamptz NOT NULL DEFAULT now(),
  provider                     text NOT NULL DEFAULT 'anthropic',
  feature_key                  text NOT NULL,          -- frontend/lib/ai/features.ts 의 키(슬롯 포함)
  model                        text NOT NULL,          -- 실제 사용 모델 ID(응답 model 우선)
  model_family                 text NOT NULL,          -- 날짜 접미사 제거 정규형 — ai_model_prices 매핑 키
  input_tokens                 integer NOT NULL DEFAULT 0,  -- 캐시 제외 입력
  cache_creation_input_tokens  integer NOT NULL DEFAULT 0,
  cache_read_input_tokens      integer NOT NULL DEFAULT 0,
  output_tokens                integer NOT NULL DEFAULT 0,  -- thinking 포함
  cost_usd                     numeric(12,6),           -- 단가 미등록 모델은 NULL
  latency_ms                   integer,
  status                       text NOT NULL,           -- ok | error | timeout | refusal | truncated | budget_blocked
  http_status                  integer,
  stop_reason                  text,
  request_id                   text,                    -- Anthropic 응답 헤더 request-id(Console 대조용)
  user_id                      text,
  subject_type                 text,                    -- approval_doc | receipt | contract | briefing ...
  subject_id                   text,
  env                          text,                    -- staging | local | ...
  meta                         jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_called ON ai_usage_log(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature ON ai_usage_log(feature_key, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user ON ai_usage_log(user_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_subject ON ai_usage_log(subject_type, subject_id);

-- 일별 집계 뷰(KST 기준 날짜). 규모가 커지면 물리화 테이블로 승격(P5).
CREATE OR REPLACE VIEW ai_usage_daily AS
SELECT (called_at AT TIME ZONE 'Asia/Seoul')::date AS day,
       feature_key,
       model_family,
       env,
       count(*)                                   AS calls,
       count(*) FILTER (WHERE status = 'ok')      AS ok_calls,
       count(*) FILTER (WHERE status = 'truncated') AS truncated_calls,
       count(*) FILTER (WHERE status IN ('error','timeout')) AS failed_calls,
       sum(input_tokens)                          AS input_tokens,
       sum(cache_creation_input_tokens)           AS cache_creation_input_tokens,
       sum(cache_read_input_tokens)               AS cache_read_input_tokens,
       sum(output_tokens)                         AS output_tokens,
       sum(cost_usd)                              AS cost_usd
  FROM ai_usage_log
 GROUP BY 1, 2, 3, 4;

-- 권한키 — 시스템 관리자 템플릿에 시드(111·192 관례).
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('ai.usage.view',   'ai', 'usage_view',   'AI API 사용량·비용 조회(/admin/ai-usage)', 'all', 0, now()::text),
  ('ai.usage.manage', 'ai', 'usage_manage', 'AI API 예산·단가·기능별 모델 설정 변경',   'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(k.permission_key), 1, 16),
       'tpl-system-admin', k.permission_key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('ai.usage.view'), ('ai.usage.manage')) AS k(permission_key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = k.permission_key
   );
