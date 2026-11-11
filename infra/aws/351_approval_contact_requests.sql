-- 351: 접견인 명함 등록 요청 (사용자 요청 2026-11-11).
-- 배경: 미계약 업체(직접 입력)로 상신된 문서는 접견인이 `성명 직함` 글자뿐이다. 관리자가 미계약 업체를
--       정리할 때 연락처가 필요하면 기안자에게 명함 등록(또는 직접 입력)을 요청한다.
--   - 요청 1건 = 문서 1건. 기안자 회신(response)은 접견인 상세와 업체 정보이며, 마스터 등록은
--     관리자가 [미계약 업체 정리] 화면에서 확정한다(회신만으로 업체·담당자가 만들어지지 않는다).
--   - status: pending(요청됨) → done(회신 완료) / canceled(관리자 취소) / closed(업체 등록으로 닫힘)
--   - 결근사유서 제출 요청(absence_statement_requests, 202)과 같은 구조. 외래키는 두지 않는다
--     (문서·계정이 지워져도 요청 이력은 남긴다).
-- 멱등: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS approval_contact_requests (
  request_id   text PRIMARY KEY,
  doc_id       text NOT NULL,
  company_name text NOT NULL,
  company_key  text NOT NULL,
  requested_to text NOT NULL,
  requested_by text NOT NULL,
  note         text,
  status       text NOT NULL DEFAULT 'pending',
  response     jsonb,
  todo_item_id text,
  responded_at text,
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_contact_requests_doc ON approval_contact_requests(doc_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_contact_requests_to ON approval_contact_requests(requested_to, status);
