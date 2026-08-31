-- 207: 연차수당 지급 신청서 + 퇴직 정산 골격(FRM-P5, 08-26 확정).
-- 연차사용촉진제도 운영으로 연차수당은 원칙 미지급 — 퇴사자 잔여 연차 정산에 한해 사용.
-- 승인 시 커넥터(hr.record_leave_pay)가 퇴직 정산 레코드(severance_settlements)에 지급 대상액을 기입한다.
-- 퇴직금 자동 산정(평균임금·근속·퇴직소득세)은 후속 블루프린트 — 여기서는 수기 입력 골격만.

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-annual-leave-pay', 'fld-hr', '연차수당 지급 신청서', '퇴사자 잔여 연차 수당 정산 — 승인 시 퇴직 정산 자료에 자동 기입',
   '[
     {"key":"target_person","label":"대상자(퇴사 예정자)","type":"user_select","required":true,"row":1,"span":1},
     {"key":"resign_date","label":"퇴사(예정)일","type":"date","required":true,"row":1,"span":1},
     {"key":"remaining_days","label":"잔여 연차일수","type":"number","required":true,"row":2,"span":1},
     {"key":"daily_wage","label":"1일 통상임금","type":"currency","required":true,"row":2,"span":1},
     {"key":"total_amount","label":"지급 대상액","type":"currency","required":true,"row":2,"span":1},
     {"key":"calc_note","label":"산정 근거","type":"multitext","placeholder":"예: 통상임금 산정 내역, 잔여 연차 산출 근거","row":3,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"잔여 연차일수 × 1일 통상임금 = 지급 대상액이 자동 계산됩니다.\n승인되면 재무 → 퇴직 정산의 해당 퇴사자 자료에 연차수당이 자동 기입됩니다.","row":4,"span":3}
   ]'::jsonb,
   '연차수당', 5, '인사 문서', '인사 문서', 8, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-annual-leave-pay'
ON CONFLICT (form_id, version) DO NOTHING;

-- 퇴직 정산 레코드(최소 골격) — 퇴사자별 1건. 연차수당은 승인 문서에서 자동, 퇴직금은 수기(후속 자동화).
CREATE TABLE IF NOT EXISTS severance_settlements (
  settle_id text PRIMARY KEY,
  employee_id text NOT NULL UNIQUE,
  employee_name text,
  resign_date text,
  leave_pay_days numeric,            -- 잔여 연차일수(승인 문서)
  leave_pay_amount bigint,           -- 연차수당 지급 대상액(승인 문서)
  leave_pay_doc_id text,
  leave_pay_doc_no text,
  severance_amount bigint,           -- 퇴직금(수기 — 자동 산정은 후속)
  status text NOT NULL DEFAULT 'draft',  -- draft|confirmed(정산 완료)
  note text,
  updated_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- FRM-P0 레지스트리 배선
INSERT INTO approval_form_actions (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
VALUES ('fa-annual-leave-pay', 'frm-annual-leave-pay', 'hr.record_leave_pay', 'approved',
        '{"person":"target_person","resign_date":"resign_date","days":"remaining_days","amount":"total_amount"}'::jsonb,
        '{}'::jsonb, 1, 0, now()::text, now()::text)
ON CONFLICT (action_id) DO NOTHING;
