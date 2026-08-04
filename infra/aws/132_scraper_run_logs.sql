-- 132: 커스텀 API 소스 수집 실행 로그(사용자 요구 — 야간배치가 실제로 돌았는지 화면에서 확인 불가 문제).
-- 야간배치(intel-batch)·수동 수집·백필이 엔드포인트 1회 실행마다 1행을 남긴다.
-- 소스 화면의 "야간배치 실행 로그" 카드가 최근 5일 내역(성공/실패·수집 건수·실행 시각)을 보여준다.
-- 관례: 타임스탬프 text(ISO), 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS scraper_run_logs (
  run_id      text PRIMARY KEY,
  source_id   text NOT NULL,
  source_slug text NOT NULL,
  endpoint_id text,
  endpoint_name text,
  trigger     text NOT NULL,            -- batch | manual | backfill
  status      text NOT NULL,            -- success | error
  scanned     integer NOT NULL DEFAULT 0,
  inserted    integer NOT NULL DEFAULT 0,
  updated     integer NOT NULL DEFAULT 0,
  error       text,
  started_at  text NOT NULL,
  finished_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scraper_run_logs_source ON scraper_run_logs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_run_logs_started ON scraper_run_logs(started_at);
