-- 급여·근로계약 PL-P0: 급여대장 코어 (docs/payroll-labor-contract-blueprint.md §2-1)
-- 과거 급여대장 엑셀(2016~2026, 3단 구조) 전수 DB화 + 앱 내 신규 대장 생성의 저장소.
-- 적재는 scripts/payroll_import/ 파이프라인이 수행(검증 리포트 사용자 검수 게이트 후).
-- 항목 사전은 119개 파일 헤더 전수조사 결과를 시딩 — 미지의 항목은 파이프라인이 자동 추가한다.

-- 1) 급여 항목 사전 — 표기 변형(그외공제↔기타공제 등)은 aliases 로 흡수
CREATE TABLE IF NOT EXISTS payroll_item_defs (
  item_id text PRIMARY KEY,
  name text NOT NULL UNIQUE,                       -- 정규화 명칭
  kind text NOT NULL,                              -- 'pay' | 'deduction'
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,      -- ["자격수당", ...] 표기 변형
  in_ordinary_wage integer NOT NULL DEFAULT 0,     -- 통상임금 산입(초과근무 시급 산정, §6)
  taxable integer,                                 -- 과세 여부(후속 명세서용, NULL=미정)
  display_order integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  note text,
  created_at text NOT NULL DEFAULT now()::text
);

-- 2) 월별 대장 — 한 달에 급여대장 + 별도 상여대장(명절 등) 복수 허용
CREATE TABLE IF NOT EXISTS payroll_ledgers (
  ledger_id text PRIMARY KEY,
  pay_year integer NOT NULL,
  pay_month integer NOT NULL,
  ledger_kind text NOT NULL DEFAULT 'salary',      -- 'salary' | 'bonus'(별도 상여) | 'intern'(인턴)
  title text,                                      -- 원본 제목 (예: '2026년 3월분 급상여대장')
  source text NOT NULL DEFAULT 'excel',            -- 'excel'(마이그레이션) | 'app'(앱 생성)
  source_file text,                                -- 원본 상대경로 (excel 전용)
  source_sha256 text,                              -- 원본 파일 해시 (재적재 멱등 판단)
  status text NOT NULL DEFAULT 'confirmed',        -- 'draft' | 'confirmed' (엑셀분은 confirmed)
  note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  UNIQUE (pay_year, pay_month, ledger_kind)
);
CREATE INDEX IF NOT EXISTS idx_payroll_ledgers_ym ON payroll_ledgers(pay_year, pay_month);

