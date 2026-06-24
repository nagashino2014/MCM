-- 수행인력 변동 이력 + 기간별 참여비율 + 반기 평점. (성과급 산정의 기준 데이터, §6.6)
-- 029 위에 적용. 본부장(부서장) 권한으로 입력하며, admin 도 수정 가능.
-- 평점 척도는 0~5 (결정사항). 외주 인력은 미관리.

-- 1) 변동 이벤트 (append-only)
CREATE TABLE IF NOT EXISTS service_participation_changes (
  change_id          text PRIMARY KEY,
  contract_id        text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  employee_id        text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  change_kind        text NOT NULL,                  -- 'join' | 'leave' | 'role_change' | 'replace'
  effective_on       text NOT NULL,                  -- 변동 발효일 (YYYY-MM-DD)
  role_label_before  text,
  role_label_after   text,
  replaced_employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  reason             text,
  recorded_by        text REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at        text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spc_contract ON service_participation_changes(contract_id, effective_on);
CREATE INDEX IF NOT EXISTS idx_spc_employee ON service_participation_changes(employee_id, effective_on);

-- 2) 기간(스팬)별 참여 비율 (반기 평가용)
CREATE TABLE IF NOT EXISTS service_participation_spans (
  span_id            text PRIMARY KEY,
  contract_id        text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  employee_id        text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  role_label         text NOT NULL,
  span_from          text NOT NULL,                  -- YYYY-MM-DD
  span_to            text,                            -- NULL = 현재까지
  participation_pct  double precision NOT NULL DEFAULT 0,  -- 0~100
  is_auto_built      integer NOT NULL DEFAULT 1,      -- 1=자동, 0=본부장 수동 보정(자동 재계산 제외)
  recorded_by        text REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at        text NOT NULL,
  UNIQUE (contract_id, employee_id, role_label, span_from)
);

CREATE INDEX IF NOT EXISTS idx_sps_contract ON service_participation_spans(contract_id, span_from);
CREATE INDEX IF NOT EXISTS idx_sps_employee ON service_participation_spans(employee_id, span_from);

-- 3) 반기 평점 (본부장 직접 입력) — 척도 0~5
CREATE TABLE IF NOT EXISTS service_evaluations (
  evaluation_id      text PRIMARY KEY,
  contract_id        text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  employee_id        text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  period_year        integer NOT NULL,
  period_half        text NOT NULL,                  -- 'H1' | 'H2'
  participation_pct  double precision NOT NULL DEFAULT 0,  -- 반기 평균 참여도
  rating             double precision NOT NULL DEFAULT 0,  -- 0.0 ~ 5.0
  rating_memo        text,
  rated_by           text REFERENCES users(user_id) ON DELETE SET NULL,
  rated_at           text NOT NULL,
  finalized_at       text,                            -- 반기 마감 후 잠금
  UNIQUE (contract_id, employee_id, period_year, period_half)
);

CREATE INDEX IF NOT EXISTS idx_se_period   ON service_evaluations(period_year, period_half);
CREATE INDEX IF NOT EXISTS idx_se_employee ON service_evaluations(employee_id, period_year, period_half);
CREATE INDEX IF NOT EXISTS idx_se_contract ON service_evaluations(contract_id, period_year, period_half);
