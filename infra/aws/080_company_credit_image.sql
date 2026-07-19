-- 080: 회사 프로필 — 신용평가 등급 확인서 이미지(등급 표시부 크롭) 슬롯
-- 입찰 증빙서류 패키지 생성 시 신용평가 서식의 스캔 이미지를 이 이미지로 교체한다. (멱등)
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS credit_image_key text;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS credit_image_name text;
