-- 254: 대행 실적 보고서 발송 — 실무자에게 메일·메신저로 보낸다(허가 서류 제출 시 함께 내야 하는 서류).
--  이력(contract_agency_reports, 252)마다 발송 방식(건별 변경)·발송 상태를 둔다.
--  기본 발송 방식은 신고 대기열 설정(regulatory_filing_settings.config.reportDelivery)에 있다. 멱등.

ALTER TABLE contract_agency_reports
  -- 이 건의 발송 방식: mail | messenger | both | hold  (NULL = 설정 기본값을 따른다)
  ADD COLUMN IF NOT EXISTS delivery_mode   text,
  -- 발송 결과: sent | held | no_recipient | failed  (NULL = 아직 보내지 않음 — 신고서 PDF 첨부 전 등)
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivered_at    text,
  -- { channels: ["mail","messenger"], recipients: [{ name, email, userId }], error }
  ADD COLUMN IF NOT EXISTS delivery_detail jsonb;
