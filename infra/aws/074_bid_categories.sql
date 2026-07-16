-- 074: 공공입찰 용역 분류 설정 — 분류별 검색 키워드(사업명 매칭)
-- 예: 통합허가 = ["통합환경","통합허가"] → 발주계획/사전규격/입찰공고의 title 키워드 OR 검색.
-- 향후 사업분야 매칭 자동알림(모바일)의 판별 기준으로 재사용한다.
-- 멱등: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS bid_categories (
  category_id text PRIMARY KEY,           -- 'bcat_' + hex
  name        text NOT NULL,              -- 분류명(예: 통합허가)
  keywords    jsonb NOT NULL DEFAULT '[]'::jsonb, -- 검색 키워드 배열
  enabled     integer NOT NULL DEFAULT 1,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  text,
  updated_at  text
);
