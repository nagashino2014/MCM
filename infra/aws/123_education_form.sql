-- 123: 교육훈련 신청 양식(frm-education-request) 신설 — 일정(캘린더) 메뉴 지원.
-- 교육/세미나 참석으로 인한 부재를 일정에 표시하기 위한 데이터원. 스케줄명 규칙 "[교육명]"
-- (lib/calendar/queries.ts 가 edu_name·edu_period 를 읽는다 — 필드 키 변경 시 함께 수정할 것).
-- 084 시드 패턴 준용(사용자가 빌더에서 수정할 원안 — 재적용 시 덮지 않는다). 멱등.

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-education-request', 'fld-hr', '교육훈련 신청', '교육·세미나 수강 신청 — 상신 시 일정(캘린더)에 교육 부재로 표시',
   '[
     {"key":"edu_name","label":"교육명","type":"text","required":true,"row":1,"span":2},
     {"key":"edu_org","label":"교육기관","type":"text","row":1,"span":1},
     {"key":"edu_period","label":"교육기간","type":"period","required":true,"row":2,"span":2},
     {"key":"edu_place","label":"교육장소","type":"text","row":2,"span":1},
     {"key":"edu_content","label":"교육내용·신청 사유","type":"multitext","required":true,"row":3,"span":3}
   ]'::jsonb,
   '교육신청', 3, '교육 문서', '교육 문서', 3, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-education-request'
ON CONFLICT (form_id, version) DO NOTHING;
