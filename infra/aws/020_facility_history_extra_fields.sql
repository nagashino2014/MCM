-- 사업장 이력(facility_history_events) 확장:
--  - 소재지 변경 이력(이전/변경 소재지)
--  - 인수 주체(acquirer) / 합병 대상(merger targets) 기업 기록
--  - 한 번의 이력에서 복수 유형을 선택할 수 있도록 event_types(JSON 배열) 추가
-- 기존 event_type(단일) 컬럼은 하위호환을 위해 유지하며, 대표 유형을 저장한다.
ALTER TABLE facility_history_events
  ADD COLUMN IF NOT EXISTS previous_site_address text,
  ADD COLUMN IF NOT EXISTS new_site_address text,
  ADD COLUMN IF NOT EXISTS acquirer_company_name text,
  ADD COLUMN IF NOT EXISTS merger_target_company_names text,
  ADD COLUMN IF NOT EXISTS event_types text;
