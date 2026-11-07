-- 344_contact_search_name_variants_reset.sql
-- 영문·병기 이름의 조회 변형이 생겨, 이미 검색을 마치고 추천을 받지 못한 회사를 대기로 되돌린다.
-- 분류한 회사와 추천받은 회사, 검색을 건너뛴 회사(판정 없음)는 건드리지 않는다.
-- paused·attention 은 '검색 재개'가 되돌린다. 다시 실행하면 해당 회사를 한 번 더 조회할 뿐이다.

UPDATE contact_import_companies
   SET search_status = 'pending', search_lease_until = NULL
 WHERE decision IS NULL
   AND search_status = 'done'
   AND search_verdict IN ('review', 'not_found')
   AND regexp_replace(display_name, '\((주|유|사|재|합|의|유한)\)', '', 'g') ~ '[A-Za-z/()]';
