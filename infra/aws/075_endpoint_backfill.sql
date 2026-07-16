-- 075: 범용 스크래퍼 — 엔드포인트 백필(과거 데이터 대량 수집) 상태
-- 기간(from~to)을 월 단위 청크로 끊어 순차 수집한다. cursor 로 중단 재개, 야간배치가 이어서 진행.
-- { "from": "2025-01", "to": "2025-12", "cursor": "2025-04", "status": "running|done|idle",
--   "chunk_months": 1, "updated_at": "...", "last_result": { ... } }
-- 멱등: ADD COLUMN IF NOT EXISTS.

ALTER TABLE scraper_endpoints ADD COLUMN IF NOT EXISTS backfill jsonb;
