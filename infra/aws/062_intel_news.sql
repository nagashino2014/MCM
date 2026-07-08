-- 062_intel_news.sql
-- 발주 신호 2차 소스: 뉴스(source='news'). 네이버 뉴스 검색 API + Haiku 분류.
-- 059 예고분(2차 뉴스: 분석단계 candidate/detailed·요약/본문). 061 위에 적용. 멱등.
-- 신설=new_site+unmatched(신규 리드) / 증설=expansion+matched(facilities 매칭) 2트랙을 기존 컬럼으로 표현.

ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS news_stage text;   -- candidate/detailed (뉴스 2중구조 분석단계)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS summary    text;   -- Haiku 구조화 요약(한 줄)
ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS press      text;   -- 언론사/출처(도메인)
-- 뉴스 위치·규모·원문 등 상세는 raw_json 에 저장. company_name/url(link)/disclosed_at(pubDate)/
-- report_name(title)/signal_type/signal_grade/match_status(트랙)/match_type 은 기존 컬럼 재사용.

ALTER TABLE intel_signals DROP CONSTRAINT IF EXISTS intel_signals_news_stage_check;
ALTER TABLE intel_signals ADD  CONSTRAINT intel_signals_news_stage_check
  CHECK (news_stage IS NULL OR news_stage IN ('candidate','detailed'));

CREATE INDEX IF NOT EXISTS ix_intel_signals_news_stage ON intel_signals (news_stage);
