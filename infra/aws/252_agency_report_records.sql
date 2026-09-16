-- 252: 대행 실적 보고 이력(IEPS 신고 완료분) — 계약별 신고 구분·신고일·신고서 PDF.
--  대기열(regulatory_filings, 213)이 "무엇을 신고해야 하는가"라면 이 표는 "무엇을 신고했는가"다.
--  IEPS 에서 신고를 마치고 실적보고 출력(PDF)을 받아 계약 상세의 대행 실적 보고 카드에 쌓는다. 멱등.

CREATE TABLE IF NOT EXISTS contract_agency_reports (
  report_id    text PRIMARY KEY,
  contract_id  text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  -- conclude=체결 / amend=변경 / complete=완료(이행). 대기열 trigger_kind 와 같은 값을 쓴다.
  report_kind  text NOT NULL CHECK (report_kind IN ('conclude', 'amend', 'complete')),
  reported_on  text NOT NULL,          -- 신고일 (YYYY-MM-DD)
  receipt_no   text,                   -- 접수번호(선택)
  -- 신고서 PDF — contract_documents.document_type = 'agency_report'
  document_id  text REFERENCES contract_documents(document_id) ON DELETE SET NULL,
  -- 대기열에서 제출 완료 처리해 자동 기록된 건이면 그 항목(수기 등록이면 NULL)
  filing_id    text REFERENCES regulatory_filings(filing_id) ON DELETE SET NULL,
  note         text,
  created_by   text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);

-- 대기열 1건 = 이력 1건(자동 기록 중복 방지). 수기 등록(filing_id IS NULL)은 제한하지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_agency_reports_filing
  ON contract_agency_reports(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_agency_reports_contract
  ON contract_agency_reports(contract_id, reported_on);
