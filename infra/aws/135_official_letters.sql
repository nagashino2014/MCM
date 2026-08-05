-- 135: 공문 발송 시스템 — 발송 대장·채번 시드·전자결재 양식 시드.
-- 설계: docs/official-letter-blueprint.md (2026-08-05 확정: 결재=전자결재 코어 위임,
--       PDF=pdf-lib 직접 렌더, 승인 시 기안자 계정 자동 메일 발송, 과거 공문 백필 포함).
-- 공문 원본 데이터는 approval_docs.field_values(시스템 생성분)가 단일 소스이고,
-- official_letters 는 발송·산출물 메타 전용 대장이다. 백필(imported) 문서는 결재 문서가
-- 없으므로 doc_id 가 NULL 이다.
-- 관례: text 타임스탬프, integer boolean, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 공문 발송 대장
CREATE TABLE IF NOT EXISTS official_letters (
  letter_id    text PRIMARY KEY,                 -- 'ltr-' + nanoid
  doc_id       text UNIQUE,                      -- approval_docs.doc_id (imported 는 NULL)
  source       text NOT NULL DEFAULT 'system',   -- system | imported
  letter_no    text UNIQUE,                      -- '2026-대외-01034'
  year         text,
  title        text,
  letter_kind  text NOT NULL DEFAULT 'general',  -- general | proof(내용증명형)
  recipients   jsonb,                            -- [{name,deptName,title,email,facilityName}] — 사후 편집 대상
  cc_refs      jsonb,
  drafter_name text,
  issue_date   text,                             -- 시행일 YYYY-MM-DD
  pdf_key      text,                             -- letters/{YYYY}/{letter_no}/{letter_no}.pdf
  hwpx_key     text,
  hwp_key      text,                             -- imported 원본 hwp
  attach_keys  jsonb,                            -- imported 동봉 첨부 [{name,key}]
  fit_params   jsonb,                            -- A4 1장 맞춤 확정값(재생성 재현용)
  send_status  text NOT NULL DEFAULT 'pending',  -- pending|generating|sent|failed|archived(imported)
  send_error   text,
  send_attempts integer NOT NULL DEFAULT 0,
  sent_at      text,
  sent_message_id text,
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_official_letters_status ON official_letters(send_status);
CREATE INDEX IF NOT EXISTS idx_official_letters_year ON official_letters(year, letter_no);

-- 2) 채번 시드 — 2026년은 수동 발번 01033까지 사용됨(다음 채번 01034).
--    rule_key='대외' 는 {연도}-대외-{NNNNN} 포맷·신규 연도 1001 시작으로 분기(lib/approval/docs.ts).
INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES ('대외', '2026', 1033)
ON CONFLICT (rule_key, year) DO NOTHING;

-- 3) 공문 양식 시드 — 전용 작성 화면(/approval/letter)이 있으므로 fields 는 양식별 문서
--    조회(전자결재 탭) 표시용 최소 선언만 둔다. 실제 값 스키마는 lib/letter/types.ts 의
--    field_values 규약(letter_kind/recipients/body_html/attachments_list/stamp 등)이 원본.
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, mobile_allowed, sort_order, created_at, updated_at)
VALUES
  ('frm-official-letter', 'fld-biz', '공문(대외발송)', '대외 발송 공문 — 전용 작성 화면(/approval/letter) 사용. 승인 완료 시 자동 채번·PDF/HWPX 생성·메일 발송.',
   '[
     {"key":"recipients_display","label":"수신처","type":"text","row":1,"span":2},
     {"key":"letter_kind_display","label":"유형","type":"text","row":1,"span":1}
   ]'::jsonb,
   '대외', 10, '공문 문서', '공문 문서', 0, 9, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-official-letter'
ON CONFLICT (form_id, version) DO NOTHING;
