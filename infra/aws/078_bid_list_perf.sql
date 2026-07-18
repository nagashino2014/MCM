-- 078: 공공입찰 목록 성능 — 기본 정렬(게시일 폴백 생성일)이 인덱스를 타도록 표현식 인덱스 추가.
-- listBids 의 ORDER BY COALESCE(NULLIF(posted_at,''), created_at) DESC 와 식이 정확히 일치해야 사용된다.
CREATE INDEX IF NOT EXISTS ix_public_bid_notices_sort
  ON public_bid_notices ((COALESCE(NULLIF(posted_at, ''), created_at)) DESC);
CREATE INDEX IF NOT EXISTS ix_public_order_plans_sort
  ON public_order_plans ((COALESCE(NULLIF(posted_at, ''), created_at)) DESC);
CREATE INDEX IF NOT EXISTS ix_public_prior_specs_sort
  ON public_prior_specs ((COALESCE(NULLIF(posted_at, ''), created_at)) DESC);
