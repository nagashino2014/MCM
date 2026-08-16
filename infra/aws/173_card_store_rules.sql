-- 173: 가맹점 계정과목 고정 규칙 (사용자 명시 지정 · 소급 적용)
-- 배경: 코레일처럼 지출 용도가 하나로 고정되는 매입처는 "이 가맹점 = 이 계정과목"으로 못박고 싶다.
--       반면 PG/전자상거래(이니시스·NHN·쿠팡 등)는 건마다 용도가 달라 일원화하면 안 된다.
--       → 자동 학습(card_merchant_links)과 분리해, 사용자가 판단해 만든 고정 규칙만 이 표에 담는다.
-- 매칭 기준 2종:
--   corp_num   — 가맹점 사업자번호(숫자만). 실사용처가 곧 가맹점인 일반 케이스.
--   store_name — 정규화 상호(공백 제거·대문자). PG 경유 결제라 사업자번호가 PG사인 케이스
--                (예: "OPENAI *CHATGPT SUBSCR" — 사업자번호는 이니시스, 실사용처는 상호에만 있음).

CREATE TABLE IF NOT EXISTS card_store_rules (
  rule_id             text PRIMARY KEY,
  match_type          text NOT NULL,              -- corp_num / store_name
  match_value         text NOT NULL,              -- 사업자번호(숫자만) 또는 정규화 상호
  category_key        text NOT NULL,
  store_name_snapshot text,                       -- 규칙 생성 시점의 상호(표시용)
  store_biz_type      text,                       -- 생성 시점 업태(PG 여부 확인용)
  note                text,
  applied_count       integer NOT NULL DEFAULT 0, -- 마지막 소급 적용 건수
  created_by          text,
  created_at          text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at          text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_card_store_rules_match ON card_store_rules(match_type, match_value);
CREATE INDEX IF NOT EXISTS idx_card_store_rules_category ON card_store_rules(category_key);

-- 정규화 상호 매칭용 — 상호에서 공백 제거·대문자화한 값으로 조회하므로 표현식 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_card_txn_store_name_norm
  ON card_transactions (upper(replace(store_name, ' ', '')));
