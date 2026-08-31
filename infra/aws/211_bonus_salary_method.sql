-- 211: 성과급 '인건비 반영 산정'(BS-P4, docs/bonus-calculation-blueprint.md §1.3) 설정 확장.
-- 산식: 개인별 산정액(= Σ pool(c) × 참여도 × 평점가중치, pool 은 salary_apply_rate 로 산출)에서
--       본인 반기 인건비(급여대장의 통상임금 산입 항목 합계) × salary_multiplier 를 차감한다.
-- 급여 그릇은 블루프린트 §3-6 이 예고한 bonus_employee_salaries 대신 이미 구축된
-- payroll_ledgers/payroll_entries/payroll_entry_lines(155)를 직접 집계해 쓴다(중복 그릇 방지).
-- 멱등.

ALTER TABLE bonus_period_settings
  ADD COLUMN IF NOT EXISTS salary_multiplier double precision NOT NULL DEFAULT 1.0;

-- 명세서 발송 게이트(2026-08-31 사용자 확정): 성과급 기안이 '승인' 되기 전에는 명세서를 발송하지
-- 않는다. 반기별 지급 계획 기안 문서를 설정 행에 물려 상태를 판정한다.
ALTER TABLE bonus_period_settings
  ADD COLUMN IF NOT EXISTS plan_doc_id text;

COMMENT ON COLUMN bonus_period_settings.salary_apply_rate IS
  '인건비 반영 산정 시 매출액 중 적용 비율(%) — 미지정이면 apply_rate 사용';
COMMENT ON COLUMN bonus_period_settings.salary_multiplier IS
  '인건비 반영 산정 시 반기 인건비 차감 배수(엑셀 성과산정액2=1.0 / 성과산정액3=1.5)';

COMMENT ON COLUMN bonus_period_settings.plan_doc_id IS
  '반기 성과급 지급 계획 기안 문서(approval_docs.doc_id) — 승인 전 명세서 발송 차단 게이트';
