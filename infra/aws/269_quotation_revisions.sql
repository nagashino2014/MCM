-- 269: 견적서 버전 관리(재견적) — 2026-10-01 사용자 요청
-- 같은 용역 건에 여러 번 견적을 내는 경우를 묶는다. 원본 견적(root) 기준으로 버전이 올라가며,
-- 재견적 사유(용역 범위 증가/축소·네고 요청)와 직전 버전 금액을 대장에 남겨 이력 표시·수주 분석에 쓴다.
-- 문서 원본(approval_docs.field_values)의 quote_root_doc_id/revision_of_doc_id/quote_version/
-- revision_reason/prev_total_amount 를 승인 시 markQuotePendingOnApproval 이 미러한다.

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS root_doc_id text;         -- 원본 견적 approval_docs.doc_id (원본 자신이면 = doc_id)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS revision_reason text;     -- scope_up | scope_down | nego (원본은 NULL)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS prev_total_amount bigint; -- 직전 버전 제출 견적가 합계(원본은 NULL)

UPDATE quotations SET root_doc_id = doc_id WHERE root_doc_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_quotations_root ON quotations(root_doc_id, version);
