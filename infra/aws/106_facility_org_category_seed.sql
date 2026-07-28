-- 106_facility_org_category_seed.sql
-- 연락처 구분 초기값 일괄 지정 — 계약 발주처 + IEPS 수집(통합허가 대상) 사업장 중
-- 5대 발전사·지자체·공공기관(추정)을 제외한 나머지를 '민간기업'으로 채운다.
--
-- 제외 대상은 값을 넣지 않고 미지정으로 남긴다(잘못 채우는 것보다 비워두고 화면에서 지정).
-- 이미 지정된 사업장(org_category IS NOT NULL)은 건드리지 않는다 → 재실행 안전(멱등).

UPDATE facilities f
   SET org_category = '민간기업',
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE f.deleted_at IS NULL
   AND f.org_category IS NULL
   -- 대상: 계약 발주처(거래처) 또는 IEPS 수집 사업장(= 통합환경허가 대상)
   AND (
         f.source = 'ieps'
      OR EXISTS (SELECT 1 FROM contracts c
                  WHERE c.counterparty_facility_id = f.facility_id AND c.deleted_at IS NULL)
       )
   -- 제외 ①: 5대 발전사
   AND f.company_name !~ '(남부발전|중부발전|서부발전|남동발전|동서발전)'
   -- 제외 ②: 지자체(시·군·도청, 광역/특별시, '○○시 …'·'○○군 …' 형태)
   AND f.company_name !~ '(시청|군청|도청|특별자치|특별시|광역시)'
   AND f.company_name !~ '^[가-힣]+(시|군)[ (]'
   -- 제외 ③: 공공기관·공기업으로 보이는 명칭(환경공단·각종 공사 등)
   AND f.company_name !~ '(환경공단|시설관리공단|도시공사|개발공사|수자원공사|도로공사|철도공사|공항공사|가스공사|석유공사|농어촌공사|토지주택공사|한국전력)';
