-- 352: 법인카드 증빙 소명 요청 (사용자 요청 2026-11-11).
-- 배경: 재무 > 계좌·카드 원장 > 카드 증빙 대조에서 결재 문서(지출 증빙)가 없는 카드 건을 찾아
--       해당 부서에 소명을 요청하고 회신을 받는다.
--   - 요청 1건 = 카드 건 1건. 받는 사람은 관리자가 확인한 부서의 부서장이다(자동 발송 없음).
--   - status: pending(요청됨) → answered(회신) / canceled(관리자 취소)
--   - 카드 건이 결재 문서에 담겨 증빙이 생겼는지는 저장하지 않고 조회할 때 card_transactions.doc_id 로 본다.
--   - card_transactions 에는 쓰지 않는다. 재무 감시 표가 아닌 별도 표이며 외래키를 두지 않는다
--     (331 → 332 사고: 감시 표를 가리키는 REFERENCES 가 설치 지문을 깨 재무 쓰기를 막았다).
--     표 이름도 재무 보호 접두사(finance_·payroll_·prevent_·r1_·reject_·vat_)를 피한다.
-- 멱등: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS card_audit_requests (
  request_id   text PRIMARY KEY,
  card_txn_id  text NOT NULL,
  dept_id      text,
  requested_to text NOT NULL,
  requested_by text NOT NULL,
  trip_doc_id  text,
  note         text,
  status       text NOT NULL DEFAULT 'pending',
  answer       text,
  answered_by  text,
  answered_at  text,
  todo_item_id text,
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_audit_requests_txn ON card_audit_requests(card_txn_id, status);
CREATE INDEX IF NOT EXISTS idx_card_audit_requests_to ON card_audit_requests(requested_to, status);
