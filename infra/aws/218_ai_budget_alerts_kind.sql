-- 218: AI API 예산 알림 확장 — docs/ai-api-usage-management-blueprint.md §3.5·§6 (P2).
-- ai_budget_alerts 에 알림 종류(kind)·일자 dedup 키·본문을 추가하고 dedup 제약을 종류별로 재정의한다.
--   threshold   : 당월 누계가 임계(pct)% 통과 — (budget, ym, pct) 월 1회
--   forecast    : 월 예상이 한도 초과 — (budget, ym, day) 일 1회
--   single_call : 단건 고비용 — day 에 log_id 를 넣어 건별 1회
-- ai_budgets 에 표시용 label 을 추가한다.
-- 멱등.

ALTER TABLE ai_budget_alerts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'threshold';
ALTER TABLE ai_budget_alerts ADD COLUMN IF NOT EXISTS day text;
ALTER TABLE ai_budget_alerts ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE ai_budget_alerts DROP CONSTRAINT IF EXISTS ai_budget_alerts_budget_id_ym_pct_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_budget_alerts_dedup
  ON ai_budget_alerts (budget_id, ym, kind, pct, COALESCE(day, ''));
CREATE INDEX IF NOT EXISTS idx_ai_budget_alerts_sent ON ai_budget_alerts (sent_at DESC);

ALTER TABLE ai_budgets ADD COLUMN IF NOT EXISTS label text;
UPDATE ai_budgets SET label = '전체' WHERE budget_id = 'budget-org' AND label IS NULL;

COMMENT ON COLUMN ai_budget_alerts.kind IS 'threshold | forecast | single_call';
COMMENT ON COLUMN ai_budget_alerts.day IS 'forecast=KST 일자(일 1회), single_call=ai_usage_log.log_id';
