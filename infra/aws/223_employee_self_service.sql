-- 223: 직원 셀프서비스(내 급여·내 연말정산) + 수당 규칙 항목 정리 + 상여금 지급 계획 양식 + 장기근속 포상 자동화
-- (2026-09-14 사용자 요청 — 관리자 중심 메뉴에 빠져 있던 개인 조회 기능 신설)
-- 관례: 멱등(IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── 1) 급여명세서 수신(열람) 확인 — 발행(statement_sent_at) 뒤 본인이 처음 연 시각 ──
ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS statement_viewed_at text;

-- ── 2) 수당 규칙에서 고를 수 있는 항목만 표시(rule_eligible) ──
-- 공제·소득세류는 자동 산정/공제, 초과근무·성과급·전월미지급금·상여·장기근속휴가수당은 자동 산정 지급으로 전환,
-- 출장수당(출장숙박수당만 유지)·미상 지급·업무수당·고정연장/휴일/야간은 규칙 대상에서 제외(사용자 확정 2026-09-14).
-- 학자금상환공제는 개인별 정액이라 자동 산정 근거가 없어 규칙 대상으로 남긴다.
ALTER TABLE payroll_item_defs ADD COLUMN IF NOT EXISTS rule_eligible integer NOT NULL DEFAULT 1;
UPDATE payroll_item_defs SET rule_eligible = 0
 WHERE kind = 'deduction' AND item_id <> 'student-loan';
UPDATE payroll_item_defs SET rule_eligible = 0
 WHERE item_id IN ('bonus', 'prev-unpaid', 'overtime', 'incentive', 'trip', 'unlabeled-pay',
                   'duty-allow', 'fixed-ot', 'fixed-holiday', 'fixed-night', 'longevity');
-- 고정연장/휴일/야간수당은 개념 자체가 없어 비활성(대장 사용 이력이 없을 때만 — FK 안전).
UPDATE payroll_item_defs d SET is_active = 0
 WHERE d.item_id IN ('fixed-ot', 'fixed-holiday', 'fixed-night')
   AND NOT EXISTS (SELECT 1 FROM payroll_entry_lines l WHERE l.item_id = d.item_id);
-- 장기근속휴가수당·상여 규칙은 자동 산정(별표 9 / 상여금 지급 계획)으로 대체 — 기존 규칙은 비활성 보존.
UPDATE payroll_pay_rules SET is_active = 0, updated_at = now()::text
 WHERE item_id IN ('longevity', 'bonus') AND is_active = 1;

-- ── 3) 연말정산 직원 셀프 업로드(소득·세액공제신고서 엑셀, 홈택스 간소화 PDF) ──
-- 파일은 S3(hr/yearend/{year}/{employee_id}/...)에 보관해 세무사 제출용 바인딩에 쓰고, 파싱 결과는 parsed 에 스냅.
CREATE TABLE IF NOT EXISTS yearend_employee_uploads (
  upload_id text PRIMARY KEY,
  target_year integer NOT NULL,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('simplified_pdf', 'deduction_form', 'other')),
  file_key text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes integer NOT NULL DEFAULT 0,
  parsed jsonb,
  applied integer NOT NULL DEFAULT 0,             -- 파싱값을 정산 입력(inputs)에 반영했는지
  uploaded_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_yearend_uploads_year_emp ON yearend_employee_uploads(target_year, employee_id);
-- 세무법인 원본 원천징수영수증(PDF)을 관리자가 올리면 pdf_key(184)에 저장 — 개인 열람·증명서 발급 원본.
ALTER TABLE yearend_settlements ADD COLUMN IF NOT EXISTS pdf_file_name text;

