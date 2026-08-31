-- 205: 전문가활용비 지급 신청서 + 사업·기타소득 대장(FRM-P4, 08-26 확정).
-- 일비(사무실 수선 인부 등)=기타소득, 자문료=사업소득. 승인 시 커넥터(finance.income_ledger_append)가
-- 세액을 자동 계산해 대장(income_payment_ledger)에 적재하고, 결산 전표는 regenerateJournal 의
-- income_doc 소스가 대장을 스캔해 자동분개한다((차)805 잡급/831 지급수수료, (대)254 예수금+103 보통예금).
-- 세액 산식(실무 대장 실측 — 기타소득 & 사업소득대장 엑셀):
--   기타: 필요경비 80% → 과세소득 20% 소득세 + 지방세 10%, 과세소득 5만원 이하 소액부징수(0).
--   사업: 지급총액 3% 소득세 + 지방세 10%, 소득세 1,000원 미만 소액부징수(0). 10원 미만 절사.

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-expert-fee', 'fld-finance', '전문가활용비 지급 신청서', '자문료(사업소득)·일비(기타소득) 등 인적용역 대가 지급 신청 — 승인 시 소득대장 자동 적재+원천세 자동 계산',
   '[
     {"key":"income_kind","label":"소득 구분","type":"radio","required":true,"options":["기타소득 (일비·사례금 등)","사업소득 (자문료·강연료 등 계속적 용역)"],"row":1,"span":3},
     {"key":"payee_name","label":"소득자 성명","type":"text","required":true,"row":2,"span":1},
     {"key":"payee_rrn","label":"주민등록번호","type":"text","required":true,"placeholder":"000000-0000000 — 원천징수 신고에 필요","row":2,"span":1},
     {"key":"pay_date","label":"지급일","type":"date","required":true,"row":2,"span":1},
     {"key":"gross_amount","label":"지급총액","type":"currency","required":true,"row":3,"span":1},
     {"key":"bank_info","label":"입금 계좌(은행/계좌번호)","type":"text","row":3,"span":2},
     {"key":"pay_reason","label":"지급 내역(대장 비고에 기재)","type":"text","required":true,"placeholder":"예: 사무실 보수공사 노임 지급 / 자문위원 8월 자문료","row":4,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"승인되면 소득 구분에 따라 사업·기타소득 대장에 자동 적재되고 원천세(기타: 필요경비 80% 공제 후 22%, 사업: 3.3%)가 자동 계산됩니다.\n차감지급액 이체는 경리 담당자가 별도로 실행합니다.","row":5,"span":3}
   ]'::jsonb,
   '전문가활용비', 5, '회계 문서', '회계 문서', 4, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-expert-fee'
ON CONFLICT (form_id, version) DO NOTHING;

-- 사업·기타소득 지급 대장 — 엑셀 대장(기타소득 & 사업소득대장)의 열 구성 그대로.
CREATE TABLE IF NOT EXISTS income_payment_ledger (
  entry_id text PRIMARY KEY,
  income_kind text NOT NULL,                -- business(사업)|other(기타)
  pay_date text NOT NULL,                   -- 지급일 YYYY-MM-DD
  payee_name text NOT NULL,
  payee_rrn_encrypted text,                 -- 주민등록번호(암호화 — pii-crypto)
  payee_rrn_masked text,                    -- 표시용 마스킹(000000-1******)
  gross_amount bigint NOT NULL,             -- 지급총액
  necessary_expense bigint NOT NULL DEFAULT 0,  -- 필요경비(기타 80%)
  taxable_income bigint NOT NULL DEFAULT 0, -- 과세소득
  income_tax bigint NOT NULL DEFAULT 0,     -- 소득세(기타 20% / 사업 3%)
  local_tax bigint NOT NULL DEFAULT 0,      -- 지방소득세(소득세의 10%)
  withheld_total bigint NOT NULL DEFAULT 0, -- 징수세액 합
  net_amount bigint NOT NULL,               -- 차감지급액
  note text,                                -- 비고(지급 내역)
  doc_id text UNIQUE,                       -- 승인 문서(수기 등록은 NULL)
  doc_no text,
  created_by text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_income_ledger_kind ON income_payment_ledger(income_kind, pay_date);

-- FRM-P0 레지스트리 배선: 승인 시 대장 적재(+세액 자동 계산)
INSERT INTO approval_form_actions (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
VALUES ('fa-expert-fee-ledger', 'frm-expert-fee', 'finance.income_ledger_append', 'approved',
        '{"kind":"income_kind","name":"payee_name","rrn":"payee_rrn","date":"pay_date","gross":"gross_amount","reason":"pay_reason"}'::jsonb,
        '{}'::jsonb, 1, 0, now()::text, now()::text)
ON CONFLICT (action_id) DO NOTHING;
