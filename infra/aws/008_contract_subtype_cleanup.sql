-- Normalize integrated-permit initial service subtype naming.
-- "통합허가" as a subtype is ambiguous with the parent service type, so existing
-- contract rows are renamed to the clearer "최초허가" label used by the UI.

UPDATE contracts
SET service_subtype = '최초허가',
    updated_at = COALESCE(updated_at, NOW()::text)
WHERE service_subtype = '통합허가';
