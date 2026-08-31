-- 202: FRM-P1 신규 양식 4종 — 구매품의서·지출결의서(개인카드)·업무기안·결근사유서 (08-26 확정).
--  - 구매품의서: 품목 표(link 열 = 상품 링크 → 품명 자동 수집, 렌더러 처리)+합계. 지출결의서(법인카드)의
--    선행 양식으로 지정(ref_form_id) — 출장신청↔보고서와 동일한 선행문서 자동완성 연계.
--  - 지출결의서(개인카드): 법인카드 양식과 동일 열 구성. 영수증 스톡(personal_receipts)만 불러온다
--    (버튼 제어는 ApprovalDraftBoard CARD_EXPENSE_FORMS — corporate/personal 플래그).
--  - 결근사유서: 관리자 제출 요청 선행형 — absence_statement_requests 에 요청을 만들고 대상자가 기안.
-- 멱등: ON CONFLICT DO NOTHING / IF NOT EXISTS.

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-purchase-request', 'fld-finance', '구매품의서', '도서·사무용품·비품 등 구입 사전 승인 — 상품 링크로 품명 자동 수집, 승인 후 지출결의서(법인카드)와 연계',
   '[
     {"key":"items","label":"구입 품목","type":"table","required":true,"row":1,"span":3,"minRows":2,"sumColumn":"amount","tableColumns":[
       {"key":"no","label":"연번","type":"rowno"},
       {"key":"link","label":"상품 링크","type":"link","fillTarget":"item_name"},
       {"key":"item_name","label":"품명","type":"text"},
       {"key":"qty","label":"수량","type":"number"},
       {"key":"unit_price","label":"단가","type":"currency"},
       {"key":"amount","label":"금액","type":"currency","semantic":{"concept":"cost.etc","costCategory":"소모품비"}}
     ]},
     {"key":"purpose","label":"구입 사유","type":"multitext","required":true,"row":2,"span":3},
     {"key":"need_by","label":"희망 납기","type":"date","row":3,"span":1},
     {"key":"notice","label":"안내","type":"static","content":"상품 링크를 붙여 넣으면 품명이 자동으로 채워집니다(일부 쇼핑몰은 수집이 차단되어 직접 입력이 필요할 수 있습니다).\n구입 완료 후 지출결의서(법인카드) 기안 시 이 문서를 선행 문서로 선택하면 내역이 자동 연계됩니다.","row":4,"span":3}
   ]'::jsonb,
   '구매품의', 5, '회계 문서', '회계 문서', 2, now()::text, now()::text),

  ('frm-expense-personal', 'fld-finance', '지출 결의서(개인카드)', '개인카드 경비 결의 — 모바일 영수증 보관함 연동, 월 1회 일괄 경비 정산(CMS) 대상',
   '[
     {"key":"expenses","label":"사용 내역","type":"table","required":true,"row":1,"span":3,"minRows":3,"sumColumn":"amount","tableColumns":[
       {"key":"no","label":"연번","type":"rowno"},
       {"key":"used_on","label":"사용일시","type":"date","semantic":{"concept":"when.occurred"}},
       {"key":"category","label":"분류","type":"select","options":["식대","교통비","유류비","소모품비","접대비","교육비","기타"],"semantic":{"concept":"dim.category"}},
       {"key":"vendor","label":"상호","type":"text"},
       {"key":"amount","label":"금액","type":"currency","semantic":{"concept":"cost.etc"}},
       {"key":"detail","label":"지출 목적","type":"text"}
     ]},
     {"key":"notice","label":"안내","type":"static","content":"모바일 앱에서 촬영해 둔 개인카드 영수증을 [개인카드 영수증 불러오기]로 불러올 수 있습니다.\n승인된 내역은 월 1회 개인카드 경비 정산에서 일괄 지급됩니다.","row":2,"span":3}
   ]'::jsonb,
   '개인지출결의', 5, '회계 문서', '회계 문서', 3, now()::text, now()::text),

  ('frm-work-proposal', 'fld-biz', '업무기안', '일반 업무 기안 — 필수는 추진 내용만(배경·기대효과·예산은 선택)',
   '[
     {"key":"background","label":"기안 배경(목적)","type":"multitext","row":1,"span":3},
     {"key":"content","label":"추진 내용","type":"multitext","required":true,"row":2,"span":3},
     {"key":"effect","label":"기대효과","type":"multitext","row":3,"span":3},
     {"key":"budget","label":"소요예산","type":"currency","row":4,"span":1}
   ]'::jsonb,
   '업무기안', 5, '업무 문서', '업무 문서', 3, now()::text, now()::text),

  ('frm-absence-statement', 'fld-hr', '결근사유서', '결근 사유 소명 — 관리자 제출 요청을 받은 인원이 작성',
   '[
     {"key":"absence_period","label":"결근 기간","type":"period","required":true,"row":1,"span":2},
     {"key":"absence_kind","label":"사유 구분","type":"select","required":true,"options":["질병","사고","경조사","개인 사정","무단","기타"],"row":1,"span":1},
     {"key":"reason_detail","label":"구체적 사유","type":"multitext","required":true,"row":2,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"질병·사고 등 증빙이 있는 경우 관련 서류(진단서·확인서 등)를 스캔하여 첨부하세요.","row":3,"span":3}
   ]'::jsonb,
   '결근사유', 3, '근태 문서', '근태 문서', 3, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