-- 3) 직원×대장 1행 — 퇴사자 등 미매칭 인원은 employee_id NULL + 스냅샷만 보존
CREATE TABLE IF NOT EXISTS payroll_entries (
  entry_id text PRIMARY KEY,
  ledger_id text NOT NULL REFERENCES payroll_ledgers(ledger_id) ON DELETE CASCADE,
  employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  emp_no text,                                     -- 원본 사원번호 스냅샷
  name text NOT NULL,                              -- 원본 성명 스냅샷
  dept_name text,                                  -- 당시 부서 스냅샷
  position_name text,                              -- 당시 직급 스냅샷
  hired_at text,                                   -- 원본 입사일 스냅샷
  resigned_at text,                                -- 원본 퇴사일 스냅샷 (대장이 유일한 소스인 경우 有)
  pay_total double precision NOT NULL DEFAULT 0,       -- 원본 지급합계(검증 기준값)
  deduction_total double precision NOT NULL DEFAULT 0, -- 원본 공제합계(검증 기준값)
  net_pay double precision NOT NULL DEFAULT 0,         -- 원본 차인지급액(검증 기준값)
  row_order integer NOT NULL DEFAULT 0,
  note text                                        -- 파싱 검증 불일치 등 기록
);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_ledger ON payroll_entries(ledger_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_employee ON payroll_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_name ON payroll_entries(name);

-- 4) 항목별 금액 라인 — 0/공란은 행을 만들지 않는다
CREATE TABLE IF NOT EXISTS payroll_entry_lines (
  line_id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES payroll_entries(entry_id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES payroll_item_defs(item_id),
  amount double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payroll_entry_lines_entry ON payroll_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entry_lines_item ON payroll_entry_lines(item_id);

-- 5) 항목 사전 시딩 — 전수조사 결과(지급 ~21종 + 계약서 전용 5종 + 공제 19종)
--    in_ordinary_wage: 고정성 수당(기본급·식대·자격증수당·연구수당·업무수당) 산입 확정(§8-9)
INSERT INTO payroll_item_defs (item_id, name, kind, aliases, in_ordinary_wage, display_order) VALUES
  -- 지급 (대장 등장 순위순)
  ('base',          '기본급',             'pay', '[]'::jsonb,                          1, 10),
  ('bonus',         '상여',               'pay', '[]'::jsonb,                          0, 20),
  ('prev-unpaid',   '전월미지급금',       'pay', '[]'::jsonb,                          0, 30),
  ('meal',          '식대',               'pay', '[]'::jsonb,                          1, 40),
  ('overtime',      '초과근무수당',       'pay', '[]'::jsonb,                          0, 50),
  ('annual-leave',  '연차수당',           'pay', '[]'::jsonb,                          0, 60),
  ('incentive',     '성과급',             'pay', '[]'::jsonb,                          0, 70),
  ('cert',          '자격증수당',         'pay', '["자격수당"]'::jsonb,                1, 80),
  ('research',      '연구수당',           'pay', '[]'::jsonb,                          1, 90),
  ('comm',          '통신비',             'pay', '[]'::jsonb,                          0, 100),
  ('trip-lodging',  '출장숙박수당',       'pay', '["숙박수당"]'::jsonb,                0, 110),
  ('expert',        '전문가활동비',       'pay', '[]'::jsonb,                          0, 120),
  ('housing',       '주거비지원',         'pay', '[]'::jsonb,                          0, 130),
  ('vehicle',       '차량유지비',         'pay', '[]'::jsonb,                          0, 140),
  ('misc-pay',      '기타수당',           'pay', '[]'::jsonb,                          0, 150),
  ('trip',          '출장수당',           'pay', '[]'::jsonb,                          0, 160),
  ('childcare',     '육아수당',           'pay', '["양육수당"]'::jsonb,                0, 170),
  ('region',        '지방파견비',         'pay', '["지방파견수당"]'::jsonb,            0, 180),
  ('overtime-meal', '초과근무 식대',      'pay', '["초과근무식대"]'::jsonb,            0, 190),
  ('expense-settle','정산 경비',          'pay', '["정산경비"]'::jsonb,                0, 200),
  ('key-talent',    '핵심인력성과보상금', 'pay', '["핵심인력성과보상금_일반"]'::jsonb, 0, 210),
  -- 무라벨 셀 값 보존용 — 과거 대장에서 라벨 없는 칸에 기입된 금액(원본 위치는 entry.note)
  ('unlabeled-pay', '미상 지급',          'pay', '[]'::jsonb,                          0, 215),
  ('unlabeled-ded', '미상 공제',          'deduction', '[]'::jsonb,                    0, 690),
  -- 계약서 임금 구성표 전용(§1-2) — 대장 미등장, wage_components 라벨용
  ('duty-allow',    '업무수당',           'pay', '[]'::jsonb,                          1, 220),
  ('fixed-ot',      '고정연장수당',       'pay', '[]'::jsonb,                          0, 230),
  ('fixed-holiday', '고정휴일수당',       'pay', '[]'::jsonb,                          0, 240),
  ('fixed-night',   '고정야간수당',       'pay', '[]'::jsonb,                          0, 250),
  -- 공제
  ('nps',           '국민연금',           'deduction', '[]'::jsonb,                                        0, 500),
  ('nhis',          '건강보험',           'deduction', '[]'::jsonb,                                        0, 510),
  ('ei',            '고용보험',           'deduction', '[]'::jsonb,                                        0, 520),
  ('ltc',           '장기요양보험료',     'deduction', '["장기요양보험"]'::jsonb,                          0, 530),
  ('income-tax',    '소득세',             'deduction', '[]'::jsonb,                                        0, 540),
  ('local-tax',     '지방소득세',         'deduction', '[]'::jsonb,                                        0, 550),
  ('farm-tax',      '농특세',             'deduction', '[]'::jsonb,                                        0, 560),
  ('settle-nps',    '정산-국민연금',      'deduction', '["국민연금정산"]'::jsonb,                          0, 570),
  ('settle-nhis',   '정산-건강보험',      'deduction', '["건강보험정산"]'::jsonb,                          0, 580),
  ('settle-ei',     '정산-고용보험',      'deduction', '["고용보험정산"]'::jsonb,                          0, 590),
  ('settle-ltc',    '정산-장기요양',      'deduction', '["장기요양정산"]'::jsonb,                          0, 600),
  ('settle-income', '정산-근로소득세',    'deduction', '[]'::jsonb,                                        0, 610),
  ('settle-local',  '정산-지방소득세',    'deduction', '[]'::jsonb,                                        0, 620),
  ('yearend-income','연말정산소득세',     'deduction', '["연말정산 소득세"]'::jsonb,                       0, 630),
  ('yearend-local', '연말정산지방소득세', 'deduction', '["연말정산 지방소득세"]'::jsonb,                   0, 640),
  ('yearend-farm',  '연말정산농특세',     'deduction', '["연말정산 농특세"]'::jsonb,                       0, 650),
  ('advance-ded',   '선지급분공제',       'deduction', '["공제_선지급분"]'::jsonb,                         0, 660),
  ('misc-ded',      '기타공제',           'deduction', '["그외공제"]'::jsonb,                              0, 670),
  ('student-loan',  '학자금상환공제',     'deduction', '["공제_학자금상환","공제-학자금상환(기타공제)"]'::jsonb, 0, 680)
ON CONFLICT (item_id) DO NOTHING;
