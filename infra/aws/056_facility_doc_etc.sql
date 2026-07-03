-- 056_facility_doc_etc.sql
-- 시설 현황 자료에 '기타 설비 자료'(etc) 문서 유형 추가.
-- 054(facility_facility_documents)의 doc_type CHECK 제약을 확장. 멱등.

ALTER TABLE facility_facility_documents DROP CONSTRAINT IF EXISTS facility_facility_documents_doc_type_check;
ALTER TABLE facility_facility_documents
  ADD CONSTRAINT facility_facility_documents_doc_type_check
  CHECK (doc_type IN ('integrated_plan','media_permit','factory_reg','etc'));
