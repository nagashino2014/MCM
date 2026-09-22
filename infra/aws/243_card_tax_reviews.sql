-- G-03: source-bound human VAT decisions. Historical card flags and filed returns remain unchanged.
CREATE TABLE IF NOT EXISTS card_tax_reviews (
  card_txn_id text PRIMARY KEY REFERENCES card_transactions(card_txn_id),
  decision integer CHECK (decision IN (0, 1)),
  reason text NOT NULL,
  evidence_ref text NOT NULL,
  source_hash text NOT NULL,
  tax_date text,
  original_card_txn_id text REFERENCES card_transactions(card_txn_id),
  original_source_hash text,
  reversal_reason text CHECK (reversal_reason IN ('return', 'contract_cancellation', 'price_adjustment', 'original_correction')),
  reviewed_at text NOT NULL
);
