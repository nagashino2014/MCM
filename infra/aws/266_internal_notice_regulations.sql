-- 266: 내부고시(사내 전파 공문) 양식 + 내부 규정(사규와 별도 규정집) 메타.
-- 화면: /approval/notice(내부고시 작성) · /rules/internal/edit(내부 규정 작성) · /rules/internal(내부 규정 일람)
-- 멱등.

-- ── 1) 내부고시 양식 — 전용 작성 화면(/approval/notice)이 있으므로 fields 는 양식별 문서 조회 표시용만 ──
--    문서번호 {연도}-내부고시-{NNNNN}호 (lib/approval/docs.ts allocateDocNo). 신규 연도 01001 시작.
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, mobile_allowed, sort_order, created_at, updated_at)
VALUES
  ('frm-internal-notice', 'fld-biz', '내부고시', '사내 전파용 내부고시 — 전용 작성 화면(/approval/notice) 사용. 상신 시 자동 채번, 결재 완료 문서는 PDF 로 열람.',
   '[
     {"key":"recipient_text","label":"수신","type":"text","row":1,"span":2},
     {"key":"sender_text","label":"발신","type":"text","row":1,"span":1}
   ]'::jsonb,
   '내부고시', 10, '내부고시', '내부고시', 0, 10, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

-- 2026년 채번 시작점 — 사외(수기)로 발번한 '2026-내부고시-01009호'(2026-08-03 시행)까지 사용 확인.
-- 다음 상신이 01010호를 받는다. 이미 시퀀스가 있으면 건드리지 않는다.
INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES ('내부고시', '2026', 1009)
ON CONFLICT (rule_key, year) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-internal-notice'
ON CONFLICT (form_id, version) DO NOTHING;

-- ── 2) 내부 규정 — rule_documents(193)를 같이 쓰되 kind 로 사규(company)와 구분한다 ──
--    규정번호 표기: 'KESI 규정 제 0001호' (reg_no 정수 보관, 표기는 화면·출력에서)
ALTER TABLE rule_documents ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'company';
ALTER TABLE rule_documents ADD COLUMN IF NOT EXISTS reg_no       int;
ALTER TABLE rule_documents ADD COLUMN IF NOT EXISTS owner_dept   text;  -- 주관부서
ALTER TABLE rule_documents ADD COLUMN IF NOT EXISTS approver     text;  -- 승인(예: 대표이사)
ALTER TABLE rule_documents ADD COLUMN IF NOT EXISTS enacted_date text;  -- 제정일 YYYY-MM-DD

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rule_documents_kind_check'
  ) THEN
    ALTER TABLE rule_documents
      ADD CONSTRAINT rule_documents_kind_check CHECK (kind IN ('company', 'internal'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_documents_internal_regno
  ON rule_documents(reg_no) WHERE kind = 'internal' AND reg_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rule_documents_kind ON rule_documents(kind, sort_order);
