-- 076: 공공입찰 목록 커스텀 열 구성 — 탭(종류)별로 표시할 열을 사용자가 구성한다.
-- columns jsonb = [{ "label": "발주시기", "parts": ["orderYear","orderMnth"], "mode": "join",
--                    "sep": "/", "format": "text" }, ...]
--   mode: single(첫 값) | join(구분자 결합) | calc(사칙연산, op: +|-|*|/)
--   format: text | money | date | link — 렌더 형식. parts 는 raw_json 필드 또는 표준 컬럼명.
-- 구성이 없으면 코드 기본 열을 사용한다. 멱등: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS bid_view_configs (
  bid_type   text PRIMARY KEY,             -- order_plan | prior_spec | bid_notice
  columns    jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at text,
  updated_by text
);
