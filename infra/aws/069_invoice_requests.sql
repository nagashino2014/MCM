-- 069_invoice_requests.sql
-- 세금계산서 발행 요청 워크플로(홈 대시보드 H10·H11): 용역 수행 담당자가 대금단계 도달을
-- 회계에 알리는 공식 채널. 기존엔 구두/메신저였고 invoice_issued(발행 완료) 플래그만 존재했다.
-- contract_payment_milestones 에 "발행 요청" 상태 3컬럼 추가:
--   invoice_requested_at   = 요청 시각(ISO 문자열). 존재 & invoice_issued=0 이면 "요청됨" 상태.
--   invoice_requested_by   = 요청자(employee_profiles.employee_id).
--   invoice_request_note   = 요청 메모(선택).
-- 발행 완료(invoice_issued=1) 처리 시 요청 상태는 자동 해소된다(요청 상태 = requested_at & NOT issued).
-- 068 위에 적용. 멱등.

ALTER TABLE contract_payment_milestones ADD COLUMN IF NOT EXISTS invoice_requested_at  text;  -- 발행 요청 시각(ISO)
ALTER TABLE contract_payment_milestones ADD COLUMN IF NOT EXISTS invoice_requested_by  text;  -- 요청자 employee_id
ALTER TABLE contract_payment_milestones ADD COLUMN IF NOT EXISTS invoice_request_note  text;  -- 요청 메모(선택)

-- 회계 수신함(H11)·요청자 조회(H10)에서 미발행 요청분을 자주 훑으므로 부분 인덱스.
CREATE INDEX IF NOT EXISTS ix_cpm_invoice_requested
  ON contract_payment_milestones (invoice_requested_at)
  WHERE invoice_requested_at IS NOT NULL AND invoice_issued = 0;
