-- 070_scraper_sources.sql
-- 범용 API 스크래퍼 프레임워크(EcoMonitor 이식): 임의 REST/JSON API 소스를 UI에서 등록하고
-- API Profile을 LLM이 자동 생성해 수집한다. 수집 결과의 적재 대상(sink)은 purpose로 구분 —
-- 'intel'(기존 intel_signals 파이프라인) / 'bid'(추후 공공입찰·나라장터) 등. 실행 코어는 sink 무관.
--   scraper_sources   = 기관(소스). api_profile(auth/endpoints/response_mapping) = LLM 생성물.
--   scraper_endpoints = 타겟(엔드포인트). api_config(호출 파라미터/페이지네이션) + field_mapping(응답→표준필드).
-- intel_signals.source 는 CHECK 없음 → 'custom:'||slug 값을 스키마 변경 없이 저장. 069 위에 적용. 멱등.

CREATE TABLE IF NOT EXISTS scraper_sources (
  source_id   text PRIMARY KEY,             -- 'ssrc_' + hex
  slug        text NOT NULL,                -- intel_signals.source = 'custom:'||slug 로 파생
  name        text NOT NULL,
  base_url    text,
  purpose     text NOT NULL DEFAULT 'intel', -- 적재 sink 구분: 'intel' | 'bid' | ...
  api_profile jsonb,                          -- LLM 생성: auth/endpoints/default_params/response_mapping/constraints/status
  enabled     integer NOT NULL DEFAULT 0,     -- 야간 배치 대상 여부(0/1)
  created_at  text NOT NULL,
  updated_at  text NOT NULL,
  updated_by  text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_scraper_sources_slug ON scraper_sources (slug);
CREATE INDEX IF NOT EXISTS ix_scraper_sources_purpose ON scraper_sources (purpose, enabled);

CREATE TABLE IF NOT EXISTS scraper_endpoints (
  endpoint_id   text PRIMARY KEY,           -- 'sep_' + hex
  source_id     text NOT NULL REFERENCES scraper_sources(source_id) ON DELETE CASCADE,
  name          text NOT NULL,
  api_config    jsonb,                        -- 호출: endpoint path/params/pagination/response 배열 경로/필터
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb, -- 응답 item → 표준필드 getNestedValue 경로(sink별 필드셋)
  sink_config   jsonb,                        -- intel: {signal_type, signal_grade(기본 monitoring), use_llm_classify}
  enabled       integer NOT NULL DEFAULT 0,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_scraper_endpoints_source ON scraper_endpoints (source_id);
CREATE INDEX IF NOT EXISTS ix_scraper_endpoints_enabled ON scraper_endpoints (enabled);
