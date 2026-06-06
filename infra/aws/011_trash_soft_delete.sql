-- Soft-delete support for contracts/facilities and editable contract industry options.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS deleted_at text,
  ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS idx_contracts_deleted_at
  ON contracts(deleted_at);

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS deleted_at text,
  ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS idx_facilities_deleted_at
  ON facilities(deleted_at);

CREATE TABLE IF NOT EXISTS trash_items (
  trash_id text PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('facility', 'contract')),
  item_id text NOT NULL,
  item_title text,
  reason text,
  before_json jsonb,
  deleted_by text REFERENCES users(user_id) ON DELETE SET NULL,
  deleted_at text NOT NULL,
  purged_by text REFERENCES users(user_id) ON DELETE SET NULL,
  purged_at text
);

CREATE INDEX IF NOT EXISTS idx_trash_items_type
  ON trash_items(item_type);
CREATE INDEX IF NOT EXISTS idx_trash_items_item
  ON trash_items(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_trash_items_deleted_at
  ON trash_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_trash_items_purged_at
  ON trash_items(purged_at);

CREATE TABLE IF NOT EXISTS contract_industry_options (
  option_name text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

INSERT INTO contract_industry_options (option_name, sort_order, created_at, updated_at)
VALUES
  ('발전', 1, now()::text, now()::text),
  ('폐기물소각', 2, now()::text, now()::text),
  ('철강', 3, now()::text, now()::text),
  ('비철', 4, now()::text, now()::text),
  ('유기', 5, now()::text, now()::text),
  ('석유정제', 6, now()::text, now()::text),
  ('무기화학', 7, now()::text, now()::text),
  ('정밀화학', 8, now()::text, now()::text),
  ('비료및질소화합물', 9, now()::text, now()::text),
  ('펄프종이및판지', 10, now()::text, now()::text),
  ('전자부품', 11, now()::text, now()::text),
  ('반도체', 12, now()::text, now()::text),
  ('섬유염색및가공처리업', 13, now()::text, now()::text),
  ('도축육류가공및저장처리업', 14, now()::text, now()::text),
  ('알콜음료제조업', 15, now()::text, now()::text),
  ('플라스틱제품제조업', 16, now()::text, now()::text),
  ('자동차부품제조업', 17, now()::text, now()::text),
  ('폐기물처리업', 18, now()::text, now()::text),
  ('시멘트 제조업', 19, now()::text, now()::text),
  ('이차전지 제조업', 20, now()::text, now()::text)
ON CONFLICT (option_name) DO NOTHING;
