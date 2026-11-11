-- 355 회사소개서 직접 입력 임원(촉탁) 사진 게재 선택(사용자 지시 2026-11-11)
-- 사용자관리 임원(catalog_people_meta.photo_consent)과 같은 뜻: NULL 미확인 · 1 동의 · 0 거부. 임원은 거부가 아니면 사진을 싣는다.
ALTER TABLE catalog_extra_people ADD COLUMN IF NOT EXISTS photo_consent int;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_extra_people_photo_consent_check') THEN
    ALTER TABLE catalog_extra_people ADD CONSTRAINT catalog_extra_people_photo_consent_check CHECK (photo_consent IN (0, 1));
  END IF;
END $$;
