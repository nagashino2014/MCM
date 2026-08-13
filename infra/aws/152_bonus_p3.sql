-- 성과급 BS-P3: 지급 계획 기안 양식 + 지급 명세서 발송 이력 (docs/bonus-calculation-blueprint.md §6)

-- 1) 성과급 지급 계획 양식 — 일괄산정 결과를 표로 담아 대표이사 직결 상신(기안 권한 admin).
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, mobile_allowed, sort_order, created_at, updated_at)
VALUES
  ('frm-bonus-plan', 'fld-finance', '성과급 지급 계획', '반기 성과급 지급 계획서 — 성과급 산정 메뉴의 일괄산정 결과로 자동 기안. 대표이사 직결.',
   '[
     {"key":"period","label":"지급 대상 반기","type":"text","required":true,"row":1,"span":1},
     {"key":"total","label":"지급 총액(원)","type":"currency","row":1,"span":1},
     {"key":"headcount","label":"지급 인원","type":"number","row":1,"span":1},
     {"key":"rows","label":"성과급 지급 명세","type":"table","row":2,"span":3,
      "tableColumns":[
        {"key":"name","label":"성명","type":"text"},
        {"key":"dept","label":"부서","type":"text"},
        {"key":"position","label":"직함","type":"text"},
        {"key":"amount","label":"지급대상액(원)","type":"currency"}
      ]},
     {"key":"note","label":"비고","type":"multitext","row":3,"span":3,"minRows":2}
   ]'::jsonb,
   '성과급지급계획', 10, '성과급 문서', '성과급 문서', 0, 30, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-bonus-plan'
ON CONFLICT (form_id, version) DO NOTHING;

-- 2) 지급 명세서 발송 이력 — statements 는 일괄산정 시 재생성되므로 FK 없이 (period, employee) 로 기록.
CREATE TABLE IF NOT EXISTS bonus_statement_sends (
  send_id text PRIMARY KEY,
  period_year integer NOT NULL,
  period_half text NOT NULL,                 -- 'H1' | 'H2'
  employee_id text NOT NULL,
  email text,
  status text NOT NULL,                      -- 'sent' | 'failed' | 'skipped'
  error text,
  message_id text,
  sent_by text REFERENCES users(user_id) ON DELETE SET NULL,
  sent_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bonus_statement_sends_period
  ON bonus_statement_sends(period_year, period_half, employee_id, sent_at);
