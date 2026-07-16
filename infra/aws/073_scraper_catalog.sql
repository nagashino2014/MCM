-- 073: 범용 스크래퍼 — 가이드 분석 카탈로그 저장 컬럼
-- 가이드(docx/URL/원문)에서 추출한 "엔드포인트×요청변수×응답필드 카탈로그"를 소스에 보존한다.
-- 사용자는 이 카탈로그에서 엔드포인트/파라미터/응답필드를 취사선택해 api_profile·api_config를 조립한다.
-- (Web Scraper Final 의 data/APISet/{ORG}.json 을 DB jsonb 로 옮긴 것.)
-- 멱등: ADD COLUMN IF NOT EXISTS.

ALTER TABLE scraper_sources ADD COLUMN IF NOT EXISTS catalog jsonb;