-- ── 4) 장기근속 포상(사규 별표 9, 2026.04.08 개정) — 근속 도달 시 휴가 부여 + 휴가비 지급 ──
CREATE TABLE IF NOT EXISTS longevity_reward_rules (
  years integer PRIMARY KEY,                       -- 근속 연수(만)
  leave_days numeric NOT NULL DEFAULT 0,           -- 휴가 부여일수
  allowance_amount integer NOT NULL DEFAULT 0,     -- 휴가비(급여 항목 longevity 로 지급)
  is_active integer NOT NULL DEFAULT 1,
  note text,
  updated_at text NOT NULL DEFAULT now()::text
);
INSERT INTO longevity_reward_rules (years, leave_days, allowance_amount, note) VALUES
  (5, 2, 500000, '별표 9 — 5년'),
  (10, 3, 1000000, '별표 9 — 10년'),
  (20, 3, 1000000, '별표 9 — 20년')
ON CONFLICT (years) DO NOTHING;
-- 특별휴가 원장 자동 적재 출처 확장: 'auto_longevity'(ref_key = 'longevity:{years}' 멱등).

-- ── 5) 상여금 지급 계획 양식(명절 상여 등 — 성과급 지급 계획 frm-bonus-plan 과 별개) ──
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, mobile_allowed, created_at, updated_at)
VALUES
  ('frm-bonus-payment-plan', 'fld-hr', '상여금 지급 계획',
   '명절 상여 등 상여금(별표 4) 지급 계획 — 일괄 동액 또는 개별 차등. 승인되면 해당 귀속월 상여대장(작성 중)이 자동 생성됩니다.',
   '[
     {"key":"pay_reason","label":"지급 사유","type":"select","required":true,"options":["설 명절 상여","추석 명절 상여","하계휴가비","기타 상여"],"row":1,"span":1},
     {"key":"pay_month","label":"지급 귀속월(YYYY-MM)","type":"text","required":true,"placeholder":"예: 2026-09","row":1,"span":1},
     {"key":"apply_mode","label":"적용 방식","type":"radio","required":true,"options":["일괄 동액","개별 차등"],"row":1,"span":1},
     {"key":"uniform_amount","label":"일괄 지급액(원)","type":"currency","placeholder":"일괄 동액일 때","row":2,"span":1},
     {"key":"headcount","label":"지급 인원","type":"number","row":2,"span":1},
     {"key":"total","label":"지급 총액(원)","type":"currency","row":2,"span":1},
     {"key":"rows","label":"지급 명세","type":"table","required":true,"row":3,"span":3,"sumColumn":"amount",
      "tableColumns":[
        {"key":"emp_no","label":"사번","type":"text"},
        {"key":"name","label":"성명","type":"text","required":true},
        {"key":"dept","label":"부서","type":"text"},
        {"key":"position","label":"직함","type":"text"},
        {"key":"amount","label":"지급액(원)","type":"currency","required":true},
        {"key":"memo","label":"비고","type":"text"}
      ]},
     {"key":"note","label":"비고","type":"multitext","row":4,"span":3,"minRows":2},
     {"key":"notice","label":"안내","type":"static","content":"사규 별표 4: 상여금은 의무 지급 대상이 아니며 경영 상황·근태·업무 실적에 따라 미지급 또는 증감·차등 지급할 수 있습니다(제51조 — 지급 시 재직자에 한함, 휴직자 제외).\n승인되면 지급 귀속월의 상여대장(작성 중)이 자동 생성되며 급여대장 화면에서 소득세 등을 확인·확정합니다.","row":5,"span":3}
   ]'::jsonb,
   '상여금지급', 5, '인사 문서', '인사 문서', 12, 0, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-bonus-payment-plan'
ON CONFLICT (form_id, version) DO NOTHING;

INSERT INTO approval_form_actions (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
VALUES ('fa-bonus-payment-plan', 'frm-bonus-payment-plan', 'payroll.bonus_ledger', 'approved',
        '{"pay_month":"pay_month","rows":"rows","reason":"pay_reason"}'::jsonb,
        '{}'::jsonb, 1, 0, now()::text, now()::text)
ON CONFLICT (action_id) DO NOTHING;

-- 상여대장 ↔ 지급 계획 문서 연결(재실행 멱등·화면 배지).
ALTER TABLE payroll_ledgers ADD COLUMN IF NOT EXISTS plan_doc_id text;
