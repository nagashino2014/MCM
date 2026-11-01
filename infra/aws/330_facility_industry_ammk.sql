-- 330: (유)에이엠엠케이 3공장 업종 코드 — 사용자 결정 반영(2026-11-01, 회사 홈페이지 사업분야 확인 결과 두 업종 모두 해당).
--   docs/permit-industries-ksic-diff-2026-11-01.md §5 C1. 326~329 다음에 적용한다.
-- 26221 / '플라스틱제품 제조업'(코드와 업종명이 다른 업종) → 26221 인쇄회로기판용 적층판 + 22299 그 외 기타 플라스틱 제품(복수 업종, 줄바꿈 연결).
--   업종 필터·통계는 전자부품·플라스틱 양쪽에 잡히고, 대표 업종(계약 업종 프리필 등)은 업종 목록 순서상 앞인 전자부품이다.
-- 안전장치: 지금 값이 조회 때 값과 같을 때만 바꾸고, 전후 값은 facility_industry_fixes(327)에 남긴다. 멱등.
-- 선행: 327.

WITH fix(facility_id, cur_code, cur_name, new_code, new_name, reason) AS (
  VALUES
      (E'13946-00', E'26221', E'플라스틱제품 제조업', E'26221\n22299', E'인쇄회로기판용 적층판 제조업\n그 외 기타 플라스틱 제품 제조업', E'C1 회사 사업분야 확인 — 26221 + 22299 두 업종')
),
hit AS (
  SELECT f.facility_id, f.industry_code AS old_code, f.industry_name AS old_name, x.new_code, x.new_name, x.reason
    FROM fix x
    JOIN facilities f ON f.facility_id = x.facility_id
   WHERE f.industry_code = x.cur_code
     AND COALESCE(f.industry_name, '') = x.cur_name
     AND (f.industry_code IS DISTINCT FROM x.new_code OR f.industry_name IS DISTINCT FROM x.new_name)
),
logged AS (
  INSERT INTO facility_industry_fixes (facility_id, old_code, old_name, new_code, new_name, reason, source)
  SELECT facility_id, old_code, old_name, new_code, new_name, reason, '330' FROM hit
  RETURNING facility_id
)
UPDATE facilities f
   SET industry_code = h.new_code, industry_name = h.new_name
  FROM hit h
 WHERE f.facility_id = h.facility_id;
