-- 315_facility_region_sido_from_address.sql
-- ⚠ 초안 — 스테이징 DB 쓰기이므로 사용자 승인 전 적용하지 않는다(2026-10-29 Salesboard 실데이터 점검 후속).
-- 사업장 시도(facilities.region_sido)가 빈 행을 소재지 주소 맨 앞의 시도로 채운다.
--   스테이징 실측(2026-10-29, 읽기 전용): 사업장 2,073곳 중 328곳(15.8%)·계약 거래처 359곳 중 223곳(62%)이 빈 값,
--   그중 주소 맨 앞에 시도가 있는 곳 236곳. 시군구로 시작(11)·회사명이 주소칸에 있는(42)·주소 없음(39)은 건드리지 않는다.
--   원인: 021 법인 통합(legal_entity 행 생성)과 운영 법인 등록 API 가 region_sido 를 채우지 않았다(API 는 같은 PR 에서 수정).
-- 판정은 앱의 shortSido(lib/catalog/regions.ts)와 같은 '주소 맨 앞' 패턴이고, 저장값은 extractRegion(scraper/lib/ieps/region.ts)과 같은
--   공식 명칭이다. '광주시 …'는 경기 광주시라 제외한다(광역시는 '광주광역시'·'광주 …'로 적힌다).
-- region_sigungu·updated_at 은 바꾸지 않는다(시도만 보정, 목록 정렬에 영향 없음).
-- facility_quality_protect 트리거는 확인된(site_address 마스터가 있는) 사업장의 region_sido 변경을 되돌리므로,
--   같은 트랜잭션 안에서만 mcm.facility_write='reviewed' 를 켠다. 주소 자체는 바꾸지 않아 마스터 값 기록은 생기지 않는다.
-- 멱등: 빈 값인 행만 고치므로 재실행하면 0건.
--
-- 적용 전 영향 건수 확인(읽기 전용):
--   SELECT count(*) FROM facilities
--    WHERE NULLIF(btrim(region_sido), '') IS NULL
--      AND regexp_replace(COALESCE(site_address, ''), '\s+', '', 'g') ~ '^(서울|인천|경기|대전|세종|충북|충청북|충남|충청남|대구|경북|경상북|부산|울산|경남|경상남|광주|전북|전라북|전남|전라남|제주|강원)'
--      AND regexp_replace(COALESCE(site_address, ''), '\s+', '', 'g') !~ '^광주시';

DO $$
DECLARE
  fixed integer;
BEGIN
  PERFORM set_config('mcm.facility_write', 'reviewed', true);
  WITH src AS (
    SELECT facility_id, regexp_replace(COALESCE(site_address, ''), '\s+', '', 'g') AS a
      FROM facilities
     WHERE NULLIF(btrim(region_sido), '') IS NULL
  ), m AS (
    SELECT facility_id,
           CASE
             WHEN a ~ '^광주시' THEN NULL
             WHEN a ~ '^서울' THEN '서울특별시'
             WHEN a ~ '^인천' THEN '인천광역시'
             WHEN a ~ '^경기' THEN '경기도'
             WHEN a ~ '^대전' THEN '대전광역시'
             WHEN a ~ '^세종' THEN '세종특별자치시'
             WHEN a ~ '^(충북|충청북)' THEN '충청북도'
             WHEN a ~ '^(충남|충청남)' THEN '충청남도'
             WHEN a ~ '^대구' THEN '대구광역시'
             WHEN a ~ '^(경북|경상북)' THEN '경상북도'
             WHEN a ~ '^부산' THEN '부산광역시'
             WHEN a ~ '^울산' THEN '울산광역시'
             WHEN a ~ '^(경남|경상남)' THEN '경상남도'
             WHEN a ~ '^광주' THEN '광주광역시'
             WHEN a ~ '^(전북|전라북)' THEN '전북특별자치도'
             WHEN a ~ '^(전남|전라남)' THEN '전라남도'
             WHEN a ~ '^제주' THEN '제주특별자치도'
             WHEN a ~ '^강원' THEN '강원특별자치도'
           END AS sido
      FROM src
  )
  UPDATE facilities f
     SET region_sido = m.sido
    FROM m
   WHERE f.facility_id = m.facility_id
     AND m.sido IS NOT NULL
     AND NULLIF(btrim(f.region_sido), '') IS NULL;
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE '315: region_sido 보정 %건', fixed;
END $$;
