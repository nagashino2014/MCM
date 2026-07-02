-- 052_employee_photo.sql
-- 직원 증명사진(그룹웨어 메신저·영업 담당자 아바타 공용). employee_profiles 확장.
-- 012(employee_profiles) 위에 적용. 멱등. S3 저장(016 인허가증/employee_documents 패턴).

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS photo_storage_provider text,
  ADD COLUMN IF NOT EXISTS photo_storage_bucket   text,
  ADD COLUMN IF NOT EXISTS photo_storage_key      text,
  ADD COLUMN IF NOT EXISTS photo_public_path      text,
  ADD COLUMN IF NOT EXISTS photo_updated_at       text;
