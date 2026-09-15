-- 221: 공문 사전 검수 — 상신 전에 작성 중인 공문과 첨부서류를 사내 검수자에게 보내 확인받는다(2026-09-11 사용자 요청).
-- 배경: 공문은 승인 → 자동 발송이라 대외 발송 전에 내부 눈으로 한 번 더 보는 절차가 없었다.
--       결재선에 검수자를 끼워 넣으면 채번·발송 흐름에 섞이므로, 결재와 무관한 별도 경로로 둔다.
-- 흐름: 공문 작성 화면 [사전 검수] → 조직도에서 검수자 선택 → 임시저장 후 PDF(+HWPX·동봉 서류)를
--       기안자 명의 메일로 검수자에게 발송. 회차는 누적 기록만 하고 결재 상태는 건드리지 않는다.
-- 관례: doc_id text(approval_docs), text 타임스탬프, 멱등(IF NOT EXISTS).
-- reviewers 항목 형태: [{"userId": str, "name": str, "position": str|null, "address": 메일}]

CREATE TABLE IF NOT EXISTS letter_reviews (
  review_id       text PRIMARY KEY,
  doc_id          text NOT NULL,
  requested_by    text,                                   -- 요청한 기안자 user_id
  requester_name  text,
  reviewers       jsonb NOT NULL DEFAULT '[]'::jsonb,
  note            text,                                   -- 검수자에게 남기는 요청 메모
  letter_no       text,                                   -- 요청 시점 번호(미채번이면 NULL)
  subject         text,
  attach_names    jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 함께 보낸 파일명
  ok              integer NOT NULL DEFAULT 1,
  error           text,
  message_id      text,
  created_at      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_letter_reviews_doc ON letter_reviews (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_letter_reviews_requester ON letter_reviews (requested_by, created_at DESC);
