-- 349_facility_tax_reg_id.sql
-- 전자세금계산서 공급받는자 종사업장 번호(2026-11-10 사용자 요청).
--   같은 법인(사업자번호)의 지점·공장이 종사업장으로 등록돼 있으면, 그 사업장 앞으로 계산서를 받을 때
--   공급받는자 종사업장 번호(바로빌 InvoiceeParty.TaxRegID, 숫자 4자리 예: 0003)를 넣어야 한다.
--   번호는 그 지점·공장 사업장 마스터에 둔다(예: 삼성전기 부산사업장 = 0003). 비어 있으면 본점 발행이다.
--
-- ⚠ tax_invoices 는 재무 설치 지문 감시 표라 열을 추가하지 않는다(finance-guard-fk-trap, 331·332 사고).
--   발행에 쓴 종사업장 번호는 외래키 없는 보조 표 tax_invoice_invoicee_extras 에 invoice_id 로 남긴다.
-- 설치 전제: 001(facilities). GRANT 없음(265 default privileges). 멱등.

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS tax_reg_id text;
ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_tax_reg_id_check;
ALTER TABLE facilities ADD CONSTRAINT facilities_tax_reg_id_check CHECK (tax_reg_id IS NULL OR tax_reg_id ~ '^[0-9]{4}$');

-- 발행 이력 보조 — 공급받는자 종사업장 번호(invoice_id 는 tax_invoices.invoice_id, 외래키는 걸지 않는다).
CREATE TABLE IF NOT EXISTS tax_invoice_invoicee_extras (
  invoice_id  text PRIMARY KEY,
  tax_reg_id  text CHECK (tax_reg_id IS NULL OR tax_reg_id ~ '^[0-9]{4}$'),
  created_at  text NOT NULL
);
