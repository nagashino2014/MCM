-- 059_intel_signals.sql
-- API & RAG 1차: 외부 신호(투자·증설·신설 등 발주 관련) 수집 저장소. 1차 소스=DART 전자공시.
-- 058 위에 적용. 멱등. facilities/sales_projects 참조, 고지는 기존 alerts 재사용.
-- 2차(뉴스)는 source='news' + 분석단계(candidate/detailed)·요약/본문 필드를 별도 마이그레이션으로 추가 예정.

CREATE TABLE IF NOT EXISTS intel_signals (
  signal_id         text PRIMARY KEY,
  source            text NOT NULL,                        -- 'dart' (2차: 'news')
  external_id       text NOT NULL,                        -- DART rcept_no 등 원본 고유 ID
  corp_code         text,                                 -- DART 고유번호
  company_name      text,
  brn               text,                                 -- 사업자등록번호(매칭키)
  report_name       text,                                 -- 공시 보고서명
  signal_type       text NOT NULL DEFAULT 'other',        -- investment/expansion/new_site/other
  disclosed_at      text,                                 -- 공시일(ISO)
  amount            bigint,                               -- 금액(원, 본문 파싱 후속)
  url               text,                                 -- 공시 원문 URL
  raw_json          jsonb,                                -- 원본 응답(2차 확장 여지)
  facility_id       text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  match_status      text NOT NULL DEFAULT 'unmatched',    -- matched/unmatched/ignored
  linked_project_id text REFERENCES sales_projects(project_id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'new',          -- new/reviewed/converted/dismissed
  created_at        text NOT NULL,
  updated_at        text NOT NULL
);

-- 중복 수집 방지(같은 소스의 같은 원본 ID는 1건)
CREATE UNIQUE INDEX IF NOT EXISTS ux_intel_signals_source_external
  ON intel_signals (source, external_id);
CREATE INDEX IF NOT EXISTS ix_intel_signals_match_status ON intel_signals (match_status);
CREATE INDEX IF NOT EXISTS ix_intel_signals_status       ON intel_signals (status);
CREATE INDEX IF NOT EXISTS ix_intel_signals_disclosed_at ON intel_signals (disclosed_at);
CREATE INDEX IF NOT EXISTS ix_intel_signals_facility     ON intel_signals (facility_id);

-- match_status / status 값 제약(멱등 재적용)
ALTER TABLE intel_signals DROP CONSTRAINT IF EXISTS intel_signals_match_status_check;
ALTER TABLE intel_signals ADD  CONSTRAINT intel_signals_match_status_check
  CHECK (match_status IN ('matched','unmatched','ignored'));
ALTER TABLE intel_signals DROP CONSTRAINT IF EXISTS intel_signals_status_check;
ALTER TABLE intel_signals ADD  CONSTRAINT intel_signals_status_check
  CHECK (status IN ('new','reviewed','converted','dismissed'));

-- 증분 수집 상태(소스별 마지막 수집 기준)
CREATE TABLE IF NOT EXISTS intel_collect_state (
  source       text PRIMARY KEY,
  last_run_at  text,
  last_cursor  text,          -- 마지막 수집 기준(예: 공시일 YYYYMMDD)
  updated_at   text NOT NULL
);
