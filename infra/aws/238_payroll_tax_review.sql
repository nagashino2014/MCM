-- G-00A A4/A5. Additive; existing confirmed/imported payroll is not marked tax-reviewed.
ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS tax_review jsonb NOT NULL
  DEFAULT '{"status":"pending","reason":"세액 계산 또는 원본 근거 확인 필요"}'::jsonb;

CREATE TABLE IF NOT EXISTS payroll_tax_review_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id text NOT NULL REFERENCES payroll_entries(entry_id) ON DELETE CASCADE,
  reviewed_by text NOT NULL,
  review jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Statement triggers acquire the common lock BEFORE row locks. This also covers
-- the Python importer and direct SQL line writers; application writers take it earlier.
CREATE OR REPLACE FUNCTION payroll_write_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(724301, 1);
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_item_defs','payroll_ledgers','payroll_entries','payroll_entry_lines','payroll_tax_profiles','income_tax_brackets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS payroll_write_lock ON %I', t);
    EXECUTE format('CREATE TRIGGER payroll_write_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION payroll_write_lock()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION payroll_used_item_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind AND EXISTS (
    SELECT 1 FROM payroll_entry_lines WHERE item_id=OLD.item_id
  ) THEN
    RAISE EXCEPTION '사용 중인 급여 항목은 지급/공제 종류를 변경할 수 없습니다.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payroll_used_item_kind_guard ON payroll_item_defs;
CREATE TRIGGER payroll_used_item_kind_guard BEFORE UPDATE OF kind ON payroll_item_defs
  FOR EACH ROW EXECUTE FUNCTION payroll_used_item_kind_guard();

CREATE OR REPLACE FUNCTION payroll_line_tax_review_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry text; target_item text;
BEGIN
  -- Preserve the reviewed input/actor in the events table; never retain a valid flag after editing.
  IF TG_OP <> 'INSERT' THEN
    target_entry := OLD.entry_id; target_item := OLD.item_id;
    IF target_item IN ('income-tax','local-tax') OR EXISTS(SELECT 1 FROM payroll_item_defs WHERE item_id=target_item AND kind='pay') THEN
      UPDATE payroll_entries SET tax_review=jsonb_build_object('status','pending','reason','지급액 또는 세액 변경 후 재계산·근거 확인 필요')
       WHERE entry_id=target_entry;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    target_entry := NEW.entry_id; target_item := NEW.item_id;
    IF target_item IN ('income-tax','local-tax') OR EXISTS(SELECT 1 FROM payroll_item_defs WHERE item_id=target_item AND kind='pay') THEN
      UPDATE payroll_entries SET tax_review=jsonb_build_object('status','pending','reason','지급액 또는 세액 변경 후 재계산·근거 확인 필요')
       WHERE entry_id=target_entry;
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS payroll_line_tax_review_invalidate ON payroll_entry_lines;
CREATE TRIGGER payroll_line_tax_review_invalidate AFTER INSERT OR UPDATE OR DELETE ON payroll_entry_lines
  FOR EACH ROW EXECUTE FUNCTION payroll_line_tax_review_invalidate();
