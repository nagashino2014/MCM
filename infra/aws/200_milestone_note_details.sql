-- 200: 어음 수금 상세 — 단계별 어음 정보 입력 그릇 + 만기일 기반 수금 자동대조 근거
-- 배경: 어음 만기 입금은 ① 입금자명에 발주처가 없고(어음 교환소·은행 명의) ② 어음 수수료·담보대출
--       이자 차감으로 계산서 금액과도 어긋나 자동대조가 구조적으로 실패한다.
--       사용자가 어음 취급 은행·발행일·만기일·수수료·대출 이자를 입력해 두면, 대조 엔진이
--       만기일(또는 대출 실행일) 근처의 입금을 금액 차감 허용 범위 안에서 후보로 제안할 수 있다.
-- 회계: 어음 수수료·대출 이자는 소액이라도 결산에 반드시 반영해야 하는 비용이므로 단계에 귀속해 남긴다.

ALTER TABLE contract_payment_milestones
  ADD COLUMN IF NOT EXISTS note_bank text,                    -- 어음 취급 은행
  ADD COLUMN IF NOT EXISTS note_issued_date text,             -- 어음 발행일 YYYY-MM-DD
  ADD COLUMN IF NOT EXISTS note_maturity_date text,           -- 어음 만기일 YYYY-MM-DD
  ADD COLUMN IF NOT EXISTS note_fee numeric,                  -- 어음 수수료(추심료 등, 존재 시)
  ADD COLUMN IF NOT EXISTS note_loan_interest_rate numeric,   -- 어음 담보 대출 이자율(%)
  ADD COLUMN IF NOT EXISTS note_loan_interest_amount numeric, -- 어음 담보 대출 이자액
  ADD COLUMN IF NOT EXISTS note_loan_executed_date text;      -- 대출 실행일 YYYY-MM-DD (만기 전 현금화 시)

-- 만기일/대출실행일 근처 입금 탐색용 (대조 엔진이 날짜 창으로 조회)
CREATE INDEX IF NOT EXISTS idx_milestone_note_maturity
  ON contract_payment_milestones(note_maturity_date)
  WHERE note_maturity_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_milestone_note_loan_exec
  ON contract_payment_milestones(note_loan_executed_date)
  WHERE note_loan_executed_date IS NOT NULL;
