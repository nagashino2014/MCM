-- 077: 공공입찰 사업분야 매칭 알림 — 분류 조건 그룹(match_rule) + 매칭 알림 큐(bid_match_notices).
-- match_rule: {"groups":[{"op":"and|or|nor","keywords":["..."]}]}
--   그룹 내 키워드는 op(AND=모두 포함/OR=하나라도/NOR=모두 미포함)로, 그룹 간은 AND 로 결합.
--   NULL 이면 기존 keywords 배열을 OR 단일 그룹으로 해석(하위호환).
ALTER TABLE bid_categories ADD COLUMN IF NOT EXISTS match_rule jsonb;

-- 매칭 알림 큐 — 신규 수집 건이 분류 조건에 매칭되면 적재, 설정된 발송 시각에 채널별(카카오/메일) 발송.
CREATE TABLE IF NOT EXISTS bid_match_notices (
  notice_id text PRIMARY KEY,
  bid_type text NOT NULL CHECK (bid_type IN ('order_plan', 'prior_spec', 'bid_notice')),
  bid_id text NOT NULL,
  category_id text NOT NULL,
  category_name text,
  title text,
  org_name text,
  budget bigint,
  posted_at text,
  deadline text,
  url text,
  matched_at text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  sent_at text,
  channel_results jsonb,
  UNIQUE (bid_type, bid_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_bid_match_notices_status ON bid_match_notices(status, matched_at);
