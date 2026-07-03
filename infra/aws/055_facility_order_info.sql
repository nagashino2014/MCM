-- 055_facility_order_info.sql
-- 사업장 발주정보: 발주구분/발주일시/투찰기간/예정가격/낙찰하한율/참여업체.
-- 054(facility_facility_info) 위에 적용. 멱등. 영업활동 진행상황 카드의 발주유형·참여업체와 연동.

CREATE TABLE IF NOT EXISTS facility_order_info (
  facility_id      text PRIMARY KEY REFERENCES facilities(facility_id) ON DELETE CASCADE,
  order_type       text,   -- 발주구분: negotiated(수의계약) / limited(제한경쟁) / qualification(적격심사)
  order_at         text,   -- 발주일시 (ISO)
  bid_start        text,   -- 투찰기간 시작 (ISO)
  bid_end          text,   -- 투찰기간 종료 (ISO)
  estimated_price  bigint, -- 예정가격 (원)
  min_bid_rate     double precision, -- 낙찰하한율 (%)
  participants     jsonb NOT NULL DEFAULT '[]'::jsonb, -- 참여업체명 배열
  updated_at       text NOT NULL,
  updated_by       text REFERENCES users(user_id) ON DELETE SET NULL
);
