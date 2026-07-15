-- 071_public_bids.sql
-- 공공입찰(bid) sink: 범용 스크래퍼(scraper_sources.purpose='bid')로 수집한 나라장터(조달청)
-- 발주계획·사전규격·입찰공고를 종류별 테이블에 적재한다. 발주기관 중심 데이터라 intel_signals
-- (회사 중심)와 분리한다. 세 테이블은 동일 코어 스키마 + raw_json(종류별 원본/고유필드 흡수).
-- 어댑터(lib/bid/bid-sink.ts)가 sink_config.bid_type 으로 대상 테이블을 고른다. 070 위에 적용. 멱등.
--   external_id = 공고번호/식별번호(발주계획 orderPlanUntyNo, 사전규격 bfSpecRgstNo, 입찰공고 bidNtceNo 등).
--   UNIQUE(source_slug, external_id) = 재수집 멱등 축. deadline/posted_at 은 text(ISO 유사) — 목록 정렬·필터용.

-- 발주계획 (당해연도 조달 예정 공고)
CREATE TABLE IF NOT EXISTS public_order_plans (
  bid_id      text PRIMARY KEY,           -- 'pbid_' + hex
  source_slug text NOT NULL,              -- scraper_sources.slug
  external_id text NOT NULL,              -- 공고/식별번호
  org_name    text,                       -- 발주기관
  title       text,                       -- 사업명
  budget      bigint,                     -- 예산/예정가격(원)
  posted_at   text,                       -- 게시일(ISO 유사)
  deadline    text,                       -- 입찰마감(ISO 유사)
  method      text,                       -- 조달방식
  work_type   text,                       -- 업무구분(공사/물품/용역/외자)
  category    text,                       -- 분류
  url         text,                       -- 원문 링크
  raw_json    jsonb,                      -- 원본 item
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_public_order_plans_src_ext ON public_order_plans (source_slug, external_id);
CREATE INDEX IF NOT EXISTS ix_public_order_plans_deadline ON public_order_plans (deadline);
CREATE INDEX IF NOT EXISTS ix_public_order_plans_posted ON public_order_plans (posted_at DESC);

-- 사전규격 (규격 사전공개)
CREATE TABLE IF NOT EXISTS public_prior_specs (
  bid_id      text PRIMARY KEY,
  source_slug text NOT NULL,
  external_id text NOT NULL,
  org_name    text,
  title       text,
  budget      bigint,
  posted_at   text,
  deadline    text,
  method      text,
  work_type   text,
  category    text,
  url         text,
  raw_json    jsonb,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_public_prior_specs_src_ext ON public_prior_specs (source_slug, external_id);
CREATE INDEX IF NOT EXISTS ix_public_prior_specs_deadline ON public_prior_specs (deadline);
CREATE INDEX IF NOT EXISTS ix_public_prior_specs_posted ON public_prior_specs (posted_at DESC);

-- 입찰공고 (실제 입찰 공고)
CREATE TABLE IF NOT EXISTS public_bid_notices (
  bid_id      text PRIMARY KEY,
  source_slug text NOT NULL,
  external_id text NOT NULL,
  org_name    text,
  title       text,
  budget      bigint,
  posted_at   text,
  deadline    text,
  method      text,
  work_type   text,
  category    text,
  url         text,
  raw_json    jsonb,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_public_bid_notices_src_ext ON public_bid_notices (source_slug, external_id);
CREATE INDEX IF NOT EXISTS ix_public_bid_notices_deadline ON public_bid_notices (deadline);
CREATE INDEX IF NOT EXISTS ix_public_bid_notices_posted ON public_bid_notices (posted_at DESC);