-- v1 스냅샷
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id IN ('frm-purchase-request','frm-expense-personal','frm-work-proposal','frm-absence-statement')
ON CONFLICT (form_id, version) DO NOTHING;

-- 구매품의서 → 지출결의서(법인카드) 선행 연계(127 ref_form_id). 관리자가 이미 지정했다면 존중.
UPDATE approval_forms SET ref_form_id = 'frm-purchase-request', updated_at = now()::text
 WHERE form_id = 'frm-expense-report' AND ref_form_id IS NULL;

-- 지출 분류 매핑(170 expense_categories.form_option_map)에 개인카드 양식 추가 —
-- 법인카드 양식과 분류 옵션이 동일하므로 frm-expense-report 값을 복사한다(영수증 자동 분류 매핑용).
UPDATE expense_categories
   SET form_option_map = jsonb_set(COALESCE(form_option_map, '{}'::jsonb), '{frm-expense-personal}', form_option_map->'frm-expense-report', true)
 WHERE form_option_map ? 'frm-expense-report' AND NOT (COALESCE(form_option_map, '{}'::jsonb) ? 'frm-expense-personal');

-- 결근사유서 제출 요청 — 관리자가 결근자·기간을 지정해 요청하면 대상자 홈/기안 화면에 노출된다.
-- 대상자가 결근사유서를 상신하면 doc_id 연결 + submitted 마감(레지스트리 커넥터 hr.close_absence_request).
CREATE TABLE IF NOT EXISTS absence_statement_requests (
  request_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  date_from text NOT NULL,                -- 결근 시작일 YYYY-MM-DD
  date_to text NOT NULL,                  -- 결근 종료일(하루면 date_from 과 동일)
  note text,                              -- 요청 메모(대상자에게 표시)
  status text NOT NULL DEFAULT 'pending', -- pending|submitted|canceled
  doc_id text,                            -- 제출된 결근사유서 문서
  requested_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_absence_requests_emp ON absence_statement_requests(employee_id, status);

-- FRM-P0 레지스트리 배선: 결근사유서 상신 시 열린 요청 자동 마감
INSERT INTO approval_form_actions (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
VALUES ('fa-absence-close', 'frm-absence-statement', 'hr.close_absence_request', 'submitted',
        '{"period":"absence_period"}'::jsonb, '{}'::jsonb, 1, 0, now()::text, now()::text)
ON CONFLICT (action_id) DO NOTHING;
