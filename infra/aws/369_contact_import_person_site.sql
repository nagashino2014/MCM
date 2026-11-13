-- 369: 연락처 가져오기 담당자별 산하 사업장(2026-11-13 사용자 요청).
-- 342(contact_import_rows) 위에 적용. 멱등.
-- 포스코 본사·광양제철소, 하이트진로 홍천·전주·창원공장처럼 한 회사의 담당자가 서로 다른 사업장 소속일 때
-- 회사 단위 분류와 별개로 담당자마다 배속할 사업장을 기록한다.
--   address     — 아마란스 원본 대표주소(담당자별). 산하 사업장 추천 근거. 369 이전 적재분은 같은 파일을 다시 올리면 채워진다.
--   facility_id — 대기(pending)면 담당자별로 고른 사업장(NULL = 회사 분류대로),
--                 옮겨짐(imported)이면 실제로 들어간 사업장(NULL = 369 이전 분류분, 회사 분류 사업장).
-- 표 단위 권한(265 기본 권한·343 mcm_worker GRANT)이 새 열에도 그대로 적용되므로 GRANT 는 없다.

ALTER TABLE contact_import_rows ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE contact_import_rows ADD COLUMN IF NOT EXISTS facility_id text;

CREATE INDEX IF NOT EXISTS idx_contact_import_rows_facility ON contact_import_rows(facility_id) WHERE facility_id IS NOT NULL;
