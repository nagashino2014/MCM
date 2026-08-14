-- 162: 보험요율 설정 테이블 — 고용보험·장기요양 요율의 연도별 변동 대응 (2026-08-14 사용자 요청)
-- 배경: 건강보험·국민연금은 EDI 고지액 전기라 요율 인상이 자동 반영되지만,
--       자체 산정 2종(고용보험=과세급여×요율, 장기요양=건보료×요율)은 요율 변동 시 갱신이 필요.
-- 자동 업데이트: 장기요양은 EDI(건강보험 파일) 업로드 시 요양÷건보 비율 중앙값을 역산해
--       해당 연도 요율을 자동 upsert(source='edi-derived'). 고용보험은 법 개정이 드물어 수동 관리.
-- 우선순위: manual > edi-derived > seed (같은 kind·valid_from 에서 수동 입력이 자동 역산을 이긴다).
CREATE TABLE IF NOT EXISTS payroll_insurance_rates (
  rate_id text PRIMARY KEY,
  kind text NOT NULL,                  -- 'ei'(고용보험, 과세급여 대비) | 'ltc'(장기요양, 건보료 대비)
  valid_from text NOT NULL,            -- 적용 시작 'YYYY-MM'
  rate double precision NOT NULL,      -- %값 (ei: 0.9, ltc: 13.14)
  source text NOT NULL DEFAULT 'seed', -- 'seed' | 'edi-derived' | 'manual'
  note text,
  updated_at text NOT NULL DEFAULT now()::text,
  UNIQUE (kind, valid_from)
);

-- 시딩 — 실측·법정 이력(EDI_ANALYSIS.md §1)
INSERT INTO payroll_insurance_rates (rate_id, kind, valid_from, rate, source, note) VALUES
  ('ei-2000-01',  'ei',  '2000-01', 0.65,  'seed', '근로자 실업급여 부담분'),
  ('ei-2019-10',  'ei',  '2019-10', 0.8,   'seed', '2019.10 인상'),
  ('ei-2022-07',  'ei',  '2022-07', 0.9,   'seed', '2022.07 인상 — 현행'),
  ('ltc-2016-01', 'ltc', '2016-01', 6.55,  'seed', '건보료 대비'),
  ('ltc-2018-01', 'ltc', '2018-01', 7.38,  'seed', NULL),
  ('ltc-2019-01', 'ltc', '2019-01', 8.51,  'seed', NULL),
  ('ltc-2020-01', 'ltc', '2020-01', 10.25, 'seed', NULL),
  ('ltc-2021-01', 'ltc', '2021-01', 11.52, 'seed', NULL),
  ('ltc-2022-01', 'ltc', '2022-01', 12.27, 'seed', NULL),
  ('ltc-2023-01', 'ltc', '2023-01', 12.81, 'seed', NULL),
  ('ltc-2024-01', 'ltc', '2024-01', 12.95, 'seed', '2024~2025 동결'),
  ('ltc-2026-01', 'ltc', '2026-01', 13.14, 'seed', '2026 실측(대장 역산)')
ON CONFLICT (kind, valid_from) DO NOTHING;
