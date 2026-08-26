-- 203: 개인카드 경비 정산(FRM-P6, 08-26 확정) — 승인된 지출결의서(개인카드)·출장보고서의
-- 개인카드 지출 행을 월 1회 일괄 취합해 인별 지급액을 확정하고, KB CMS 이체 등록 xlsx 를 생성한다
-- (이체 실행 자체는 담당자가 KB 기업뱅킹에서 수동 — 앱은 파일 생성·이력 기록까지).
-- 이중 정산 방지: expense_settlement_items.row_ref 전역 유니크(receipt:<id> | row:<docId>:<idx>).

-- 직원 급여·경비 입금 계좌 — CMS 파일 생성에 사용(은행코드=금융결제원 표준 숫자 코드).
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS bank_code text;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS bank_account_holder text;  -- 예금주(비우면 본인 성명)

CREATE TABLE IF NOT EXISTS expense_settlements (
  settlement_id text PRIMARY KEY,
  settled_on text NOT NULL,          -- 정산 실행일 YYYY-MM-DD
  period_from text,                  -- 대상 사용일 범위(표시용 — 실제 대상은 row_ref 미정산 전건)
  period_to text,
  total_amount bigint NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  person_count integer NOT NULL DEFAULT 0,
  cms_file_key text,                 -- 생성한 CMS xlsx 저장 키(재다운로드)
  vat_bundle_sent_at text,           -- 부가세 자료 세무사 발송 시각
  vat_bundle_sent_to text,
  note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_settlement_items (
  item_id text PRIMARY KEY,
  settlement_id text NOT NULL REFERENCES expense_settlements(settlement_id) ON DELETE CASCADE,
  row_ref text NOT NULL UNIQUE,      -- receipt:<receiptId> | row:<docId>:<rowIdx> — 이중 정산 방지
  doc_id text NOT NULL,
  doc_no text,
  form_id text NOT NULL,
  receipt_id text,                   -- personal_receipts 연결(있는 행만)
  employee_id text,
  user_id text,
  employee_name text,
  used_on text,
  vendor text,
  category text,
  amount bigint NOT NULL DEFAULT 0,
  detail text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expsettle_items_settlement ON expense_settlement_items(settlement_id);
CREATE INDEX IF NOT EXISTS idx_expsettle_items_emp ON expense_settlement_items(employee_id, used_on);
