-- 183_trip_distance.sql
-- 운행기록부 거리 자동 추정 (P6-B 보강, 사용자 확정 2026-08-17):
--   출장 문서 동기화 시 사무소(기안자 소속: 본사/과천/울산) ↔ 출장지의 실도로 거리를
--   카카오모빌리티 길찾기로 산출해 초안에 채운다(추정 표기, 수기 수정 시 해제).
--   기아 커넥트 연동은 비공식 API 리스크로 채택하지 않음.
-- 멱등: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS

ALTER TABLE vehicle_trip_logs ADD COLUMN IF NOT EXISTS distance_estimated integer NOT NULL DEFAULT 0;

-- 경로 캐시 — 같은 사무소·출장지 조합은 재조회하지 않는다(API 호출 절약)
CREATE TABLE IF NOT EXISTS trip_route_cache (
  route_key       text PRIMARY KEY,   -- office_key + ':' + 목적지 정규화
  office_key      text NOT NULL,      -- main / gwacheon / ulsan
  destination_raw text NOT NULL,
  resolved_addr   text,               -- 지오코딩 결과 주소(검수용)
  distance_m      integer NOT NULL,   -- 편도 실도로 거리(m)
  duration_s      integer,
  cached_at       text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);
