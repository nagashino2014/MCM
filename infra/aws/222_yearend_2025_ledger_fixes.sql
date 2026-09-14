-- 222_yearend_2025_ledger_fixes.sql
-- 2025 귀속 연말정산 대사(docs/yearend-2025-reconciliation.md §3)에서 확인된 급여대장 적재 오류 교정 + 프로필 보강.
-- 원본 대장의 기입 관행이 원인이라 임포터 오버라이드(scripts/payroll_import/import_payroll.py)와 짝을 이룬다.
-- 멱등: 조건이 사라지면 재실행해도 0행.

-- ─────────────────────────────────────────────
-- 1. 2025년 2월 대장 '정산-건강보험'/'정산-국민연금' 열 = 2024 귀속 연말정산 소득세/지방소득세 환급(추납).
--    같은 직원 행에 두 값이 있고 두 번째가 첫 번째의 10%(±1%+10원)인 쌍만 연말정산 항목으로 바꾼다.
-- ─────────────────────────────────────────────
WITH pairs AS (
  SELECT a.line_id AS nhis_line, b.line_id AS nps_line
    FROM payroll_entries pe
    JOIN payroll_entry_lines a ON a.entry_id = pe.entry_id AND a.item_id = 'settle-nhis'
    JOIN payroll_entry_lines b ON b.entry_id = pe.entry_id AND b.item_id = 'settle-nps'
   WHERE pe.ledger_id = 'pled-202502-salary'
     AND abs(b.amount - round(a.amount * 0.1)) <= abs(a.amount) * 0.01 + 10
)
UPDATE payroll_entry_lines l
   SET item_id = CASE WHEN l.line_id = p.nhis_line THEN 'yearend-income' ELSE 'yearend-local' END
  FROM pairs p
 WHERE l.line_id IN (p.nhis_line, p.nps_line);

-- ─────────────────────────────────────────────
-- 2. 2025년 4·5·6·8월 이도희·이윤재 200,000(성과급 열 → longevity/incentive 로 적재) = 육아수당(비과세).
--    이도희 1~3월 3단 무라벨 100,000(unlabeled-pay) 도 육아수당(세무법인 출산보육수당 2,100,000 = 3×10만 + 9×20만).
-- ─────────────────────────────────────────────
UPDATE payroll_entry_lines l
   SET item_id = 'childcare'
  FROM payroll_entries pe
  JOIN payroll_ledgers pl ON pl.ledger_id = pe.ledger_id
 WHERE l.entry_id = pe.entry_id
   AND pl.pay_year = 2025 AND pl.pay_month IN (4, 5, 6, 8)
   AND pe.name IN ('이도희', '이윤재')
   AND l.item_id IN ('longevity', 'incentive') AND l.amount = 200000;

UPDATE payroll_entry_lines l
   SET item_id = 'childcare'
  FROM payroll_entries pe
  JOIN payroll_ledgers pl ON pl.ledger_id = pe.ledger_id
 WHERE l.entry_id = pe.entry_id
   AND pl.pay_year = 2025 AND pl.pay_month IN (1, 2, 3)
   AND pe.name = '이도희'
   AND l.item_id = 'unlabeled-pay' AND l.amount = 100000;

-- ─────────────────────────────────────────────
-- 3. 2025 계속근무자인데 employee_profiles 가 없어 대장 행이 미매칭(연말정산 목록 누락)이던 3명.
--    입사일은 원천징수영수증 파일명(사원코드)·대장 기준. 2026-08-13 사용자 확인으로 현재는 퇴사자 → inactive.
-- ─────────────────────────────────────────────
INSERT INTO employee_profiles (employee_id, employee_no, name, hired_at, status, nationality_kind, created_at, updated_at, memo)
VALUES
  ('emp-jeon-jeom-sik',  '201911010101', '전점식', '2019-11-01', 'inactive', 'domestic',
   to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'), to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
   '2025 귀속 연말정산 대사로 보강(마이그 222) — 급여대장 매칭용'),
  ('emp-kang-jeong-mi',  '202504010101', '강정미', '2025-04-01', 'inactive', 'domestic',
   to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'), to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
   '2025 귀속 연말정산 대사로 보강(마이그 222) — 급여대장 매칭용'),
  ('emp-shin-seok-heon', '202507010102', '신석헌', '2025-07-01', 'inactive', 'domestic',
   to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'), to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
   '2025 귀속 연말정산 대사로 보강(마이그 222) — 급여대장 매칭용')
ON CONFLICT (employee_id) DO NOTHING;

UPDATE payroll_entries pe
   SET employee_id = p.employee_id
  FROM employee_profiles p
 WHERE pe.employee_id IS NULL
   AND p.employee_id IN ('emp-jeon-jeom-sik', 'emp-kang-jeong-mi', 'emp-shin-seok-heon')
   AND pe.name = p.name;
