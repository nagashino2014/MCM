-- ========================================================================
-- 006_fix_excel_serial_dates.sql
--   Replaces 5-digit Excel serial date strings (e.g., '46066') in text
--   date columns with their ISO YYYY-MM-DD equivalents.
--
--   Excel serial epoch: 1899-12-30 (1900 system, treats 1900 as a leap
--   year for backward compatibility with Lotus 1-2-3).
--   Allowed serial range: 25000 (~1968-06-06) to 80000 (~2119-01-29) to
--   avoid touching any non-date 5-digit value that may be stored in
--   these text columns.
--
--   Idempotent: safe to apply repeatedly. Rows that no longer match the
--   pattern after the first run are skipped automatically.
-- ========================================================================

BEGIN;

-- contracts.contract_date -------------------------------------------------
UPDATE contracts
SET contract_date = to_char(
        (DATE '1899-12-30' + make_interval(days => contract_date::int))::date,
        'YYYY-MM-DD'
    )
WHERE contract_date ~ '^[0-9]{5}$'
  AND contract_date::int BETWEEN 25000 AND 80000;

-- contract_payment_milestones.invoice_issued_at ---------------------------
UPDATE contract_payment_milestones
SET invoice_issued_at = to_char(
        (DATE '1899-12-30' + make_interval(days => invoice_issued_at::int))::date,
        'YYYY-MM-DD'
    )
WHERE invoice_issued_at ~ '^[0-9]{5}$'
  AND invoice_issued_at::int BETWEEN 25000 AND 80000;

-- contract_payment_milestones.payment_collected_at ------------------------
UPDATE contract_payment_milestones
SET payment_collected_at = to_char(
        (DATE '1899-12-30' + make_interval(days => payment_collected_at::int))::date,
        'YYYY-MM-DD'
    )
WHERE payment_collected_at ~ '^[0-9]{5}$'
  AND payment_collected_at::int BETWEEN 25000 AND 80000;

-- contract_invoices.issue_date --------------------------------------------
UPDATE contract_invoices
SET issue_date = to_char(
        (DATE '1899-12-30' + make_interval(days => issue_date::int))::date,
        'YYYY-MM-DD'
    )
WHERE issue_date ~ '^[0-9]{5}$'
  AND issue_date::int BETWEEN 25000 AND 80000;

-- contract_invoices.payment_collected_at ----------------------------------
UPDATE contract_invoices
SET payment_collected_at = to_char(
        (DATE '1899-12-30' + make_interval(days => payment_collected_at::int))::date,
        'YYYY-MM-DD'
    )
WHERE payment_collected_at ~ '^[0-9]{5}$'
  AND payment_collected_at::int BETWEEN 25000 AND 80000;

-- contract_change_events.changed_at ---------------------------------------
UPDATE contract_change_events
SET changed_at = to_char(
        (DATE '1899-12-30' + make_interval(days => changed_at::int))::date,
        'YYYY-MM-DD'
    )
WHERE changed_at ~ '^[0-9]{5}$'
  AND changed_at::int BETWEEN 25000 AND 80000;

COMMIT;

-- ------------------------------------------------------------------------
-- Verification: count remaining 5-digit serial values per column.
-- All should report 0 after a successful run.
-- ------------------------------------------------------------------------
SELECT
    'contracts.contract_date' AS column_name,
    COUNT(*) AS remaining_serial_rows
  FROM contracts
 WHERE contract_date ~ '^[0-9]{5}$'
   AND contract_date::int BETWEEN 25000 AND 80000
UNION ALL
SELECT
    'contract_payment_milestones.invoice_issued_at',
    COUNT(*)
  FROM contract_payment_milestones
 WHERE invoice_issued_at ~ '^[0-9]{5}$'
   AND invoice_issued_at::int BETWEEN 25000 AND 80000
UNION ALL
SELECT
    'contract_payment_milestones.payment_collected_at',
    COUNT(*)
  FROM contract_payment_milestones
 WHERE payment_collected_at ~ '^[0-9]{5}$'
   AND payment_collected_at::int BETWEEN 25000 AND 80000
UNION ALL
SELECT
    'contract_invoices.issue_date',
    COUNT(*)
  FROM contract_invoices
 WHERE issue_date ~ '^[0-9]{5}$'
   AND issue_date::int BETWEEN 25000 AND 80000
UNION ALL
SELECT
    'contract_invoices.payment_collected_at',
    COUNT(*)
  FROM contract_invoices
 WHERE payment_collected_at ~ '^[0-9]{5}$'
   AND payment_collected_at::int BETWEEN 25000 AND 80000
UNION ALL
SELECT
    'contract_change_events.changed_at',
    COUNT(*)
  FROM contract_change_events
 WHERE changed_at ~ '^[0-9]{5}$'
   AND changed_at::int BETWEEN 25000 AND 80000;
