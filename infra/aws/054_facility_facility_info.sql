-- 054_facility_facility_info.sql
-- 사업장 시설현황: 시설정보(6항목) + 부지면적(3항목) + 시설 자료(통합계획서/매체별인허가/공장등록증).
-- 001(facilities) 위에 적용. 멱등. 영업/사업장 담당자가 직접 입력·업로드.

CREATE TABLE IF NOT EXISTS facility_facility_info (
  facility_id            text PRIMARY KEY REFERENCES facilities(facility_id) ON DELETE CASCADE,
  discharge_facility     text,   -- 배출시설
  general_stack          text,   -- 일반굴뚝
  cleansys               text,   -- CleanSYS
  flare_stack            text,   -- 플레어스택
  outlet                 text,   -- 방류구
  non_discharge_facility text,   -- 비배출시설
  factory_area           double precision,  -- 공장부지 면적(m²)
  manufacturing_area     double precision,  -- 제조시설 면적(m²)
  auxiliary_area         double precision,  -- 부대시설 면적(m²)
  updated_at             text NOT NULL,
  updated_by             text REFERENCES users(user_id) ON DELETE SET NULL
);

-- 시설 자료(각 유형 1개, 최신 유지). S3 storage_* 패턴.
CREATE TABLE IF NOT EXISTS facility_facility_documents (
  facility_id       text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  doc_type          text NOT NULL CHECK (doc_type IN ('integrated_plan','media_permit','factory_reg')),
  display_name      text,
  original_filename text,
  content_type      text,
  byte_size         bigint,
  storage_provider  text,
  storage_bucket    text,
  storage_key       text,
  uploaded_at       text NOT NULL,
  uploaded_by       text REFERENCES users(user_id) ON DELETE SET NULL,
  PRIMARY KEY (facility_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_facility_facility_documents_facility ON facility_facility_documents(facility_id);
