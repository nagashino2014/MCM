-- 161: 급여 PL-P4 코어 — 수당 지급 규칙·EDI 고지내역·간이세액표·직원 원천징수 설정
-- (docs/payroll-labor-contract-blueprint.md §6-2, 조사 근거 scripts/payroll_import/EDI_ANALYSIS.md)
-- 공제 산정 소스(실증 확정):
--   국민연금 = EDI 연금 결정보험료÷2 / 건강·장기요양 = EDI 건보 산출보험료(정산은 정산보험료 열)
--   고용보험 = 당월 과세급여×요율(자체 산정) / 지방소득세 = 소득세×10% 10원 절사
--   소득세 = 간이세액표 lookup(공제대상가족수·80/100/120% 개인 옵션)

-- 1) 수당·공제 지급 규칙 (§6-2 A 6종 + 학자금상환공제) — 대장 생성 시 귀속월에 유효한 규칙 자동 반영
CREATE TABLE IF NOT EXISTS payroll_pay_rules (
  rule_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES payroll_item_defs(item_id),  -- cert/housing/trip-lodging/childcare/longevity/상여·student-loan 등
  amount double precision NOT NULL,
  valid_from text,                                 -- 'YYYY-MM' 포함 시작(NULL=제한 없음)
  valid_to text,                                   -- 'YYYY-MM' 포함 종료(NULL=계속)
  pay_months jsonb,                                -- 지급월 제한(명절상여 등): [1,9] / NULL=매월
  meta jsonb,                                      -- 자격증명·자녀명·학자금 총액/잔액 등 항목별 부가정보
  note text,
  is_active integer NOT NULL DEFAULT 1,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payroll_pay_rules_emp ON payroll_pay_rules(employee_id, is_active);

-- 2) EDI 고지내역 — 웹EDI 개인별 고지산출내역 CSV(cp949) 업로드 원본. 귀속월=고지월(실증).
CREATE TABLE IF NOT EXISTS payroll_edi_notices (
  notice_id text PRIMARY KEY,
  pay_year integer NOT NULL,
  pay_month integer NOT NULL,
  insurer text NOT NULL,                           -- 'nhis'(건강+요양 파일) | 'nps'(연금 파일)
  employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  name text NOT NULL,                              -- CSV 성명 스냅샷(매칭 실패 시에도 보존)
  rrn_prefix text,                                 -- 주민번호 앞 6자리(동명이인 매칭 보조)
  bosu_wolak double precision,                     -- 보수월액(건보 파일)
  amounts jsonb NOT NULL,                          -- nhis: {nhis:{calc,settle,notice},ltc:{calc,settle,notice}} / nps: {total}
  source_file text,
  created_at text NOT NULL,
  UNIQUE (pay_year, pay_month, insurer, name)
);
CREATE INDEX IF NOT EXISTS idx_payroll_edi_notices_ym ON payroll_edi_notices(pay_year, pay_month, insurer);

-- 3) 근로소득 간이세액표 — 국세청 고시(개정 시 year_version 증가, 기존 행 불변). 월급여 구간×공제대상가족수.
CREATE TABLE IF NOT EXISTS income_tax_brackets (
  bracket_id text PRIMARY KEY,
  year_version integer NOT NULL,                   -- 시행 개정 연도(예: 2024 — 2024.03 개정분)
  wage_from double precision NOT NULL,             -- 월급여 하한(이상, 원)
  wage_to double precision,                        -- 월급여 상한(미만, 원) — 최상단 구간은 NULL(산식 적용)
  dependents integer NOT NULL,                     -- 공제대상 가족수(본인 포함) 1~11
  tax double precision NOT NULL                    -- 표상 소득세(100% 기준, 원)
);
CREATE INDEX IF NOT EXISTS idx_income_tax_brackets ON income_tax_brackets(year_version, dependents, wage_from);

-- 4) 직원 원천징수 설정 — 비율은 연말정산 시 개인 선택 값(§6-2, 2026-08-14 확정)
CREATE TABLE IF NOT EXISTS payroll_tax_profiles (
  employee_id text PRIMARY KEY REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  withholding_rate integer NOT NULL DEFAULT 100,   -- 80 | 100 | 120 (%)
  dependents integer NOT NULL DEFAULT 1,           -- 공제대상 가족수(본인 포함) — 간이세액표 축
  child_deduction integer NOT NULL DEFAULT 0,      -- 8세이상 20세이하 자녀수(간이세액표 가족수 가산)
  dependents_detail jsonb,                         -- [{relation:'3',name,rrnPrefix,basicDeduction:true}] 공제신고서 파싱분
  source text,                                     -- 'tax-form-import'(공제신고서 엑셀) | 'manual'
  note text,
  updated_at text NOT NULL
);
