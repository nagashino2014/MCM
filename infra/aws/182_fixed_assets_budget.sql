-- 182_fixed_assets_budget.sql
-- 회계 확충 P6: 고정자산 대장·상각(A) + 운행기록부(B) + 계정과목별 연간 예산(C)
-- 블루프린트: docs/accounting-expansion-blueprint.md §5 P6
-- 실측 근거(2024·2025 결산 원장 백테스트): 세무법인은 월할 상각 기표(2025 기계 207 매월 247,391원),
--   누계액 계정 = 203 건물 / 207 기계 / 209 차량 / 213 비품(178 계정 체계와 정합).
-- 멱등: CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING

-- ─────────────────────────────────────────────
-- 1. 고정자산 대장
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fixed_assets (
  fa_id             text PRIMARY KEY,           -- 'fa-' + hash
  name              text NOT NULL,
  category          text NOT NULL CHECK (category IN ('building', 'machine', 'vehicle', 'fixture')),
                                                -- 취득 202/206/208/212 · 누계액 203/207/209/213
  acquisition_date  text NOT NULL,              -- YYYY-MM-DD
  acquisition_cost  bigint NOT NULL,
  method            text NOT NULL DEFAULT 'straight' CHECK (method IN ('straight', 'declining')),
                                                -- 건물은 세법상 정액 강제 — 앱 계층에서 안내
  useful_life_years integer NOT NULL,
  residual_value    bigint NOT NULL DEFAULT 1000, -- 비망가액(전액 상각 후 1,000원 잔존)
  opening_accum     bigint NOT NULL DEFAULT 0,  -- 시스템 개시 시점 기왕 상각누계(세무법인 명세서 인수)
  opening_as_of     text,                       -- 기초 기준일 — 이 날이 속한 달의 다음 달부터 앱이 상각 기표
  disposed_at       text,                       -- 처분(매각·폐기)일 — 처분월부터 상각 중단(처분 손익 분개는 수동)
  disposal_memo     text,
  linked_asset_id   text,                       -- reservable_assets 연동(법인 소유 차량)
  memo              text,
  is_active         integer NOT NULL DEFAULT 1,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_active ON fixed_assets(is_active, category);

-- 정률법 상각률 (법인세법 시행규칙 별표 — 내용연수별. 개정 시 행 추가/갱신)
CREATE TABLE IF NOT EXISTS depreciation_rates (
  years integer PRIMARY KEY,
  declining_rate numeric NOT NULL
);
INSERT INTO depreciation_rates (years, declining_rate) VALUES
  (2, 0.777), (3, 0.632), (4, 0.528), (5, 0.451), (6, 0.394),
  (8, 0.313), (10, 0.259), (12, 0.221), (15, 0.182), (20, 0.140)
ON CONFLICT (years) DO NOTHING;

-- ─────────────────────────────────────────────
-- 2. 운행기록부 (업무용승용차 — 출장신청서 파생 초안 + 수동 보완)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_trip_logs (
  log_id          text PRIMARY KEY,             -- 'vtl-' + hash
  asset_id        text NOT NULL REFERENCES reservable_assets(asset_id) ON DELETE CASCADE,
  drive_date      text NOT NULL,                -- YYYY-MM-DD
  driver_user_id  text,
  driver_name     text,                         -- 문서 파생 시 기안자명 스냅(퇴사자 대비)
  use_kind        text NOT NULL DEFAULT 'business', -- business / commute(출퇴근) / etc
  purpose         text,                         -- 출장지·용무
  distance_km     numeric,                      -- 주행거리(km) — 문서 파생 초안은 null(수기 보완)
  doc_id          text,                         -- 출장신청서 doc (파생분)
  source          text NOT NULL DEFAULT 'manual', -- trip_doc / manual
  memo            text,
  created_at      text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at      text
);
-- 문서 파생 dedup: 같은 문서·차량·일자 1행 (재동기화 시 중복 방지)
CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicle_trip_doc ON vehicle_trip_logs(asset_id, drive_date, doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_trip_asset_date ON vehicle_trip_logs(asset_id, drive_date);

-- ─────────────────────────────────────────────
-- 3. 계정과목(경비 카테고리)별 연간 예산 — 1차는 전사, org_unit_id 는 부서별 확장용
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_lines (
  budget_id     text PRIMARY KEY,               -- 'bg-' + hash
  year          integer NOT NULL,
  org_unit_id   text,                           -- null = 전사 (부서별은 후속)
  category_key  text NOT NULL,                  -- expense_categories.category_key
  amount        bigint NOT NULL,
  memo          text,
  created_at    text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at    text,
  UNIQUE (year, org_unit_id, category_key)
);
