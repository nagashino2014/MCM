-- 133: 소스별 배치 실행 시각(사용자 요구 — 나라장터가 새벽 점검 시간대에 무응답이라 시간 조정 필요).
-- batch_hour(KST 0~23, 기본 7시)에 도달하면 next 서비스의 5분 틱이 수집을 1회 실행하고,
-- last_batch_date(KST YYYY-MM-DD)로 하루 1회 멱등을 보장한다.
-- 멱등: ADD COLUMN IF NOT EXISTS.

ALTER TABLE scraper_sources ADD COLUMN IF NOT EXISTS batch_hour integer;
ALTER TABLE scraper_sources ADD COLUMN IF NOT EXISTS last_batch_date text;
