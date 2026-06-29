-- 049_facility_contact_card_ocr.sql
-- 영업·마케팅 P2: 명함 OCR. 신규 테이블 없이 기존 facility_contact_people(연락처 단일 마스터)을 확장한다.
-- 001(facility_contact_people)·016(인허가증 OCR 패턴) 위에 적용. 멱등.
-- 명함 촬영 → backend OCR → 필드 파싱 → 기존 담당자 upsert(BRN+이름+휴대폰 매칭). 016 인허가증과 동일한 storage_*/ocr 구조.

ALTER TABLE facility_contact_people
  ADD COLUMN IF NOT EXISTS card_storage_provider text,
  ADD COLUMN IF NOT EXISTS card_storage_bucket   text,
  ADD COLUMN IF NOT EXISTS card_storage_key      text,
  ADD COLUMN IF NOT EXISTS card_public_path      text,
  ADD COLUMN IF NOT EXISTS card_ocr_text         text,
  ADD COLUMN IF NOT EXISTS card_parsed_json      jsonb,
  ADD COLUMN IF NOT EXISTS card_captured_at      text;
