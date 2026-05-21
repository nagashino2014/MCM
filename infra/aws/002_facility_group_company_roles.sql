ALTER TABLE facility_group_companies
ADD COLUMN IF NOT EXISTS group_role text NOT NULL DEFAULT 'affiliate';

UPDATE facility_group_companies
SET group_role = CASE
  WHEN is_headquarters = 1 THEN 'group_representative'
  ELSE 'affiliate'
END
WHERE group_role = 'affiliate';
