-- 368_asset_reservation_range.sql
-- 자산 직접 예약 날짜 범위(2026-11-12 사용자 결정, 직원 개선 요청 19 — '차량 외 자산만 범위').
--   회의실·기타 자산은 시작일~종료일을 한 번에 한 건으로 예약한다(달력에 연속 막대, 취소도 한 번).
--   reserved_until = 마지막 날(YYYY-MM-DD). NULL = reserved_on 하루(기존 예약·법인차량은 모두 NULL 그대로).
--   여러 날 예약의 시각은 첫날 시작(start_time)·마지막 날 종료(end_time)로 해석하고, 비우면 기간 전체 종일이다.
--   법인차량은 하루 안의 짧은 사용만 받으므로 앱이 reserved_until 을 넣지 않는다(lib/assets/store.ts).
-- 설치 전제: 121_reservable_assets.sql(asset_reservations). 멱등.

ALTER TABLE asset_reservations ADD COLUMN IF NOT EXISTS reserved_until text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'asset_reservations_until_after_on'
       AND conrelid = 'asset_reservations'::regclass
  ) THEN
    ALTER TABLE asset_reservations
      ADD CONSTRAINT asset_reservations_until_after_on
      CHECK (reserved_until IS NULL OR reserved_until > reserved_on);
  END IF;
END $$;
