-- 통합허가 대상사업장 중 동일 사업자등록번호로 2개 이상의 소재지를 운영하는 사업장을
-- 단일 레코드로 관리하기 위한 보조 소재지 컬럼.
-- 기본 소재지(site_address)는 그대로 지역(region_*)/중복 검증/계약 매칭 기준으로 사용하고,
-- 추가 소재지는 JSON 문자열 배열(예: ["서울 ...", "경기 ..."])로 저장한다.
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS additional_site_addresses text;
