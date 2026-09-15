-- 217: AI API 관리 — 설정(kv)·예산·예산 알림 이력 + 현재 단가 뷰 (docs/ai-api-usage-management-blueprint.md §4.2, P1·P2).
-- ai_settings 는 intel_settings(065) 관례의 key-value(jsonb). 기본값은 코드(lib/ai/settings.ts DEFAULTS), 오버라이드만 저장.
--   feature_model_overrides : {"receipt.parse":"claude-haiku-4-5", ...} — 기능별 적용 모델(§3.6). 변경 감사는 audit_log(target_table=ai_settings).
--   usd_krw_rate            : 숫자 — 화면 KRW 병기용 환율(수동)
--   forecast_window_days    : 숫자 — 월 예상 계산 창(기본 7 = 기준일 전후 3일)
-- ai_budgets 는 예산(§3.5). 2026-09-03 확정: 전체(org) 월 $100, 임계 50/80/100, 초과 시 경고만(notify).
-- 멱등.

CREATE TABLE IF NOT EXISTS ai_settings (
  setting_key  text PRIMARY KEY,
  setting_json jsonb NOT NULL,
  updated_at   text NOT NULL,
  updated_by   text
);

CREATE TABLE IF NOT EXISTS ai_budgets (
  budget_id         text PRIMARY KEY,
  scope             text NOT NULL,                       -- org | feature:<key> | model:<family>
  monthly_limit_usd numeric(12,2) NOT NULL,
  warn_pcts         integer[] NOT NULL DEFAULT '{50,80,100}',
  action            text NOT NULL DEFAULT 'notify',      -- notify | block_noncritical | block_all
  recipients        text[] NOT NULL DEFAULT '{}',        -- user_id 목록(비면 ai.usage.manage 보유자)
  enabled           integer NOT NULL DEFAULT 1,
  created_at        text NOT NULL DEFAULT now()::text,
  updated_at        text NOT NULL DEFAULT now()::text
);

INSERT INTO ai_budgets (budget_id, scope, monthly_limit_usd, warn_pcts, action)
VALUES ('budget-org', 'org', 100.00, '{50,80,100}', 'notify')
ON CONFLICT (budget_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  alert_id   bigserial PRIMARY KEY,
  budget_id  text NOT NULL,
  ym         text NOT NULL,                              -- YYYY-MM(KST)
  pct        integer NOT NULL,                           -- 통과한 임계(%)
  amount_usd numeric(12,4),
  channels   text,                                       -- push,email,bell
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, ym, pct)
);

-- 모델별 현재 단가(적용일 최신 행) — 집계 쿼리에서 입력비/출력비 분해에 조인한다.
CREATE OR REPLACE VIEW ai_model_prices_current AS
SELECT DISTINCT ON (model_family) *
  FROM ai_model_prices
 WHERE effective_from <= CURRENT_DATE
 ORDER BY model_family, effective_from DESC;

COMMENT ON TABLE ai_settings IS 'AI API 관리 설정(kv) — 기능별 모델 오버라이드·환율·예측 창';
COMMENT ON TABLE ai_budgets IS 'AI API 월 예산 — scope 별 한도·임계·초과 정책';
