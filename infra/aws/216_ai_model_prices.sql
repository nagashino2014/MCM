-- 216: Claude 모델 단가표 — docs/ai-api-usage-management-blueprint.md §3.2·§3.6 (P0 시드, P1 화면 편집).
-- 게이트웨이가 호출당 비용(USD)을 계산할 때 참조한다(5분 캐시, 조회 실패 시 코드 상수 폴백).
-- 적용일(effective_from)별 행을 두어 단가 변경 이력을 보존한다 — 모델별 최신 적용일 행이 현재 단가.
-- 시드는 ON CONFLICT DO NOTHING — 관리 화면에서 고친 값을 재적용이 덮지 않는다.
-- 멱등.

CREATE TABLE IF NOT EXISTS ai_model_prices (
  model_family          text NOT NULL,           -- 정규형 모델 ID(날짜 접미사 없음)
  effective_from        date NOT NULL DEFAULT CURRENT_DATE,
  display_name          text NOT NULL,
  input_per_mtok        numeric(10,4) NOT NULL,  -- USD / 1M 토큰
  cache_write_per_mtok  numeric(10,4) NOT NULL,
  cache_read_per_mtok   numeric(10,4) NOT NULL,
  output_per_mtok       numeric(10,4) NOT NULL,
  supports_vision       integer NOT NULL DEFAULT 1,   -- 이미지·PDF 입력 가능
  context_tokens        integer NOT NULL DEFAULT 200000,
  selectable            integer NOT NULL DEFAULT 1,   -- 기능별 모델 셀렉트 노출 여부(P1)
  deprecated_at         date,
  note                  text,
  updated_at            text NOT NULL DEFAULT now()::text,
  PRIMARY KEY (model_family, effective_from)
);

-- 2026-06 공시 단가(Anthropic 1st-party). 캐시 쓰기=입력×1.25, 캐시 읽기=입력×0.1.
INSERT INTO ai_model_prices
  (model_family, effective_from, display_name, input_per_mtok, cache_write_per_mtok, cache_read_per_mtok, output_per_mtok, supports_vision, context_tokens, selectable, note)
VALUES
  ('claude-haiku-4-5',  DATE '2026-01-01', 'Claude Haiku 4.5',  1.00, 1.25,  0.10,  5.00, 1,  200000, 1, '분류·요약·비전 파싱 기본'),
  ('claude-sonnet-4-6', DATE '2026-01-01', 'Claude Sonnet 4.6', 3.00, 3.75,  0.30, 15.00, 1, 1000000, 0, '구세대 — 선택 비노출'),
  ('claude-sonnet-5',   DATE '2026-01-01', 'Claude Sonnet 5',   2.00, 2.50,  0.20, 10.00, 1, 1000000, 1, 'thinking 기본 활성 — 출력 토큰에 포함 과금'),
  ('claude-opus-4-8',   DATE '2026-01-01', 'Claude Opus 4.8',   5.00, 6.25,  0.50, 25.00, 1, 1000000, 1, NULL),
  ('claude-opus-5',     DATE '2026-01-01', 'Claude Opus 5',     5.00, 6.25,  0.50, 25.00, 1, 1000000, 1, NULL),
  ('claude-fable-5-1',  DATE '2026-01-01', 'Claude Fable 5.1', 10.00, 12.50, 0.25, 50.00, 1, 1000000, 0, '최상위 — 단가 상위, 선택 비노출')
ON CONFLICT (model_family, effective_from) DO NOTHING;

COMMENT ON TABLE ai_model_prices IS 'Claude 모델 단가(USD/1M tok) — ai_usage_log.cost_usd 산출 근거. 적용일별 이력';
