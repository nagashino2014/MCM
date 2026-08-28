-- 204: 증명신청서(FRM-P2, 08-26 확정) — 재직·경력증명서, 갑종근로소득세 납세증명, 원천징수영수증
-- 4종의 발급 요청 양식 + 발급 파이프라인.
--  승인 → 커넥터(hr.queue_certificates)가 체크 종류별 certificate_issues(발급 대기) 생성 →
--  담당자가 /approval/certificates 에서 재직·경력=자동 기입 PDF 생성(직인 포함),
--  세무 서류=스캔 PDF 업로드 후 직인본 생성 → 발급 완료 시 기안자 개인문서함으로 전송+이력 기록.

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-certificate-request', 'fld-hr', '증명신청서', '재직·경력증명서, 갑종근로소득세 납세증명, 원천징수영수증 발급 신청 — 승인 시 발급 담당자에게 자동 전달',
   '[
     {"key":"cert_kinds","label":"신청 증명서","type":"checkbox","required":true,"options":["재직증명서","경력증명서","갑종근로소득세 납세증명","원천징수영수증"],"row":1,"span":3},
     {"key":"target_year","label":"귀속연도(세무 서류)","type":"text","placeholder":"예: 2025 — 납세증명·원천징수영수증만 해당","row":2,"span":1},
     {"key":"copies","label":"매수","type":"number","placeholder":"1","row":2,"span":1},
     {"key":"submit_to","label":"제출처","type":"text","row":2,"span":1},
     {"key":"purpose","label":"용도","type":"text","required":true,"placeholder":"예: 은행 대출 제출용","row":3,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"승인되면 발급 담당자에게 자동으로 전달되며, 발급된 증명서(직인본 PDF)는 개인문서함(파일 · 문서함 → 개인문서함)으로 전송됩니다.","row":4,"span":3}
   ]'::jsonb,
   '증명신청', 3, '인사 문서', '인사 문서', 4, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-certificate-request'
ON CONFLICT (form_id, version) DO NOTHING;

-- 발급 이력 — 신청 문서당 증명서 종류별 1행(대기→발급→전달).
CREATE TABLE IF NOT EXISTS certificate_issues (
  issue_id text PRIMARY KEY,
  doc_id text NOT NULL,
  doc_no text,
  cert_kind text NOT NULL,            -- employment|career|gapjong|withholding
  employee_id text,
  user_id text,                       -- 기안자(발급본 전송 대상)
  employee_name text,
  purpose text,
  target_year text,
  copies integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',  -- pending|issued|delivered
  file_key text,                      -- 발급본(직인 포함 PDF) 저장 키
  hwpx_key text,                      -- 회사 서식 HWPX 원본(재직·경력 — 필요 시 한글 편집용)
  issued_by text,
  issued_at text,
  delivered_at text,
  note text,
  created_at text NOT NULL,
  UNIQUE (doc_id, cert_kind)          -- 승인 훅 멱등
);
CREATE INDEX IF NOT EXISTS idx_cert_issues_status ON certificate_issues(status, created_at);

-- FRM-P0 레지스트리 배선: 승인 시 체크 종류별 발급 대기 생성
INSERT INTO approval_form_actions (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
VALUES ('fa-cert-queue', 'frm-certificate-request', 'hr.queue_certificates', 'approved',
        '{"kinds":"cert_kinds","purpose":"purpose","target_year":"target_year","copies":"copies"}'::jsonb, '{}'::jsonb, 1, 0, now()::text, now()::text)
ON CONFLICT (action_id) DO NOTHING;
