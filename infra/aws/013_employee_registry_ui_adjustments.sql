-- Employee registry UI follow-up: job duties and organization colors.

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS job_duties text;

UPDATE departments
   SET accent_color = '#FF8585',
       updated_at = now()::text
 WHERE dept_id = 'exec';

UPDATE departments
   SET accent_color = '#FB923C',
       updated_at = now()::text
 WHERE dept_id IN ('integrated-env-1', 'integrated-env-2');

UPDATE departments
   SET accent_color = '#A9D08E',
       updated_at = now()::text
 WHERE dept_id = 'carbon-neutral-lab';
