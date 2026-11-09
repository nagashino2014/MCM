-- 346: 전자결재 관리자 조치 — 모든 양식 고정 참조·열람자 + 승인 문서 관리자 취소 기록 + 관리자 값 수정 이력.
--
-- 배경(2026-11-09 사용자 요청):
--   1) 참조·열람이 자유 지정이라 관리자가 자기에게 상신되지 않은 문서를 알 수 없다.
--      → 335 역할 담당자처럼 '*'(모든 양식) 기본 행을 두고, 저장·상신 때 서버가 참조·열람자로 넣는다.
--        기안자 본인·결재선에 이미 있는 사람은 넣지 않는다. 담당자는 결재 운영 > 고정 결재선 화면에서 바꾼다.
--   2) 승인 완료 문서를 관리자가 사유와 함께 취소한다(삭제 아님). 취소한 문서의 번호는 반납해 다음 상신이 이어받고,
--      원래 번호는 canceled_doc_no 에 남긴다.
--   3) 승인 완료 문서의 간단한 값(일자·시각·글)을 관리자가 사유와 함께 고친다. 고친 전후 값은 approval_doc_edits 에 남긴다.
-- 335 와 같이 외래키는 두지 않는다(문서 삭제 시 deleteDoc 이 함께 지운다). 새 권한 키 없음(approval.manage). 멱등.

-- 1) 고정 참조·열람자. form_id '*' = 모든 양식, 양식 행이 같은 사람의 '*' 행을 덮어쓴다.
CREATE TABLE IF NOT EXISTS approval_line_watchers (
  entry_id   text PRIMARY KEY,
  form_id    text NOT NULL DEFAULT '*',
  user_id    text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('ref', 'view')),
  updated_by text,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_line_watchers ON approval_line_watchers(form_id, user_id);
-- 문서에 고정 규칙으로 들어간 참조·열람자 표지 — 공문·계약서 발송 메일의 내부 Cc 에서 뺀다(기안자가 직접 지정한 사람만 Cc).
ALTER TABLE approval_watchers ADD COLUMN IF NOT EXISTS fixed integer NOT NULL DEFAULT 0;

-- 2) 관리자 취소 기록 — status='canceled' 와 함께 채운다. 기안자 반려 요청(124)으로 처리한 취소도 같은 열을 쓴다.
ALTER TABLE approval_docs ADD COLUMN IF NOT EXISTS canceled_at text;
ALTER TABLE approval_docs ADD COLUMN IF NOT EXISTS canceled_by text;
ALTER TABLE approval_docs ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE approval_docs ADD COLUMN IF NOT EXISTS canceled_doc_no text;

-- 3) 관리자 값 수정 이력 — 항목 하나 고칠 때마다 한 행.
CREATE TABLE IF NOT EXISTS approval_doc_edits (
  edit_id        text PRIMARY KEY,
  doc_id         text NOT NULL,
  field_key      text NOT NULL,
  field_label    text,
  before_value   jsonb,
  after_value    jsonb,
  reason         text NOT NULL,
  edited_by      text NOT NULL,
  edited_by_name text,
  edited_at      text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_doc_edits_doc ON approval_doc_edits(doc_id, edited_at);

-- 4) 시드 — 모든 양식 고정 열람자 = 관리자(이재영), 고정 참조자 = 이도희. 계정이 연결된 재직자만(다른 환경은 0행).
--    DO NOTHING — 운영자가 바꾼 값은 재실행해도 보존한다.
INSERT INTO approval_line_watchers (entry_id, form_id, user_id, kind, updated_by, updated_at)
SELECT s.entry_id, '*', ep.user_id, s.kind, 'migration-346', now()::text
  FROM (VALUES
    ('alw-view-manager', 'emp-lee-jae-young', 'view'),
    ('alw-ref-proxy',    'emp-lee-do-hee',    'ref')
  ) AS s(entry_id, employee_id, kind)
  JOIN employee_profiles ep ON ep.employee_id = s.employee_id AND ep.status = 'active' AND ep.user_id IS NOT NULL
ON CONFLICT DO NOTHING;
