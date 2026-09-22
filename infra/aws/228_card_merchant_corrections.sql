-- 개별 카드의 증빙 정정 이력. 카드사 수집 원본과 기존 소비 스냅샷은 갱신하지 않는다.
CREATE TABLE IF NOT EXISTS card_merchant_corrections (
  event_id text PRIMARY KEY,
  card_txn_id text NOT NULL REFERENCES card_transactions(card_txn_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('correct','withdraw')),
  corp_num text,
  original_corp_num text,
  original_source_hash text NOT NULL CHECK (original_source_hash ~ '^[0-9a-f]{64}$'),
  original_basis jsonb NOT NULL CHECK (jsonb_typeof(original_basis)='object'),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  evidence text NOT NULL CHECK (length(trim(evidence)) BETWEEN 1 AND 1000),
  actor_user_id text NOT NULL,
  reviewed_by text NOT NULL,
  created_at text NOT NULL,
  request_id text NOT NULL UNIQUE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(card_txn_id,version),
  CHECK ((action='correct' AND corp_num IS NOT NULL AND corp_num ~ '^[0-9]{10}$' AND corp_num<>'0000000000') OR (action='withdraw' AND corp_num IS NULL))
);
CREATE OR REPLACE FUNCTION prevent_card_merchant_correction_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Card merchant correction history is append-only; record a new correction or withdrawal' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS card_merchant_correction_append_only ON card_merchant_corrections;
CREATE TRIGGER card_merchant_correction_append_only BEFORE UPDATE OR DELETE ON card_merchant_corrections
  FOR EACH ROW EXECUTE FUNCTION prevent_card_merchant_correction_rewrite();
