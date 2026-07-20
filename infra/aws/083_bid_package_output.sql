-- 083: 입찰 패키지 생성 산출물 보관(P4) — 생성 zip 을 S3(bids/package-output/{packageId}/)에
--      보관하고 최신 1건의 메타(키·파일명·일시·생성자·경고 수·크기)를 기록한다.
--      재생성 시 이전 산출물은 대체(키가 다르면 저장소에서도 삭제).
-- (docs/bid-package-blueprint.md §5-6. 멱등)
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS output_key text;
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS output_name text;
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS output_generated_at timestamptz;
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS output_generated_by text;
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS output_warning_count integer;
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS output_byte_size bigint;
