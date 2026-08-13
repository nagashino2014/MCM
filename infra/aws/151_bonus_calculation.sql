-- 성과급 산정 모듈 (docs/bonus-calculation-blueprint.md §3)
-- 반기 설정 · 용역별 제비용(영업비용) · 산정 스냅샷 · 유관부서 수기 배분 + service_evaluations 등급(A~E).
-- 외주금액은 저장하지 않는다 — contract_outsourcing(007) SUM(amount) 실시간 집계(수동 입력 불가 확정).

-- 1) 반기 설정: 적용비율·기여도·산정방식·절대평가 (반기당 1행)
CREATE TABLE IF NOT EXISTS bonus_period_settings (
  period_year integer NOT NULL,
  period_half text NOT NULL,                       -- 'H1' | 'H2'
  apply_rate double precision NOT NULL DEFAULT 4,  -- 매출액 중 적용 비율(%) 3.5~5
  contrib_support_pct double precision NOT NULL DEFAULT 0,  -- 지원/영업 기여도(%)
  contrib_exec_pct double precision NOT NULL DEFAULT 0,     -- 임원 기여도(%)
  dept_head_rates_json jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 본부장 비율 {dept_id: pct}
  calc_method text NOT NULL DEFAULT 'base',        -- 'base' | 'salary' | 'profit' (v1은 base만 동작)
  salary_apply_rate double precision,
  profit_apply_rate double precision,
  operating_profit double precision,
  absolute_grading integer NOT NULL DEFAULT 0,     -- 절대평가 옵션 on/off
  grade_cap_json jsonb NOT NULL DEFAULT '{}'::jsonb,        -- {"A":15,"B":20,...} 등급별 최대 비율(%)
  status text NOT NULL DEFAULT 'draft',            -- 'draft' | 'finalized'
  finalized_at text,
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at text NOT NULL,
  PRIMARY KEY (period_year, period_half)
);

-- 2) 용역별 제비용 — 영업비용만 수동 입력(계약 단위)
CREATE TABLE IF NOT EXISTS bonus_contract_costs (
  contract_id text PRIMARY KEY REFERENCES contracts(contract_id) ON DELETE CASCADE,
  sales_cost_amount double precision NOT NULL DEFAULT 0,    -- 영업비용
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at text NOT NULL
);

-- 3) 참여도·평점의 A~E 등급 (기존 rating 0~5 는 사장, participation_pct 는 계속 사용)
ALTER TABLE service_evaluations
  ADD COLUMN IF NOT EXISTS grade text;             -- 'A'~'E'

-- 4) 산정 결과 스냅샷 (일괄산정 시 반기 단위 재생성)
CREATE TABLE IF NOT EXISTS bonus_statements (
  statement_id text PRIMARY KEY,
  period_year integer NOT NULL,
  period_half text NOT NULL,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  bucket text NOT NULL DEFAULT 'participant',      -- 'participant' | 'dept_head' | 'support' | 'exec'
  total_amount double precision NOT NULL DEFAULT 0,
  prev_amount double precision,                    -- 전기 성과급(직전 반기 조회/임포트)
  calc_method text NOT NULL DEFAULT 'base',
  meta_json jsonb NOT NULL DEFAULT '{}'::jsonb,    -- 산정 파라미터 스냅샷
  calculated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  calculated_at text NOT NULL,
  UNIQUE (period_year, period_half, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_bonus_statements_period
  ON bonus_statements(period_year, period_half);
CREATE INDEX IF NOT EXISTS idx_bonus_statements_employee
  ON bonus_statements(employee_id, period_year, period_half);

CREATE TABLE IF NOT EXISTS bonus_statement_lines (
  line_id text PRIMARY KEY,
  statement_id text NOT NULL REFERENCES bonus_statements(statement_id) ON DELETE CASCADE,
  contract_id text REFERENCES contracts(contract_id) ON DELETE SET NULL,
  applied_amount double precision NOT NULL DEFAULT 0,       -- 제비용 반영 반기 발행액
  participation_pct double precision NOT NULL DEFAULT 0,
  grade text,
  grade_weight double precision,
  amount double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bonus_statement_lines_statement
  ON bonus_statement_lines(statement_id);

-- 5) 유관부서/임원 개별 수기 배분 (버킷 할당액 한도 내)
CREATE TABLE IF NOT EXISTS bonus_manual_allocations (
  allocation_id text PRIMARY KEY,
  period_year integer NOT NULL,
  period_half text NOT NULL,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  bucket text NOT NULL,                            -- 'support' | 'exec'
  amount double precision NOT NULL DEFAULT 0,
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at text NOT NULL,
  UNIQUE (period_year, period_half, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_bonus_manual_allocations_period
  ON bonus_manual_allocations(period_year, period_half, bucket);
