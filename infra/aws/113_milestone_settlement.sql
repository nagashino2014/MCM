-- 113_milestone_settlement.sql
-- 실적 정산(settlement) — 출장 경비·인쇄비 등을 실적 정산하여 계약 시 계상액에서
-- 실제 사용액과의 차액을 제하고 준공금을 지급하는 경우, 정산을 반영한 실제 청구액을 기록한다.
-- 차감액은 (단계 금액 - settlement_amount) 로 파생 계산하므로 컬럼을 따로 두지 않는다.
-- 준공금/잔금/준공 기성금 등 최종 대금 지급 단계에만 입력된다.
-- 멱등.

ALTER TABLE contract_payment_milestones
  ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC;
