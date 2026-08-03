-- 124: 전자결재 반려 요청(취소 요청) — 일정(캘린더) 메뉴의 본인 스케줄 취소·변경 흐름.
--   기안자가 자기 문서(휴가/출장/교육, 진행중·승인완료)에 반려를 요청하면
--     · in_progress → 현재 pending 결재자들에게 알림 → 결재자가 기존 반려로 처리
--     · approved   → 관리자(approval.manage)에게 알림 → 관리자가 '결재 취소'(canceled 전이
--                    + 휴가면 연차 대장 use 회수) 처리
--   복수 이력 보존(재상신 후 재요청 등)을 위해 approval_docs 컬럼 대신 별도 테이블. 멱등.

CREATE TABLE IF NOT EXISTS approval_cancel_requests (
  request_id   text PRIMARY KEY,
  doc_id       text NOT NULL REFERENCES approval_docs(doc_id) ON DELETE CASCADE,
  requested_by text NOT NULL,               -- 기안자 user_id
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'resolved')),
  -- 처리 결과: rejected(결재자가 반려) | canceled(관리자가 결재 취소) | withdrawn(요청 철회)
  resolution   text CHECK (resolution IN ('rejected', 'canceled', 'withdrawn')),
  requested_at text NOT NULL,
  resolved_at  text,
  resolved_by  text
);
CREATE INDEX IF NOT EXISTS idx_approval_cancel_req_doc ON approval_cancel_requests(doc_id, status);
