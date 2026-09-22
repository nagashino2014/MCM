-- G-03B: explicit economic-event/payment relationships; no legacy reconstruction.
CREATE TABLE IF NOT EXISTS transaction_link_requests (
  request_id text PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('create','cancel')),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL,
  actor_user_id text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_links (
  link_id text PRIMARY KEY,
  relation text NOT NULL CHECK (relation IN ('card_invoice','bank_invoice','manual_invoice','distinct')),
  left_kind text NOT NULL CHECK (left_kind IN ('card','bank','manual_invoice')),
  left_id text NOT NULL,
  right_kind text NOT NULL CHECK (right_kind IN ('hometax','tax_invoice')),
  right_id text NOT NULL,
  canonical_invoice_key text NOT NULL,
  supply bigint NOT NULL CHECK (supply >= 0 AND supply <= 9007199254740991),
  tax bigint NOT NULL CHECK (tax >= 0 AND tax <= 9007199254740991),
  total bigint NOT NULL CHECK (total >= 0 AND total <= 9007199254740991),
  expense_account text REFERENCES journal_accounts(account_code),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  evidence text NOT NULL CHECK (length(trim(evidence)) > 0),
  left_hash text NOT NULL CHECK (left_hash ~ '^[0-9a-f]{64}$'),
  right_hash text NOT NULL CHECK (right_hash ~ '^[0-9a-f]{64}$'),
  left_snapshot jsonb NOT NULL,
  right_snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','cancelled')),
  request_id text NOT NULL,
  created_by text NOT NULL,
  created_at text NOT NULL,
  cancelled_by text,
  cancelled_at text,
  cancel_reason text,
  CHECK ((relation='distinct' AND supply=0 AND tax=0 AND total=0)
    OR (relation='bank_invoice' AND supply=0 AND tax=0 AND total>0)
    OR (relation IN ('card_invoice','manual_invoice') AND total>0 AND supply+tax=total)),
  CHECK ((state='active' AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (state='cancelled' AND cancelled_at IS NOT NULL AND length(trim(cancel_reason))>0))
);
CREATE INDEX IF NOT EXISTS idx_transaction_links_left ON transaction_links(left_kind,left_id,state);
CREATE INDEX IF NOT EXISTS idx_transaction_links_invoice ON transaction_links(canonical_invoice_key,state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_links_active_pair ON transaction_links(relation,left_kind,left_id,canonical_invoice_key) WHERE state='active';
-- Recognition survives payment unlinking. Cancellation never erases the invoice event.
CREATE TABLE IF NOT EXISTS transaction_invoice_recognitions (
  recognition_id text PRIMARY KEY,
  canonical_invoice_key text NOT NULL UNIQUE,
  source_kind text NOT NULL CHECK (source_kind IN ('hometax','tax_invoice')),
  source_id text NOT NULL,
  source_hash text NOT NULL,
  source_snapshot jsonb NOT NULL,
  expense_account text REFERENCES journal_accounts(account_code),
  reason text NOT NULL,
  evidence text NOT NULL,
  request_id text NOT NULL,
  created_by text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_link_history (
  history_id text PRIMARY KEY,
  link_id text NOT NULL REFERENCES transaction_links(link_id),
  action text NOT NULL CHECK (action IN ('create','cancel')),
  request_id text NOT NULL,
  actor_user_id text NOT NULL,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at text NOT NULL
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM journal_accounts WHERE account_code='251' AND (name<>'외상매입금' OR acct_type<>'liability' OR is_active<>1)) THEN
    RAISE EXCEPTION 'G03B: account 251 conflicts with supplier payable; review before migration' USING ERRCODE='23514';
  END IF;
  INSERT INTO journal_accounts(account_code,name,acct_type,is_active,sort_order)
    VALUES('251','외상매입금','liability',1,108) ON CONFLICT(account_code) DO NOTHING;
END $$;
