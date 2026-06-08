-- 사용자가 편집/수동등록 화면에서 직접 입력한 소재지는 시군구동 구분(자동 띄어쓰기) 로직을
-- 적용하지 않고 입력값 그대로 저장·표시하기 위한 플래그.
-- 기존(스크래핑) 데이터는 false(기본값)이므로 표시 동작이 변하지 않는다.
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS site_address_verbatim boolean NOT NULL DEFAULT false;
