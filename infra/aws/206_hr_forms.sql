-- 206: 인사 계열 양식 3종(FRM-P3, 08-26 확정) — 퇴직원·휴직원·인사 발령.
--  승인 → 커넥터가 employee_hr_events 에 자동 기록:
--   퇴직원 → resignation(퇴사일 도래 시 계정 비활성 — 승인 즉시 아님, 사용자 확정)
--   휴직원 → leave_start(복직 leave_end 는 인사관리 탭에서 기록)
--   인사 발령 → 행 단위 promotion/transfer 일괄
--  event_type CHECK 에 휴직(leave_start)·복직(leave_end) 추가.

-- ① employee_hr_events.event_type CHECK 확장(045 원제약: promotion|transfer|resignation)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'employee_hr_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%event_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employee_hr_events DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE employee_hr_events
    ADD CONSTRAINT employee_hr_events_event_type_check
    CHECK (event_type IN ('promotion','transfer','resignation','leave_start','leave_end'));
EXCEPTION WHEN duplicate_object THEN
  NULL; -- 이미 확장됨
END $$;

-- ② 양식 3종
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-resignation', 'fld-hr', '퇴직원', '퇴직 의사 제출 — 승인 시 인사관리 퇴사 이력 자동 기록(계정은 퇴사일 도래 시 비활성)',
   '[
     {"key":"resign_date","label":"퇴직(예정)일","type":"date","required":true,"row":1,"span":1},
     {"key":"handover_to","label":"인수인계자","type":"user_select","row":1,"span":1},
     {"key":"resign_reason","label":"퇴직 사유","type":"multitext","required":true,"row":2,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"승인되면 인사관리 탭에 퇴사 이력이 자동 기록되고, 퇴직(예정)일이 되면 계정이 비활성화됩니다.\n잔여 연차가 있는 경우 연차수당 지급 신청서를 별도로 기안하세요(퇴직 정산에 반영).","row":3,"span":3}
   ]'::jsonb,
   '퇴직원', 30, '인사 문서', '인사 문서', 5, now()::text, now()::text),

  ('frm-leave-absence', 'fld-hr', '휴직원', '휴직 신청 — 승인 시 인사관리 휴직 이력 자동 기록(복직 처리는 인사관리 탭)',
   '[
     {"key":"leave_period","label":"휴직 기간","type":"period","required":true,"row":1,"span":2},
     {"key":"leave_kind","label":"휴직 구분","type":"select","required":true,"options":["질병 휴직","육아 휴직","가족돌봄 휴직","학업 휴직","기타"],"row":1,"span":1},
     {"key":"leave_reason","label":"휴직 사유","type":"multitext","required":true,"row":2,"span":3},
     {"key":"contact","label":"휴직 중 비상 연락처","type":"text","row":3,"span":1},
     {"key":"notice","label":"안내","type":"static","content":"승인되면 휴직 시작 이력이 자동 기록됩니다. 복직 시 인사 담당자가 인사관리 탭에서 복직 처리합니다.","row":4,"span":3}
   ]'::jsonb,
   '휴직원', 30, '인사 문서', '인사 문서', 6, now()::text, now()::text),

  ('frm-hr-appointment', 'fld-hr', '인사 발령', '승진·부서 이동 발령 — 승인 시 대상자별 인사 이력(승진/부서이동) 자동 기록',
   '[
     {"key":"appointments","label":"발령 내역","type":"table","required":true,"row":1,"span":3,"minRows":1,"tableColumns":[
       {"key":"no","label":"연번","type":"rowno"},
       {"key":"person","label":"대상자","type":"people"},
       {"key":"appoint_kind","label":"발령 구분","type":"select","options":["승진","부서이동"]},
       {"key":"appoint_date","label":"발령일","type":"date"},
       {"key":"new_position","label":"발령 직급(승진)","type":"text"},
       {"key":"to_dept","label":"발령 부서(부서이동)","type":"text"},
       {"key":"note","label":"비고","type":"text"}
     ]},
     {"key":"effective_note","label":"발령 사유","type":"multitext","row":2,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"승인되면 각 대상자의 인사관리 탭에 승진/부서이동 이력이 자동 기록됩니다.\n발령 직급·부서는 등록된 직급명/부서명과 동일하게 입력하면 자동 연결됩니다.","row":3,"span":3}
   ]'::jsonb,
   '인사발령', 30, '인사 문서', '인사 문서', 7, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id IN ('frm-resignation','frm-leave-absence','frm-hr-appointment')
ON CONFLICT (form_id, version) DO NOTHING;

-- ③ FRM-P0 레지스트리 배선
INSERT INTO approval_form_actions (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
VALUES
  ('fa-resignation', 'frm-resignation', 'hr.record_resignation', 'approved',
   '{"date":"resign_date","reason":"resign_reason"}'::jsonb, '{}'::jsonb, 1, 0, now()::text, now()::text),
  ('fa-leave-absence', 'frm-leave-absence', 'hr.record_leave_absence', 'approved',
   '{"period":"leave_period","kind":"leave_kind","reason":"leave_reason"}'::jsonb, '{}'::jsonb, 1, 0, now()::text, now()::text),
  ('fa-hr-appointment', 'frm-hr-appointment', 'hr.record_appointments', 'approved',
   '{"rows":"appointments"}'::jsonb, '{}'::jsonb, 1, 0, now()::text, now()::text)
ON CONFLICT (action_id) DO NOTHING;
